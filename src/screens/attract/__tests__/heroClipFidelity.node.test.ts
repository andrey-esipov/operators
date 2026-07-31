import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROSTER } from '../../../fighthud/select/roster'

/**
 * HERO-ATLAS ART-FIDELITY gate — the opener must render the SAME art as the match.
 *
 * The attract opener downloads a reduced "hero" atlas (`atlas.hero.webp` +
 * `assets.hero.json`) instead of the full one, to keep cold-start cheap on slow
 * links (see attractLoadCost / firstBoutBudget). The hero is meant to be a pure
 * 0.5x MIRROR of the full atlas — `scripts/lib/heroAtlas.ts:scaleHeroManifest`
 * carries over every frame and every clip verbatim and only downscales the rects
 * and anchors — so the opener shows an identical pose at lower fidelity.
 *
 * A hero manifest is regenerated FROM the full atlas, so it can go STALE: if a
 * fighter's full art is updated but its hero is not rebuilt in the same change,
 * the opener keeps serving the OLD art. lenny shipped exactly this bug — its full
 * `super.P` clip played the current super-storm reel while its hero `super.P`
 * still played the retired special-fireball reel. The existing hero gates
 * (atlasCostBake / firstBoutBudget / heroOpenerDecoupling) only check hero BYTES
 * and existence, so a stale-but-similarly-sized hero sails straight through them.
 *
 * This gate closes that gap. For every choosable roster skin it asserts the hero
 * atlas renders the SAME art as the full atlas, checked two ways, BY NAME:
 *
 *   • CLIP FIDELITY — every clip resolves its frame INDICES to the SAME sequence
 *     of frame NAMES in the hero as in the full manifest. Comparing resolved
 *     NAMES (not raw indices) is what catches a stale hero: a stale table keeps
 *     numeric indices that are still in range but point at an OLDER frame, so the
 *     index sequence can match while the art played does not.
 *   • FRAME-TABLE MIRROR — the hero's ordered frame-name list equals the full's,
 *     so a frame added/removed/reordered by an art update but missing from the
 *     hero reddens even if no clip happens to reference it.
 *
 * ANTI-VACUITY (this project has a documented history of gates that pass by
 * checking nothing): the skin set is enumerated from the shipped ROSTER and the
 * count actually compared is asserted (> 4, and == ROSTER.length), and the total
 * number of clips compared is asserted well above zero, so an empty roster or a
 * skipped body cannot pass silently.
 *
 * MUTATION-PROVEN (see the task report for red/green transcripts): repointing a
 * hero clip's frame indices at other frames reddens the CLIP FIDELITY assertion
 * naming the skin and clip; deleting a clip from a hero manifest reddens naming
 * that clip (an absent clip is not skipped); neutralizing the clip comparison so
 * it compares the hero to itself lets the stale case pass (the comparison is
 * load-bearing, not decorative); and forcing the checked set empty reddens the
 * vacuity guard.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
// __tests__ → attract → screens → src → repo root, then /public.
const PUBLIC_DIR = resolve(HERE, '../../../../public')

interface Frame {
  name: string
}
interface Clip {
  frames: number[]
}
interface Manifest {
  frames: Frame[]
  clips: Record<string, Clip>
}

function fullManifestPath(skin: string): string {
  return resolve(PUBLIC_DIR, 'fighters', skin, 'assets.json')
}
function heroManifestPath(skin: string): string {
  return resolve(PUBLIC_DIR, 'fighters', skin, 'assets.hero.json')
}
function loadManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, 'utf-8')) as Manifest
}

/** Resolve a clip's frame INDICES to the frame NAMES they point at. A stale hero
 *  keeps numeric indices that are still in range but point into an OLDER frame
 *  table, so only the resolved NAME sequence reveals the art actually played. */
function clipFrameNames(m: Manifest, clip: string): (string | undefined)[] {
  return (m.clips[clip]?.frames ?? []).map((i) => m.frames[i]?.name)
}

describe('hero opener atlas renders identical art to the full atlas (no stale hero)', () => {
  it('ships a hero manifest + atlas for every choosable roster skin (vacuity: heroes exist)', () => {
    let checked = 0
    for (const r of ROSTER) {
      const heroManifest = heroManifestPath(r.skin)
      expect(existsSync(heroManifest), `no hero manifest for roster skin ${r.skin}`).toBe(true)
      const atlasField =
        (JSON.parse(readFileSync(heroManifest, 'utf-8')) as { atlas?: string }).atlas ??
        `/fighters/${r.skin}/atlas.hero.webp`
      const heroAtlas = resolve(PUBLIC_DIR, atlasField.replace(/^\/+/, ''))
      expect(existsSync(heroAtlas), `hero manifest for ${r.skin} points at missing atlas ${atlasField}`).toBe(true)
      checked++
    }
    expect(checked).toBe(ROSTER.length) // vacuity: we really visited the roster
    expect(checked).toBeGreaterThan(4)
  })

  it('mirrors the complete frame table (ordered frame names identical), per skin BY NAME', () => {
    let checked = 0
    for (const r of ROSTER) {
      const full = loadManifest(fullManifestPath(r.skin))
      const hero = loadManifest(heroManifestPath(r.skin))
      const fullNames = full.frames.map((f) => f.name)
      const heroNames = hero.frames.map((f) => f.name)
      expect(
        heroNames,
        `${r.skin}: hero frame table diverged from full (stale hero) — ` +
          `full ${fullNames.length} frames, hero ${heroNames.length}`,
      ).toEqual(fullNames)
      checked++
    }
    expect(checked).toBe(ROSTER.length)
    expect(checked).toBeGreaterThan(4)
  })

  it('renders identical art per clip in the hero as in the full atlas, across the roster BY NAME', () => {
    let skinsChecked = 0
    let clipsCompared = 0
    for (const r of ROSTER) {
      const full = loadManifest(fullManifestPath(r.skin))
      const hero = loadManifest(heroManifestPath(r.skin))

      // The hero must carry exactly the full's clip set — no clip dropped or added.
      expect(
        Object.keys(hero.clips).sort(),
        `${r.skin}: hero clip set diverged from full`,
      ).toEqual(Object.keys(full.clips).sort())

      for (const clip of Object.keys(full.clips)) {
        const fullArt = clipFrameNames(full, clip)
        const heroArt = clipFrameNames(hero, clip)
        // Source sanity: the full clip must resolve to real named frames, else the
        // comparison below could pass by matching undefined==undefined.
        expect(
          fullArt.every((n) => typeof n === 'string'),
          `${r.skin} clip "${clip}": full manifest has an out-of-range frame index`,
        ).toBe(true)
        expect(
          heroArt,
          `${r.skin} clip "${clip}": hero art diverged from full (stale hero) — ` +
            `full [${fullArt.join(' > ')}] vs hero [${heroArt.join(' > ')}]`,
        ).toEqual(fullArt)
        clipsCompared++
      }
      skinsChecked++
    }
    // Vacuity: a roster that shrank to nothing, or a body that compared no clips,
    // must not pass silently. Roster is 6 fightable skins × ~49–55 clips each.
    expect(skinsChecked).toBe(ROSTER.length)
    expect(skinsChecked).toBeGreaterThan(4)
    expect(clipsCompared).toBeGreaterThan(100)
  })
})
