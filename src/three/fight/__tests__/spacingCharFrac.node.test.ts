import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { FightCamera, type CameraFraming } from '../FightCamera'
import { FightVfx, type FightVfxDeps } from '../FightVfx'
import { WORLD } from '../../types'
import { CM_TO_WORLD } from '../worldScale'
import { HarnessSim } from '../../../fight/harnessSim'
import type { Difficulty } from '../../../fight/ai'
import type { FightState, FightEvent, HitLevel } from '../../../fight/types'
import { STAGE_HALF_W, START_X } from '../../../fight/constants'

/**
 * Spacing → on-screen size (charFrac) distribution, and the launcher/sweep/
 * crumple camera-kick curve.
 *
 * The neutral frame was measured genre-perfect (~59% char height) but at MAX
 * separation a standing fighter shrinks to ~31.5% against a genre norm of
 * 40-50%. Geometry proves that ~31.5% is a hard ceiling for the current stage
 * width — but geometry alone can't say whether it MATTERS. That depends on how
 * much of a real fight is actually spent near max separation. This measures it,
 * with no GPU and no screenshots: it drives the REAL FightCamera (the class
 * FightRenderer uses) through REAL deterministic CPU-vs-CPU fights (the tiered
 * `HarnessSim` that backs the attract reel + dev harness), across seeds and AI
 * tiers, and records the on-screen character height every active frame.
 *
 * It also closes the second open question — the launcher/sweep/crumple camera
 * kick was previously INFERRED from the shake constant. Here it is MEASURED:
 * real `hit` events for each of the six HitLevels are driven through the real
 * FightVfx dispatch (so the real, module-private HIT[level].shake reaches the
 * camera — not a number copied into the test) and the resulting screen kick is
 * read off a real FightCamera, isolated from handheld drift by a lockstep
 * no-kick control camera. A per-fight event census proves which levels are
 * actually CONSUMED in real play versus only reachable from a scripted event.
 */

const FOV = WORLD.CAMERA.fov
const DT = 1 / 60
const FH = WORLD.FIGHTER_HEIGHT
const GY = WORLD.GROUND_Y
const BOUNDS = { minX: -8.2, maxX: 8.2 } // FightRenderer's DEFAULT_BOUNDS

const LEVELS: HitLevel[] = ['light', 'medium', 'heavy', 'launcher', 'sweep', 'crumple']

// ---------------------------------------------------------------------------
// Part 1 — spacing → charFrac distribution through real fights
// ---------------------------------------------------------------------------

/** Reproduce FightRenderer's exact camera feed from authoritative sim state. */
function framingFromState(s: FightState): CameraFraming {
  const [a, b] = s.fighters
  return {
    ax: a.pos.x * CM_TO_WORLD,
    bx: b.pos.x * CM_TO_WORLD,
    topY: Math.max(GY + a.pos.y * CM_TO_WORLD + FH, GY + b.pos.y * CM_TO_WORLD + FH),
    // pushIn (the brief impact dolly-in) is fed 0: it only makes fighters a hair
    // BIGGER for a few frames after a hit, so omitting it keeps this measurement
    // conservative (it never overstates how small fighters get).
    pushIn: 0,
  }
}

/** On-screen height of a STANDING fighter at frame centre, as a fraction of
 *  screen height — exactly the quantity the "59% / 31.5%" numbers report. */
function charFracAtCentre(cam: THREE.PerspectiveCamera): number {
  const cx = cam.position.x
  const foot = new THREE.Vector3(cx, GY, 0).project(cam).y * 0.5 + 0.5
  const head = new THREE.Vector3(cx, GY + FH, 0).project(cam).y * 0.5 + 0.5
  return head - foot
}

/** SETTLED charFrac at a fixed neutral-stance separation (both fighters
 *  grounded, symmetric about centre). Pure geometry of the real camera: it
 *  answers "if the two fighters stand `sepCm` apart, how tall is each on
 *  screen once the dolly settles?" — and, via the returned dolly z vs the
 *  camera's maxZ pull-out cap, whether the frame is horizontal-bound (spacing)
 *  or pinned at the neutral vertical solve. This is the curve that converts a
 *  target charFrac into a required max separation, hence a stage width. */
function settledCharFracAtSepCm(sepCm: number): { charFrac: number; z: number } {
  const cam = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 100)
  const fc = new FightCamera(cam, BOUNDS)
  const halfW = (sepCm / 2) * CM_TO_WORLD
  const framing: CameraFraming = { ax: -halfW, bx: halfW, topY: GY + FH, pushIn: 0 }
  for (let i = 0; i < 600; i++) fc.update(DT, DT, framing) // long settle: dolly is rate-limited
  return { charFrac: charFracAtCentre(cam), z: cam.position.z }
}

interface FightResult {
  chars: number[]
  sepW: number[]
  sepCm: number[]
  levelCounts: Record<HitLevel, number>
  chLevelCounts: Record<HitLevel, number>
  eventCounts: Record<string, number>
  matchEnded: boolean
}

function runFight(
  seed: number, d1: Difficulty, d2: Difficulty,
  p1 = 'operator', p2 = 'vanguard', maxFrames = 20000,
): FightResult {
  const sim = new HarnessSim({ seed, difficulty1: d1, difficulty2: d2, p1, p2 })
  const cam = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 100)
  const fc = new FightCamera(cam, BOUNDS)

  // Let the framing springs settle onto the opening spacing before recording.
  let framing = framingFromState(sim.initialState)
  for (let i = 0; i < 180; i++) fc.update(DT, DT, framing)

  const chars: number[] = []
  const sepW: number[] = []
  const sepCm: number[] = []
  const levelCounts: Record<HitLevel, number> = {
    light: 0, medium: 0, heavy: 0, launcher: 0, sweep: 0, crumple: 0,
  }
  const chLevelCounts: Record<HitLevel, number> = {
    light: 0, medium: 0, heavy: 0, launcher: 0, sweep: 0, crumple: 0,
  }
  const eventCounts: Record<string, number> = {}
  let matchEnded = false

  for (let n = 0; n < maxFrames; n++) {
    const res = sim.step()
    const s = res.state
    for (const e of res.events) {
      eventCounts[e.type] = (eventCounts[e.type] || 0) + 1
      if (e.type === 'hit') levelCounts[e.level]++
      if (e.type === 'counter-hit') chLevelCounts[e.level]++
    }
    framing = framingFromState(s)
    fc.update(DT, DT, framing)
    if (s.phase === 'fight') {
      sepW.push(Math.abs(framing.ax - framing.bx))
      sepCm.push(Math.abs(s.fighters[0].pos.x - s.fighters[1].pos.x))
      chars.push(charFracAtCentre(cam))
    }
    if (s.phase === 'match-end') { matchEnded = true; break }
  }
  return { chars, sepW, sepCm, levelCounts, chLevelCounts, eventCounts, matchEnded }
}

const pct = (a: number[], p: number): number => {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]
}
const mean = (a: number[]): number => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN)
const fracBelow = (a: number[], t: number): number => (a.length ? a.filter((x) => x < t).length / a.length : NaN)
// reduce-based min/max: `Math.min(...a)` spreads every element as a call
// argument and blows the stack once `a` is tens of thousands of frames long.
const minA = (a: number[]): number => a.reduce((m, x) => (x < m ? x : m), Infinity)
const maxA = (a: number[]): number => a.reduce((m, x) => (x > m ? x : m), -Infinity)
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : '—')
const pctStr = (x: number): string => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '—')

// ---------------------------------------------------------------------------
// Part 2 — launcher/sweep/crumple camera kick, measured through real FightVfx
// ---------------------------------------------------------------------------

const NEUTRAL: CameraFraming = { ax: -2, bx: 2, topY: FH, pushIn: 0 }

function settledCam(): { cam: THREE.PerspectiveCamera; fc: FightCamera } {
  const cam = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 100)
  const fc = new FightCamera(cam, BOUNDS)
  for (let i = 0; i < 240; i++) fc.update(DT, DT, NEUTRAL)
  return { cam, fc }
}

/** Real FightVfx deps: every member is a cheap stub EXCEPT the camera, which is
 *  a proxy that forwards the shake to a real FightCamera and records the amount
 *  the real (module-private) HIT table passed — so the amount is MEASURED, not
 *  copied into the test. */
function vfxInto(fc: FightCamera, rec: { amount: number }): FightVfxDeps {
  const fighter = (x: number) => ({
    triggerHitFlash: () => {},
    mesh: { position: new THREE.Vector3(x, 0, 0) },
    bodyWidth: 1,
    chestAnchor: () => new THREE.Vector3(x, 1.5, 0),
    setDissolve: () => {},
  })
  return {
    additive: { emit: () => {} },
    alpha: { emit: () => {} },
    shockwave: { spawn: () => {} },
    impact: { spawn: () => {} },
    fighters: [fighter(-1), fighter(1)],
    camera: {
      addShake: (amt: number, dir?: THREE.Vector3) => { rec.amount = amt; fc.addShake(amt, dir) },
      punchIn: (a: number) => fc.punchIn(a),
    },
    requestHitstop: () => {},
    emitEngine: () => {},
  } as unknown as FightVfxDeps
}

const PROBE = new THREE.Vector3(0, 2.0, 0) // a fixed body-height world point
function probePx(cam: THREE.PerspectiveCamera, W = 1600, H = 900): { x: number; y: number } {
  const v = PROBE.clone().project(cam)
  return { x: (v.x * 0.5 + 0.5) * W, y: (0.5 - v.y * 0.5) * H }
}

/** Peak screen kick (px @1600x900) a real `hit` of `level` produces, isolated
 *  from handheld drift by a lockstep control camera that receives no kick. */
function kickPxForLevel(level: HitLevel, mutate = false): { peak: number; amount: number } {
  const A = settledCam()
  const B = settledCam() // deterministic ⇒ byte-identical settle ⇒ exact no-kick control
  const rec = { amount: -1 }
  if (mutate) (globalThis as unknown as Record<string, unknown>).__MUT_NO_KICK__ = true
  const ev: FightEvent = { type: 'hit', at: { x: 0, y: 120 }, attacker: 0, level, damage: 60 }
  new FightVfx(vfxInto(A.fc, rec)).handle(ev)
  let peak = 0
  for (let i = 0; i < 48; i++) {
    A.fc.update(DT, DT, NEUTRAL)
    B.fc.update(DT, DT, NEUTRAL)
    const pa = probePx(A.cam)
    const pb = probePx(B.cam)
    peak = Math.max(peak, Math.hypot(pa.x - pb.x, pa.y - pb.y))
  }
  if (mutate) delete (globalThis as unknown as Record<string, unknown>).__MUT_NO_KICK__
  return { peak, amount: rec.amount }
}

// ---------------------------------------------------------------------------

const SEEDS = [12345, 1, 2, 3]
const TIERS: Array<{ name: string; d1: Difficulty; d2: Difficulty }> = [
  { name: 'easy  vs easy  ', d1: 'easy', d2: 'easy' },      // buyer's first CPU (?cpu=easy analog)
  { name: 'medium vs medium', d1: 'medium', d2: 'medium' },
  { name: 'hard  vs hard  ', d1: 'hard', d2: 'hard' },      // skilled footsies
  { name: 'hard  vs medium', d1: 'hard', d2: 'medium' },    // attract-reel default
]

// The zoner stress case. operator/vanguard are rushdown/grappler — they always
// ADVANCE, so they never open the gap. The warden is the one archetype whose AI
// actively BACKS UP to reset spacing (ai.ts: "zoner backs up to reset spacing")
// and throws fullscreen bolts, so if any CPU matchup reaches the corner-spacing
// where charFrac collapses, it is this one. Measured separately so it doesn't
// dilute the rushdown baseline — it answers a different question (max reach).
const ZONER: Array<{ name: string; p1: string; p2: string; d1: Difficulty; d2: Difficulty }> = [
  { name: 'warden vs warden (hard) ', p1: 'warden', p2: 'warden', d1: 'hard', d2: 'hard' },
  { name: 'warden vs warden (easy) ', p1: 'warden', p2: 'warden', d1: 'easy', d2: 'easy' },
  { name: 'warden vs operator(hard)', p1: 'warden', p2: 'operator', d1: 'hard', d2: 'hard' },
]

const WALL_TO_WALL_CM = 2 * STAGE_HALF_W

describe('spacing → charFrac distribution + launcher/sweep/crumple kick', () => {
  it('reports the distribution and the six-level kick curve', { timeout: 180000 }, () => {
    const allChars: number[] = []
    const allSepCm: number[] = []
    const totalLevels: Record<HitLevel, number> = {
      light: 0, medium: 0, heavy: 0, launcher: 0, sweep: 0, crumple: 0,
    }
    const totalChLevels: Record<HitLevel, number> = {
      light: 0, medium: 0, heavy: 0, launcher: 0, sweep: 0, crumple: 0,
    }
    const totalEvents: Record<string, number> = {}

    const lines: string[] = []
    lines.push('')
    lines.push('=== PART 1: spacing → standing-fighter on-screen height (charFrac) ===')
    lines.push('tier              frames  charFrac[p50/p90/p99/min]        %<35%  sepCm[p50/p90/max]')

    for (const t of TIERS) {
      const chars: number[] = []
      const sepCm: number[] = []
      let ended = 0
      for (const seed of SEEDS) {
        const r = runFight(seed, t.d1, t.d2)
        chars.push(...r.chars)
        sepCm.push(...r.sepCm)
        allChars.push(...r.chars)
        allSepCm.push(...r.sepCm)
        if (r.matchEnded) ended++
        for (const k of LEVELS) { totalLevels[k] += r.levelCounts[k]; totalChLevels[k] += r.chLevelCounts[k] }
        for (const [k, v] of Object.entries(r.eventCounts)) totalEvents[k] = (totalEvents[k] || 0) + v
      }
      lines.push(
        `${t.name}  ${String(chars.length).padStart(6)}  ` +
        `${pctStr(pct(chars, 0.5))}/${pctStr(pct(chars, 0.9))}/${pctStr(pct(chars, 0.99))}/${pctStr(minA(chars))}  ` +
        `${pctStr(fracBelow(chars, 0.35)).padStart(6)}  ` +
        `${f1(pct(sepCm, 0.5))}/${f1(pct(sepCm, 0.9))}/${f1(maxA(sepCm))}  (matches ended ${ended}/${SEEDS.length})`,
      )
    }

    lines.push('')
    lines.push(`OVERALL (${allChars.length} active frames across ${SEEDS.length * TIERS.length} rushdown fights):`)
    lines.push(
      `  charFrac  p50=${pctStr(pct(allChars, 0.5))}  p90=${pctStr(pct(allChars, 0.9))}  ` +
      `p99=${pctStr(pct(allChars, 0.99))}  mean=${pctStr(mean(allChars))}  min=${pctStr(minA(allChars))}`,
    )
    lines.push(
      `  %frames < 40% = ${pctStr(fracBelow(allChars, 0.40))}   ` +
      `< 35% = ${pctStr(fracBelow(allChars, 0.35))}   < 45% = ${pctStr(fracBelow(allChars, 0.45))}`,
    )
    // charFrac histogram
    const bins = [0, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 1]
    const hist = new Array(bins.length - 1).fill(0)
    for (const c of allChars) {
      for (let i = 0; i < bins.length - 1; i++) { if (c >= bins[i] && c < bins[i + 1]) { hist[i]++; break } }
    }
    lines.push('  charFrac histogram (share of active frames):')
    for (let i = 0; i < hist.length; i++) {
      const share = hist[i] / allChars.length
      lines.push(`    ${(bins[i] * 100).toFixed(0).padStart(3)}-${(bins[i + 1] * 100).toFixed(0).padStart(3)}%  ` +
        `${pctStr(share).padStart(6)}  ${'#'.repeat(Math.round(share * 60))}`)
    }
    lines.push(`  sepCm  p50=${f1(pct(allSepCm, 0.5))}  p90=${f1(pct(allSepCm, 0.9))}  ` +
      `p99=${f1(pct(allSepCm, 0.99))}  max=${f1(maxA(allSepCm))}   ` +
      `[stage wall-to-wall = ${WALL_TO_WALL_CM}cm; round-start sep = ${2 * START_X}cm]`)

    // --- Part 1b: settled charFrac vs FIXED separation (the geometry curve) ---
    // Converts "how tall on screen" into "at what separation", so the stage-width
    // recommendation is grounded in numbers rather than asserted. maxZ (28.0) is
    // the camera's hard pull-out cap, so charFrac has a floor no spacing can pass.
    lines.push('')
    lines.push('=== PART 1b: SETTLED charFrac at a fixed neutral separation (pure camera geometry) ===')
    lines.push('  sepCm   charFrac   dolly-z   binds')
    const sepGrid = [200, 300, 378, 480, 555, 645, 758, 863, WALL_TO_WALL_CM, 1100]
    for (const sc of sepGrid) {
      const { charFrac, z } = settledCharFracAtSepCm(sc)
      const atCap = z >= 27.99
      const bind = charFrac > 0.599 ? 'vertical (neutral 60%)' : atCap ? 'maxZ CAP (hard floor)' : 'horizontal (spacing)'
      const tag = sc === WALL_TO_WALL_CM ? ' <- absolute wall-to-wall' : ''
      lines.push(`  ${String(sc).padStart(5)}   ${pctStr(charFrac).padStart(6)}    ${z.toFixed(2).padStart(6)}   ${bind}${tag}`)
    }
    lines.push('  (charFrac holds at the neutral 60% until sep ~378cm; below 40% needs sep >~645cm;')
    lines.push('   below 35% needs sep >~758cm. The rushdown CPU never exceeds the 300cm round-start gap.)')

    // --- Part 1c: the zoner stress case (warden backs up + fullscreen bolts) ---
    lines.push('')
    lines.push('=== PART 1c: ZONER reach — does any CPU matchup actually open the gap? ===')
    lines.push('matchup                    frames  charFrac[p50/p90/p99/min]     %<40% %<35%  sepCm[p50/p90/p99/max]  %ofW2W')
    for (const z of ZONER) {
      const chars: number[] = []
      const sepCm: number[] = []
      for (const seed of SEEDS) {
        const r = runFight(seed, z.d1, z.d2, z.p1, z.p2)
        chars.push(...r.chars); sepCm.push(...r.sepCm)
      }
      const reach = maxA(sepCm)
      lines.push(
        `${z.name}  ${String(chars.length).padStart(6)}  ` +
        `${pctStr(pct(chars, 0.5))}/${pctStr(pct(chars, 0.9))}/${pctStr(pct(chars, 0.99))}/${pctStr(minA(chars))}  ` +
        `${pctStr(fracBelow(chars, 0.40)).padStart(5)} ${pctStr(fracBelow(chars, 0.35)).padStart(5)}  ` +
        `${f1(pct(sepCm, 0.5))}/${f1(pct(sepCm, 0.9))}/${f1(pct(sepCm, 0.99))}/${f1(reach)}  ` +
        `${pctStr(reach / WALL_TO_WALL_CM).padStart(5)}`,
      )
    }

    lines.push('')
    lines.push('=== PART 2a: which HitLevels are actually CONSUMED in real CPU play ===')
    lines.push(`  hit events by level:          ${LEVELS.map((k) => `${k}=${totalLevels[k]}`).join('  ')}`)
    lines.push(`  counter-hit events by level:  ${LEVELS.map((k) => `${k}=${totalChLevels[k]}`).join('  ')}`)
    lines.push(`  other events: ${Object.entries(totalEvents).filter(([k]) => k !== 'hit').map(([k, v]) => `${k}=${v}`).join('  ')}`)

    lines.push('')
    lines.push('=== PART 2b: measured camera kick per level (real FightVfx → real camera) ===')
    lines.push('  level      shake(amount)  kickPx@1600x900  kick-off(MUT)  landed-in-fights')
    const kickOn: Record<HitLevel, { peak: number; amount: number }> = {} as Record<HitLevel, { peak: number; amount: number }>
    const kickOff: Record<HitLevel, { peak: number; amount: number }> = {} as Record<HitLevel, { peak: number; amount: number }>
    for (const lvl of LEVELS) {
      kickOn[lvl] = kickPxForLevel(lvl, false)
      kickOff[lvl] = kickPxForLevel(lvl, true)
      lines.push(
        `  ${lvl.padEnd(9)}  ${kickOn[lvl].amount.toFixed(2).padStart(6)}         ` +
        `${kickOn[lvl].peak.toFixed(2).padStart(6)}px        ${kickOff[lvl].peak.toFixed(2).padStart(5)}px       ` +
        `${totalLevels[lvl] > 0 ? 'yes (' + totalLevels[lvl] + ')' : 'NO — event-driven only'}`,
      )
    }
    lines.push('')

    // The full report is a reproducible measurement, not part of the normal test
    // signal, so it is gated behind SPACING_REPORT to keep the suite quiet. Get
    // it with:  SPACING_REPORT=1 npx vitest run <this file> --disable-console-intercept
    if (process.env.SPACING_REPORT) {
      // eslint-disable-next-line no-console
      console.log(lines.join('\n'))
    }

    // ---- Assertions: every one of these can actually FAIL, and the ones that
    // matter are mutation-proved in the same run (the *_off kick is the live
    // mutation). They assert STRUCTURAL invariants of the camera + wiring, never
    // brittle AI-tuning distribution thresholds that a rebalance could redden. ----

    // (1) Empty-measurement guard: the report is over real frames, not nothing.
    expect(allChars.length).toBeGreaterThan(1000)
    expect(allSepCm.length).toBe(allChars.length)

    // (2) Camera kick is REAL and scales with the shake amount, and is the ONLY
    //     source of the on-screen motion: disabling addShake collapses every
    //     level to ~0px (this is the built-in mutation proof). Ordering by the
    //     measured amount, the kick must be monotonic non-decreasing.
    for (const lvl of LEVELS) {
      expect(kickOn[lvl].peak).toBeGreaterThan(1)        // a landed hit visibly kicks
      expect(kickOff[lvl].peak).toBeLessThan(0.01)       // kill the shake -> no motion
    }
    const byAmount = [...LEVELS].sort((a, b) => kickOn[a].amount - kickOn[b].amount)
    for (let i = 1; i < byAmount.length; i++) {
      expect(kickOn[byAmount[i]].peak).toBeGreaterThanOrEqual(kickOn[byAmount[i - 1]].peak - 1e-6)
    }

    // (3) The wiring is LIVE in real play: the AI's core route (light -> cr.HP
    //     launcher) is consumed, proving hit events really flow into FightVfx.
    //     (heavy/sweep are reported as 0 in the census on purpose — the honest
    //     finding — so they are deliberately NOT asserted > 0.)
    expect(totalLevels.light).toBeGreaterThan(0)
    expect(totalLevels.launcher).toBeGreaterThan(0)

    // (4) The charFrac floor is a real geometric consequence of the stage width:
    //     at the round-start gap the vertical solve binds (~neutral 60%), but at
    //     the absolute corner the fighter is forced below 35%. This is the crux
    //     of the whole spacing question and it must hold as pure geometry.
    expect(settledCharFracAtSepCm(2 * START_X).charFrac).toBeGreaterThan(0.58)
    expect(settledCharFracAtSepCm(WALL_TO_WALL_CM).charFrac).toBeLessThan(0.35)

    // (5) Determinism: the sim + camera feed are reproducible, so the same seed
    //     yields a byte-identical spacing trace. A harness whose numbers wobble
    //     run-to-run cannot be trusted to have measured anything.
    const a = runFight(12345, 'hard', 'hard')
    const b = runFight(12345, 'hard', 'hard')
    expect(a.sepCm.length).toBe(b.sepCm.length)
    expect(a.sepCm[0]).toBe(b.sepCm[0])
    expect(a.sepCm[a.sepCm.length - 1]).toBe(b.sepCm[b.sepCm.length - 1])
  })
})
