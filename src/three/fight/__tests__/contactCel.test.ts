import { describe, expect, it } from 'vitest'
import type { FighterAssets } from '../../../fight/types'
import { FIGHTERS } from '../../../fight/fighters'
import { ROSTER } from '../../../fighthud/select/roster'
import { resolveFrame } from '../AnimationDriver'
// Source-of-truth for the super arc (same module the pipeline derives every
// skin's super clip from). Imported so the super gate below can assert the SHAPE
// is bespoke independently of any shipped manifest — a revert to the recycled
// super reddens here even before a manifest rebuild.
import { deriveAttackClip, CLIPS } from '../../../../scripts/lib/frame-spec'

// Whole PLAYABLE roster, imported statically (same discipline as reactionCoverage /
// animationCadence: a single-fighter or single-archetype audit is structurally
// blind to the rest of the cast). A gate that sampled operator only is exactly
// how the kick contact-cel defect shipped — operator's shorter kick startups
// happened to keep hk-active on screen at contact while vanguard/warden did not.
import chesky from '../../../../public/fighters/chesky/assets.json'
import spiegel from '../../../../public/fighters/spiegel/assets.json'
import doshi from '../../../../public/fighters/doshi/assets.json'
import lenny from '../../../../public/fighters/lenny/assets.json'
import madhavan from '../../../../public/fighters/madhavan/assets.json'
import turley from '../../../../public/fighters/turley/assets.json'

const SKINS: Record<string, FighterAssets> = {
  chesky: chesky as unknown as FighterAssets,
  spiegel: spiegel as unknown as FighterAssets,
  doshi: doshi as unknown as FighterAssets,
  lenny: lenny as unknown as FighterAssets,
  madhavan: madhavan as unknown as FighterAssets,
  turley: turley as unknown as FighterAssets,
}

const isIdleName = (n: string): boolean => /^idle(-\d+)?$/.test(n)

interface Row {
  skin: string
  archetype: string
  moveId: string
  active0: number
  active1: number
  frame: number
  celIdx: number
  celName: string
  idle: boolean
}

/**
 * The contact-cel invariant, measured against the SHIPPED manifests (what the
 * game actually renders), not the source. For every attacking move that owns a
 * dedicated clip, EVERY frame of its active window — `active[0] .. active[1]`
 * inclusive, the whole span the hitbox is live — MUST draw a real contact pose,
 * never the idle breathing cel.
 *
 * Why the WHOLE window, not just active[0]: sim.ts freezes move.frame during
 * hitstop, and combat latches the hit on the first active-window overlap — but
 * that overlap is not always active[0]. A defender who walks into a hitbox
 * connects on a LATER active frame, and hitstop then freezes THAT frame for
 * ~200-270ms. Sampling active[0] alone is the same one-member-of-a-set blindness
 * the fix exists to kill, one level down: it green-lit st.MP (active[0]=6 draws
 * mp-active) while its last active frame (8) had already dropped back to idle,
 * and qcf.P (active[0]=11 draws the release) while frame 14 fell to idle. The
 * derived layout (frame-spec `layoutAttack`) binds the contact cel's duration to
 * the active length, so it spans the window by construction, for any archetype.
 *
 * The displayed cel is taken from the REAL AnimationDriver.resolveFrame (not a
 * re-implemented frameAt), driving the exact `stance:'attack'` query the renderer
 * issues, so this gate cannot pass on a mirror that has quietly drifted from the
 * driver.
 */
function collect(): { rows: Row[]; failures: Row[]; checkedFrames: number } {
  const rows: Row[] = []
  let checkedFrames = 0
  for (const entry of ROSTER) {
    const A = SKINS[entry.skin]
    if (!A) continue
    const def = FIGHTERS[entry.archetype]
    const clips = A.clips as unknown as Record<string, { frames: number[]; durations: number[] }>
    for (const [moveId, move] of Object.entries(def.moves)) {
      const clip = clips[moveId]
      // Only moves with a DEDICATED per-move clip carry authored contact art.
      // Moves that fall back to the generic `attack`/`idle` clip are art-deficit
      // #7 (missing per-move poses) and are reported separately, not gated here.
      if (!clip || !clip.frames.length) continue
      const [active0, active1] = move.active
      // WHOLE active window, not just the first frame — contact can latch on any
      // of these and freeze it.
      for (let frame = active0; frame <= active1; frame++) {
        checkedFrames++
        // Exact render path: what the driver draws for this attacker at this frame.
        const celIdx = resolveFrame(A, {
          stance: 'attack',
          move: { id: moveId, frame },
          globalFrame: 0,
        })
        const celName = A.frames[celIdx]?.name ?? `#${celIdx}`
        rows.push({
          skin: entry.skin,
          archetype: entry.archetype,
          moveId,
          active0,
          active1,
          frame,
          celIdx,
          celName,
          idle: isIdleName(celName),
        })
      }
    }
  }
  return { rows, failures: rows.filter((r) => r.idle), checkedFrames }
}

describe('every attacking move freezes on its contact cel, not the idle pose', () => {
  const { rows, failures, checkedFrames } = collect()

  it('GROUND TRUTH TABLE', () => {
    const byArch: Record<string, Row[]> = {}
    for (const r of rows) (byArch[r.archetype] ??= []).push(r)
    const lines: string[] = []
    for (const arch of Object.keys(byArch)) {
      const byMove: Record<string, Row[]> = {}
      for (const r of byArch[arch]) (byMove[r.moveId] ??= []).push(r)
      for (const moveId of Object.keys(byMove)) {
        const win = byMove[moveId]
        const first = win[0]
        const last = win[win.length - 1]
        const anyIdle = win.some((r) => r.idle)
        // Show the whole window as first-cel .. last-cel so an end-of-window drop
        // (the class this gate was widened to catch) is visible in the table.
        lines.push(
          `  ${arch.padEnd(9)} ${moveId.padEnd(9)} active[${String(first.active0).padStart(2)}..${String(
            first.active1,
          ).padStart(2)}] -> ${first.celName}${last.celName !== first.celName ? ` .. ${last.celName}` : ''}${
            anyIdle ? '  <== IDLE in window (defect)' : ''
          }`,
        )
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `\ncontact-cel map (dedicated-clip moves, whole active window; ${checkedFrames} frames checked):\n${lines.join(
        '\n',
      )}`,
    )
    expect(rows.length).toBeGreaterThan(0)
  })

  it('no dedicated-clip attack shows the idle cel anywhere in its active window (roster-wide)', () => {
    const detail = failures
      .map((f) => `${f.skin}/${f.archetype} ${f.moveId}@f${f.frame} of active[${f.active0}..${f.active1}] -> ${f.celName}`)
      .join('\n  ')
    expect(failures.map((f) => `${f.skin}:${f.moveId}@${f.frame}`), `idle-in-active-window:\n  ${detail}`).toEqual([])
  })

  // Vacuity guard. My own first probe of this invariant reported a green "checked
  // 0" — a test that iterates zero rows satisfies every toEqual([]) and is a lying
  // harness about itself. Assert the gate actually walked a census-scale number of
  // active frames (6 playable skins × ~20 dedicated-clip attacks × 2-8 active
  // frames each is several hundred). The floor is deliberately well below the real
  // count so it flags a collapse to near-zero, not a benign roster edit.
  it('checked a real number of active frames (not a vacuous pass)', () => {
    expect(checkedFrames).toBeGreaterThan(250)
  })

  // Anti-scope-shrink tripwire. A CPU-landing census (108 fights, 172,817 frames)
  // found cr.MK is the #2 most-landed attack at 22.7%, cr.LK 7.0%, and j.MK is a
  // human air-to-ground staple — all three alias to the startup-less LK/MK clips
  // and were in the broken set (29.7% of all landed contact). The whole defect is
  // this project's recurring shape: a check that validates one member of a set
  // (standing kicks) while the rest (crouch/air) go unwatched. A future edit that
  // narrows collect() to st.* moves would turn this file green while a third of
  // contact silently re-broke. So assert, per playable skin, that the gate ACTUALLY
  // produced a row for each high-frequency crouch/air kick the fighter defines with
  // a dedicated clip — coverage of the exact moves, not just an aggregate count.
  it('keeps watching the high-frequency crouch/air kicks (anti-scope-shrink)', () => {
    const HIGH_FREQ = ['cr.LK', 'cr.MK', 'j.MK']
    const checked: Record<string, Set<string>> = {}
    for (const r of rows) (checked[r.skin] ??= new Set()).add(r.moveId)
    const gaps: string[] = []
    for (const entry of ROSTER) {
      const A = SKINS[entry.skin]
      if (!A) continue
      const def = FIGHTERS[entry.archetype]
      const clips = A.clips as unknown as Record<string, { frames: number[] }>
      for (const m of HIGH_FREQ) {
        const defined = Boolean(def.moves[m]) && Boolean(clips[m]?.frames?.length)
        if (defined && !checked[entry.skin]?.has(m)) gaps.push(`${entry.skin}:${m}`)
      }
    }
    expect(gaps, `gate stopped covering high-frequency kicks: ${gaps.join(', ')}`).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Sibling gate: every PLAYABLE skin must ship a breathing idle/stance clip.
//
// art-deficit #9. turley shipped with NO idle clip at all: the canonical
// `CLIPS.idle` (frame-spec) references idle-4 and its sway tweens, which turley's
// atlas never got, so `resolveClip` dropped the whole reel. Fighter.ts reads
// `clips['idle'] ?? clips['stance']` with no runtime breathing fallback, so turley
// STATUED on frame 0 while all five other skins breathed. The cels needed to fix
// it (idle-3 + the idle tweens) were sitting UNREFERENCED in turley's own atlas —
// authored-but-never-consumed, this project's ninth confirmed instance. The fix
// wires `FALLBACK_CLIPS.idle` into the shipped manifest via patch-reaction-
// fallbacks, reusing those existing cels (atlas byte-identical, no new art).
//
// This gate makes #9 un-shippable again. It reads the SHIPPED manifest (what the
// renderer actually loads) and asserts every choosable fighter has an idle/stance
// reel of at least two keys — a one-cel "loop" is a statue with extra steps. Scope
// is derived from ROSTER (the choosable set), never a hardcoded count, and a
// non-vacuous coverage guard asserts we visited every ROSTER entry against a real
// imported manifest: the same one-member-of-a-set blindness that shipped the kick
// defect would otherwise let a playable skin quietly drop out of SKINS and go
// unwatched while the gate stayed green.
describe('every playable skin ships a breathing idle clip (art-deficit #9 tripwire)', () => {
  const MIN_IDLE_KEYS = 2
  interface IdleRow {
    skin: string
    archetype: string
    source: 'idle' | 'stance' | 'none' | 'MISSING-MANIFEST'
    keys: number
    present: boolean
  }
  const idleRows: IdleRow[] = ROSTER.map((entry) => {
    const A = SKINS[entry.skin]
    if (!A) return { skin: entry.skin, archetype: entry.archetype, source: 'MISSING-MANIFEST', keys: 0, present: false }
    const clips = A.clips as unknown as Record<string, { frames?: number[] } | undefined>
    const idleLen = clips['idle']?.frames?.length ?? 0
    const stanceLen = clips['stance']?.frames?.length ?? 0
    const source = idleLen ? 'idle' : stanceLen ? 'stance' : 'none'
    return { skin: entry.skin, archetype: entry.archetype, source, keys: Math.max(idleLen, stanceLen), present: true }
  })

  it('IDLE-PRESENCE TABLE', () => {
    const lines = idleRows.map(
      (r) => `  ${r.skin.padEnd(9)} ${r.archetype.padEnd(9)} ${r.source.padEnd(16)} ${r.keys} keys`,
    )
    // eslint-disable-next-line no-console
    console.log(`\nidle-presence map (shipped manifests):\n${lines.join('\n')}`)
    expect(idleRows.length).toBeGreaterThan(0)
  })

  it('has an idle or stance clip of >= 2 keys for every choosable fighter', () => {
    const gaps = idleRows
      .filter((r) => r.keys < MIN_IDLE_KEYS)
      .map((r) =>
        r.present
          ? `${r.skin}/${r.archetype}: ${r.source} has only ${r.keys} key(s) (would statue on frame 0)`
          : `${r.skin}/${r.archetype}: no manifest imported`,
      )
    expect(gaps, `skins with no breathing idle:\n  ${gaps.join('\n  ')}`).toEqual([])
  })

  // Vacuity / anti-scope-shrink guard, ROSTER-derived. `idleRows` is a .map over
  // ROSTER, so its length is trivially ROSTER.length — the load-bearing assertion
  // is that every row resolved to a REAL imported manifest (present:true). If a
  // future edit drops a playable skin out of SKINS, or ROSTER gains a choosable
  // face nobody wired an import for, that skin's row is present:false and this reds
  // rather than the gate silently auditing a subset and passing.
  it('audited every choosable fighter against a real manifest (not a vacuous subset)', () => {
    expect(ROSTER.length).toBeGreaterThan(0)
    const audited = idleRows.filter((r) => r.present).map((r) => r.skin)
    const missing = ROSTER.filter((e) => !audited.includes(e.skin)).map((e) => e.skin)
    expect(missing, `choosable skins with no imported manifest (unaudited): ${missing.join(', ')}`).toEqual([])
    expect(audited.length).toBe(ROSTER.length)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Sibling gate: the SUPER is bespoke art, not the recycled fireball/uppercut
// stitch.
//
// visual-critic v12 named the super "the single worst thing on screen": the ONE
// attack with zero drawings of its own. The old `shapeFrom(SUPER, …)` built it
// from special-fireball-charge + special-uppercut + special-fireball-release, so
// it "read as a fireball with a colour grade". Tier C gives it six bespoke keys
// (super-charge → super-charge-peak → super-release → super-release-2 →
// super-recovery → super-recovery-2) — the first attack in the game to clear the
// SF3:3S unique-frame floor of 6 (roster mean was ~2.8). The second STARTUP cel,
// super-charge-peak, is load-bearing rather than decoration: the 60-frame super
// freeze walks the startup cels then HOLDS the last one for the ~54-frame
// remainder (sim.advanceSuperOwner caps move.frame at active[0]-1), so whatever
// sits last in startup is the dominant thing on screen for the whole freeze — the
// single longest, most-watched phase of the most-watched move. A lone super-charge
// held an empty wind-up there; super-charge-peak is the authored "gathering power"
// pose that now fills it. operator's Palm Barrage (super.P) and warden's Ion Storm
// (super.storm) share the arc because both are energy-projection supers redrawn
// from each skin's own stance. (The vanguard grappler's Backbreaker is also id
// super.P but is a GRAB, not a projectile — it must route to its own grab/slam
// cels before any vanguard skin is generated, so vanguard stays on the recycled
// fallback here until then, which this gate treats as the legitimate
// not-yet-rolled-over state.)
//
// Two layers, because a manifest-only gate is a lying harness by construction: a
// revert of the frame-spec shape that skipped a manifest rebuild would leave the
// shipped manifest stale-bespoke and the gate green over reverted source. So:
//  (1) SOURCE  — deriveAttackClip (the one place every super clip is built) must
//                yield the bespoke arc and BAIL to the recycled fallback when the
//                contact cel is absent. Manifest-independent.
//  (2) SHIPPED — every playable skin is coherently EITHER bespoke-wired OR on the
//                recycled fallback, audited across the WHOLE roster, with a
//                progress guard that at least one skin has rolled over (else the
//                fix is absent). Checks the set, not one member.
describe('the super is bespoke art, not recycled fireball/uppercut cels (visual-critic v12)', () => {
  const RECYCLED = ['special-fireball-charge', 'special-uppercut', 'special-fireball-release']
  const BESPOKE = ['super-charge', 'super-charge-peak', 'super-release', 'super-release-2', 'super-recovery', 'super-recovery-2']
  const BESPOKE_ACTIVE = 'super-release'

  // (1) SOURCE lock — both energy supers derive the bespoke arc from their own
  //     timing, and neither carries any recycled cel through.
  it('deriveAttackClip builds the bespoke super arc from timing (Palm Barrage + Ion Storm)', () => {
    const palm = deriveAttackClip('super.P', { startup: 6, active: 8, recovery: 30 }, () => true)
    const storm = deriveAttackClip('super.storm', { startup: 8, active: 3, recovery: 34 }, () => true)
    expect(palm?.frames).toEqual(BESPOKE)
    expect(storm?.frames).toEqual(BESPOKE)
    // Density floor, held to the same metric the roster is scored by
    // (new Set(clips[].frames).size): the super is the first attack to reach the
    // SF3:3S unique-frame floor of 6. Asserted alongside the exact-list lock so a
    // revert to a thinner arc fails HERE too — the reason 6 matters is
    // self-documenting, not implicit in a frame-name list.
    expect(new Set(palm?.frames).size).toBeGreaterThanOrEqual(6)
    expect(new Set(storm?.frames).size).toBeGreaterThanOrEqual(6)
    for (const r of RECYCLED) {
      expect(palm?.frames ?? []).not.toContain(r)
      expect(storm?.frames ?? []).not.toContain(r)
    }
  })

  // (1b) Rollover: a playable skin whose atlas lacks the bespoke contact cel
  //      derives the RECYCLED arc at the same timing (byte-identical to the
  //      pre-bespoke manifest), so committing the bespoke shape never silently
  //      retimes an un-generated skin's super. It must NOT drop to null (clip
  //      dropped) nor leak a bespoke cel.
  it('a playable skin missing the bespoke contact cel rolls over to the recycled arc, same timing', () => {
    const bail = deriveAttackClip('super.P', { startup: 6, active: 8, recovery: 30 }, (c) => c !== BESPOKE_ACTIVE)
    expect(bail?.frames).toEqual(RECYCLED)
    expect(bail?.durations).toEqual([6, 8, 30])
    for (const b of BESPOKE) expect(bail?.frames ?? []).not.toContain(b)
    // warden's Ion Storm rolls over at its OWN timing, not the palm's.
    const storm = deriveAttackClip('super.storm', { startup: 8, active: 3, recovery: 34 }, (c) => c !== BESPOKE_ACTIVE)
    expect(storm?.frames).toEqual(RECYCLED)
    expect(storm?.durations).toEqual([8, 3, 34])
  })

  // (1c) Unplayable card art lacks even the recycled contact cel (special-uppercut),
  //      so it bails ALL the way to the static CLIPS.super const — the last-ditch
  //      recycled clip — rather than dropping the super entirely.
  it('card art lacking even the recycled contact cel bails to the static CLIPS.super', () => {
    const cardHas = (c: string) => c !== BESPOKE_ACTIVE && c !== 'special-uppercut'
    expect(deriveAttackClip('super.P', { startup: 6, active: 8, recovery: 30 }, cardHas)).toBeNull()
    expect(CLIPS.super.frames).toEqual(RECYCLED)
  })

  // (2) SHIPPED-REALITY rollover invariant across the whole playable roster.
  const superIdFor = (archetype: string): string => {
    const def = FIGHTERS[archetype]
    const sup = def ? Object.values(def.moves).find((m) => m.tag === 'super') : undefined
    return sup?.id ?? 'super.P'
  }
  interface SuperRow {
    skin: string
    archetype: string
    superId: string
    hasCel: boolean
    isBespoke: boolean
    celNames: string[]
    present: boolean
  }
  const superRows: SuperRow[] = ROSTER.map((entry) => {
    const A = SKINS[entry.skin]
    if (!A) return { skin: entry.skin, archetype: entry.archetype, superId: '', hasCel: false, isBespoke: false, celNames: [], present: false }
    const superId = superIdFor(entry.archetype)
    const clips = A.clips as unknown as Record<string, { frames: number[] } | undefined>
    const celNames = (clips[superId]?.frames ?? []).map((i) => A.frames[i]?.name ?? `#${i}`)
    const hasCel = A.frames.some((f) => f.name === BESPOKE_ACTIVE)
    const isBespoke = celNames.includes(BESPOKE_ACTIVE)
    return { skin: entry.skin, archetype: entry.archetype, superId, hasCel, isBespoke, celNames, present: true }
  })

  it('SUPER-WIRING TABLE', () => {
    const lines = superRows.map(
      (r) => `  ${r.skin.padEnd(9)} ${r.archetype.padEnd(9)} ${r.superId.padEnd(11)} ${(r.isBespoke ? 'BESPOKE' : 'recycled').padEnd(9)} [${r.celNames.join(', ')}]`,
    )
    // eslint-disable-next-line no-console
    console.log(`\nsuper-wiring map (shipped manifests):\n${lines.join('\n')}`)
    expect(superRows.length).toBe(ROSTER.length)
  })

  it('every skin is coherently EITHER bespoke-wired OR on the recycled fallback (no broken rollover)', () => {
    const broken = superRows.filter((r) => r.present && r.hasCel !== r.isBespoke)
    const detail = broken.map((r) =>
      r.hasCel
        ? `${r.skin}: atlas has ${BESPOKE_ACTIVE} but super clip is still recycled [${r.celNames.join(', ')}]`
        : `${r.skin}: super clip references ${BESPOKE_ACTIVE} but the atlas lacks that cel`,
    )
    expect(broken.map((r) => r.skin), `broken super rollover:\n  ${detail.join('\n  ')}`).toEqual([])
  })

  // Progress guard, RE-BASELINED to the exact set of faces that ship bespoke
  // super art, because a lone `bespoke.length > 0` is the one-member-of-a-set
  // blindness this file exists to kill: it stayed green while chesky alone was
  // bespoke and five faces silently ran the recycled trio. Pinning the WHOLE set
  // makes both failure modes red — a regression that drops a face back to
  // recycled (set shrinks) AND a premature/incorrect roll-over of a face that
  // must not have this super yet (set grows).
  //
  // The set is exactly the energy-projection archetypes: operator's Palm Barrage
  // (super.P) and warden's Ion Storm (super.storm), redrawn from each skin's own
  // stance — chesky + lenny (operator), doshi + turley (warden). The two vanguard
  // faces (spiegel, madhavan) are deliberately absent: Backbreaker is a command
  // GRAB, not a projectile, so wiring them to the projection arc would draw a
  // grappler firing a fireball. They stay coherently recycled until a bespoke
  // grab-super shape exists. Update this list (with art) when that lands; never
  // shrink it silently.
  const ENERGY_SUPER_SKINS = ['chesky', 'doshi', 'lenny', 'turley']
  it('exactly the energy-projection faces ship the bespoke super (whole-set pin, not one member)', () => {
    const bespoke = superRows.filter((r) => r.isBespoke).map((r) => r.skin).sort()
    expect(
      bespoke,
      `bespoke-super skins drifted from the expected energy-projection set (a drop = regression, an add = a face wired to a super it must not have yet)`,
    ).toEqual([...ENERGY_SUPER_SKINS].sort())
    // Anti-vacuity: the pinned set is non-empty, so an all-recycled revert (every
    // face flipped back at once) still reddens here, not just at the diff.
    expect(bespoke.length).toBeGreaterThan(0)
  })

  // Archetype-correctness, stated as the DURABLE structural rule independent of
  // which faces have shipped art yet: the bespoke arc is an energy PROJECTION,
  // valid only for operator (Palm Barrage) and warden (Ion Storm). No vanguard
  // skin may ever be wired to it — that is the specific "fireball from a
  // grappler" over-reach the deferral above guards against. The exact-set pin
  // would also catch it today, but this keeps the rule true even as the set
  // grows, and it is the assertion a future grappler-super author must
  // consciously confront rather than silently satisfy.
  it('no vanguard skin is wired to the energy-projection super (Backbreaker is a grab, not a projectile)', () => {
    const wrongArch = superRows.filter((r) => r.isBespoke && r.archetype === 'vanguard').map((r) => r.skin)
    expect(wrongArch, `vanguard skins wrongly wired to the projection super: ${wrongArch.join(', ')}`).toEqual([])
    // Dual side: every face we DO expect bespoke is an energy-projection archetype.
    const wrongExpected = ENERGY_SUPER_SKINS.filter((skin) => {
      const a = ROSTER.find((e) => e.skin === skin)?.archetype
      return a !== 'operator' && a !== 'warden'
    })
    expect(wrongExpected, `expected-bespoke skins that are NOT energy-projection archetypes: ${wrongExpected.join(', ')}`).toEqual([])
  })

  it('audited every choosable fighter against a real manifest (not a vacuous subset)', () => {
    const audited = superRows.filter((r) => r.present).map((r) => r.skin)
    const missing = ROSTER.filter((e) => !audited.includes(e.skin)).map((e) => e.skin)
    expect(missing, `choosable skins with no imported manifest (unaudited): ${missing.join(', ')}`).toEqual([])
    expect(audited.length).toBe(ROSTER.length)
  })
})
