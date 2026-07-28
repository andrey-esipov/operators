import { describe, expect, it } from 'vitest'
import type { FighterAssets } from '../../../fight/types'
import { FIGHTERS } from '../../../fight/fighters'
import { ROSTER } from '../../../fighthud/select/roster'
import { resolveFrame } from '../AnimationDriver'

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
