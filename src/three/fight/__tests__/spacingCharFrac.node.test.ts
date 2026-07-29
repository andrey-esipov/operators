import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { FightCamera, type CameraFraming } from '../FightCamera'
import { FightVfx, type FightVfxDeps } from '../FightVfx'
import { WORLD } from '../../types'
import { CM_TO_WORLD } from '../worldScale'
import { HarnessSim } from '../../../fight/harnessSim'
import type { Difficulty } from '../../../fight/ai'
import type { FightState, FightEvent, HitLevel, FighterState } from '../../../fight/types'
import { STAGE_HALF_W, START_X } from '../../../fight/constants'

/**
 * Spacing → on-screen size (charFrac) distribution, and the launcher/sweep/
 * crumple camera-kick curve.
 *
 * Our neutral frame measures ~59% char height. At MAX separation a standing
 * fighter shrinks to ~31.5%. That ~31.5% was once dispatched as a deficit against
 * a "40-50% genre norm" — but that anchor is UNSOURCED 🔴: files/_reference-research.md:229
 * labels it verbatim "No published dev spec found", it is the 3S-specific NEUTRAL
 * figure (smallest of three games), and it was compared against our MAX-range
 * number (a category error). Treat 40-50% as an unanchored estimate, not a genre
 * spec. Geometry proves that ~31.5% is a hard ceiling for the current stage
 * width — but geometry alone can't say whether it MATTERS. That depends on how
 * much of a real fight is actually spent near max separation. This measures it,
 * with no GPU and no screenshots: it drives the REAL FightCamera + FightVfx
 * (FightRenderer.ts:118-119 construct them; :284 feeds vfx.handle(events), :653
 * calls camera.update) through REAL deterministic CPU-vs-CPU fights (the tiered
 * `HarnessSim` that backs the attract reel + dev harness), across seeds and AI
 * tiers, and records the on-screen character height every active frame.
 *
 * REACHABILITY (traced to the route table + URL, not the import edge — an
 * "X renders Y" edge proves Y CAN be reached, never that a buyer hits it):
 * FightCamera+FightVfx run inside FightRenderer, and FightRenderer is what the
 * TWO customer-facing fight surfaces mount — `route==='play'` → PlayableMatch
 * (App.tsx:214; PlayableMatch.tsx:140 `new FightRenderer`) reached by a matchup
 * URL/`?play=1`, and `route==='attract'` → AttractMode (App.tsx:206;
 * AttractMode.tsx:147 `new FightRenderer`). See appRoute.ts::decideRoute. This
 * harness therefore measures the SHIPPED camera. It does NOT touch FightScene3D
 * (the legacy card game behind `?cards=1`/`?lab=1`, a different camera path) —
 * which is correct: that is not the shipped fighter (FightScene3D.tsx:36).
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

// ---------------------------------------------------------------------------
// Beat classification — the "money shot" question. Every frame gets ONE
// dominant beat (most cinematic wins, mirroring the sim's own labelFor). The
// four MARQUEE beats are the frames a buyer screenshots; charFrac restricted to
// them decides whether the pulled-out small-frame regime is the money regime or
// the boring-neutral regime.
// ---------------------------------------------------------------------------
type Beat = 'ko' | 'super' | 'juggle' | 'heavy' | 'hit' | 'hitstun' | 'footsies' | 'neutral'
const MARQUEE_BEATS: ReadonlySet<Beat> = new Set<Beat>(['ko', 'super', 'juggle', 'heavy'])
interface FrameRec { cf: number; cfPushed: number; beat: Beat; marquee: boolean; contained: boolean }

/** The single most salient beat this frame. A launcher's payoff is the airborne
 *  `juggle`/`knockdown` window — a sustained money shot — so it is read from
 *  stance, not just the one launch frame. */
function dominantBeat(s: FightState, events: FightEvent[]): Beat {
  if (s.phase === 'ko' || events.some((e) => e.type === 'ko')) return 'ko'
  const [a, b] = s.fighters
  if (a.move?.id.startsWith('super') || b.move?.id.startsWith('super') || events.some((e) => e.type === 'super-flash')) return 'super'
  if (
    a.stance === 'juggle' || b.stance === 'juggle' || a.stance === 'knockdown' || b.stance === 'knockdown' ||
    events.some((e) => e.type === 'launch' || ((e.type === 'hit' || e.type === 'counter-hit') && e.level === 'launcher'))
  ) return 'juggle'
  if (events.some((e) => (e.type === 'hit' || e.type === 'counter-hit' || e.type === 'throw') && e.level === 'heavy')) return 'heavy'
  if (events.some((e) => e.type === 'hit' || e.type === 'counter-hit')) return 'hit'
  if (a.stance === 'hitstun' || b.stance === 'hitstun') return 'hitstun'
  return Math.abs(a.pos.x - b.pos.x) < 170 ? 'footsies' : 'neutral'
}

/** The fighter a screenshot of this beat is OF — used only for the in-frame
 *  containment guard (rule 1: never measure a subject that left the frame). */
function subjectIndex(s: FightState, events: FightEvent[], beat: Beat): 0 | 1 {
  for (const e of events) {
    if (e.type === 'ko') return e.who
    if (e.type === 'super-flash') return e.who
  }
  const [a, b] = s.fighters
  if (beat === 'ko') {
    if (a.stance === 'ko' || a.stance === 'defeat' || a.health <= 0) return 0
    if (b.stance === 'ko' || b.stance === 'defeat' || b.health <= 0) return 1
    return a.health <= b.health ? 0 : 1
  }
  if (beat === 'super') return a.move?.id.startsWith('super') ? 0 : 1
  if (beat === 'juggle') {
    if (a.stance === 'juggle' || a.stance === 'knockdown') return 0
    if (b.stance === 'juggle' || b.stance === 'knockdown') return 1
    for (const e of events) {
      if (e.type === 'launch') return (1 - e.attacker) as 0 | 1
      if ((e.type === 'hit' || e.type === 'counter-hit') && e.level === 'launcher') return (1 - e.attacker) as 0 | 1
    }
    return 0
  }
  for (const e of events) {
    if (e.type === 'hit' || e.type === 'counter-hit' || e.type === 'throw') return (1 - e.attacker) as 0 | 1
  }
  return 0
}

/** Whole-body (foot→head) containment of fighter `f` in the camera's NDC box. */
function fighterContained(cam: THREE.PerspectiveCamera, f: FighterState): boolean {
  const wx = f.pos.x * CM_TO_WORLD
  const fy = GY + f.pos.y * CM_TO_WORLD
  const foot = new THREE.Vector3(wx, fy, 0).project(cam)
  const head = new THREE.Vector3(wx, fy + FH, 0).project(cam)
  return Math.abs(foot.x) <= 1 && Math.abs(foot.y) <= 1 && Math.abs(head.x) <= 1 && Math.abs(head.y) <= 1
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
  frames: FrameRec[]
}

function runFight(
  seed: number, d1: Difficulty, d2: Difficulty,
  p1 = 'operator', p2 = 'vanguard', maxFrames = 20000,
  cinematic = false, held = false,
): FightResult {
  const sim = new HarnessSim({ seed, difficulty1: d1, difficulty2: d2, p1, p2 })
  const cam = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 100)
  const fc = new FightCamera(cam, BOUNDS)

  // Cinematic (marquee) mode drives a SECOND camera through the exact shipped
  // pipeline (FightRenderer._advance): a real FightVfx receives every sim event
  // and fires camera.punchIn() at the graded freeze-push sites (jab 0.15 …
  // heavy 0.5 … super 0.6 … KO 0.8, per FightVfx.ts), so the cine dolly-in that
  // d88862e wired is APPLIED, not invented. `cam` stays push-free as the built-in
  // control, so cfPushed (camCine) vs cf (cam) is the buy-back the freeze-push
  // earns — measured on ONE sim run. Faithful because in real-time play a sim
  // frame always advances, so kickDt=DT every frame (the "held" gap is capture-
  // only). The pushIn proximity channel (Engine.hitstopEnv*0.6, a ≤2.4% dolly) is
  // deliberately NOT modelled — there is no Engine wall clock here — which keeps
  // cfPushed conservative: it captures the dominant cine push and omits only a
  // small term that would make fighters a hair BIGGER.
  const camCine = cinematic ? new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 100) : null
  const fcCine = camCine ? new FightCamera(camCine, BOUNDS) : null
  const vfx = fcCine ? new FightVfx(vfxInto(fcCine, { amount: -1 })) : null

  // Let the framing springs settle onto the opening spacing before recording.
  let framing = framingFromState(sim.initialState)
  for (let i = 0; i < 180; i++) { fc.update(DT, DT, framing); fcCine?.update(DT, DT, framing) }

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
  const frames: FrameRec[] = []

  for (let n = 0; n < maxFrames; n++) {
    const res = sim.step()
    const s = res.state
    for (const e of res.events) {
      eventCounts[e.type] = (eventCounts[e.type] || 0) + 1
      if (e.type === 'hit') levelCounts[e.level]++
      if (e.type === 'counter-hit') chLevelCounts[e.level]++
    }
    framing = framingFromState(s)
    // Events first (they latch punchIn), then the cameras ramp — the order
    // FightRenderer._advance uses (vfx.handle in the step loop, camera.update
    // after). `cam` gets no events (push-free control); `camCine` gets the push.
    if (vfx) for (const e of res.events) vfx.handle(e)
    fc.update(DT, DT, framing)
    // held mode reproduces the FRAME-STEPPED CAPTURE path (screenshot / marketing
    // tools: PlayableMatch frozen, stepBudget gates advances). Between captured
    // frames the sim doesn't advance, so simSteps=0 → kickDt=0, HOLDING the cine
    // push at full through the freeze (the authored "hold"). LIVE real-time play
    // (held=false, the matrix) advances a sim frame every render tick — frame++ in
    // every sim branch incl. hitstop/superFreeze, and _advance uses RAW dt — so
    // kickDt=DT and the push punches on impact then bleeds across the freeze. That
    // live curve is what the buyer sees; the held curve is what a promo grab lands.
    const frozen = held && (s.hitstop > 0 || (s.superFreeze ?? 0) > 0)
    fcCine?.update(DT, frozen ? 0 : DT, framing)
    if (s.phase === 'fight') {
      sepW.push(Math.abs(framing.ax - framing.bx))
      sepCm.push(Math.abs(s.fighters[0].pos.x - s.fighters[1].pos.x))
      chars.push(charFracAtCentre(cam))
    }
    // Marquee census spans BOTH play and the KO freeze — the KO freeze is the
    // single most-screenshotted frame in the game and the old harness skipped
    // it entirely (it recorded only `phase === 'fight'`).
    if (s.phase === 'fight' || s.phase === 'ko') {
      const beat = dominantBeat(s, res.events)
      const subj = s.fighters[subjectIndex(s, res.events, beat)]
      const realCam = camCine ?? cam // the camera the buyer actually sees
      frames.push({
        cf: charFracAtCentre(cam),               // push-free control
        cfPushed: charFracAtCentre(realCam),     // WITH the shipped cine freeze-push
        beat,
        marquee: MARQUEE_BEATS.has(beat),
        contained: fighterContained(realCam, subj), // containment on the real camera
      })
    }
    if (s.phase === 'match-end') { matchEnded = true; break }
  }
  return { chars, sepW, sepCm, levelCounts, chLevelCounts, eventCounts, matchEnded, frames }
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
  it('reports the distribution and the six-level kick curve', { timeout: 300000 }, () => {
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

    // -----------------------------------------------------------------------
    // PART 3 — the decision the coordinator asked for: across ALL 6 archetype
    // pairings, is the pulled-out small-frame (sub-40/35%) regime the MONEY-SHOT
    // regime (super/KO/juggle/heavy) or the boring-neutral regime? charFrac
    // restricted to marquee frames decides it. Same real camera + real sim,
    // sim-frame (load-invariant), no GPU. Spans fight+KO-freeze phases.
    // -----------------------------------------------------------------------
    const PAIRS: Array<[string, string]> = [
      ['operator', 'operator'], ['operator', 'vanguard'], ['operator', 'warden'],
      ['vanguard', 'vanguard'], ['vanguard', 'warden'], ['warden', 'warden'],
    ]
    const MATRIX_TIERS: Array<{ d1: Difficulty; d2: Difficulty }> = [
      { d1: 'easy', d2: 'easy' }, { d1: 'medium', d2: 'medium' }, { d1: 'hard', d2: 'hard' },
    ]
    const perPair: Array<{ name: string; frames: FrameRec[] }> = []
    const matrix: FrameRec[] = []
    for (const [p1, p2] of PAIRS) {
      const pf: FrameRec[] = []
      for (const t of MATRIX_TIERS) for (const seed of SEEDS) {
        // cinematic=true: the marquee census must be taken WITH the shipped
        // freeze-push applied (d88862e), or it measures a camera that no longer
        // ships. cf (push-free) rides along as the built-in control.
        pf.push(...runFight(seed, t.d1, t.d2, p1, p2, 20000, true).frames)
      }
      perPair.push({ name: `${p1}/${p2}`, frames: pf })
      for (const r of pf) matrix.push(r)
    }

    const cfOf = (fr: FrameRec[]): number[] => fr.map((r) => r.cfPushed)  // FAITHFUL: WITH cine push
    const ctrlOf = (fr: FrameRec[]): number[] => fr.map((r) => r.cf)      // push-free control
    const BEATS: Beat[] = ['ko', 'super', 'juggle', 'heavy', 'hit', 'hitstun', 'footsies', 'neutral']
    const marqueeAll = matrix.filter((r) => r.marquee)
    const marqueeSeen = marqueeAll.filter((r) => r.contained) // subject actually in-frame
    const mcf = cfOf(marqueeSeen)      // pushed (faithful)
    const mctrl = ctrlOf(marqueeSeen)  // push-free control
    const buyback = mean(mcf) - mean(mctrl)

    const nMatches = PAIRS.length * MATRIX_TIERS.length * SEEDS.length
    lines.push(`=== PART 3: charFrac by BEAT across all 6 archetype pairings — the money-shot test ===`)
    lines.push(`  matrix: ${PAIRS.length} pairings x ${MATRIX_TIERS.length} tiers x ${SEEDS.length} seeds = ${nMatches} full matches, ${matrix.length} fight+KO frames`)
    lines.push(`  charFrac is WITH the shipped cinematic freeze-push (d88862e: FightVfx→camera.punchIn); "ctrl" = same frame, push-free.`)
    lines.push('  beat        frames   share    charFrac(push) p50/p90/p99/min      %<40%   %<35%   ctrl p50  subj-in-frame')
    for (const bt of BEATS) {
      const fr = matrix.filter((r) => r.beat === bt)
      if (!fr.length) { lines.push(`  ${bt.padEnd(9)}   (none in matrix)`); continue }
      const cf = cfOf(fr)
      const ct = ctrlOf(fr)
      const inFrame = fr.filter((r) => r.contained).length / fr.length
      lines.push(
        `  ${bt.padEnd(9)}  ${String(fr.length).padStart(6)}  ${pctStr(fr.length / matrix.length).padStart(6)}   ` +
        `${pctStr(pct(cf, 0.5))}/${pctStr(pct(cf, 0.9))}/${pctStr(pct(cf, 0.99))}/${pctStr(minA(cf))}`.padEnd(26) + '   ' +
        `${pctStr(fracBelow(cf, 0.40)).padStart(5)}   ${pctStr(fracBelow(cf, 0.35)).padStart(5)}   ${pctStr(pct(ct, 0.5)).padStart(5)}   ${pctStr(inFrame)}`,
      )
    }
    lines.push('')
    lines.push(
      `  MARQUEE (ko∪super∪juggle∪heavy): ${marqueeAll.length} frames; ` +
      `${marqueeSeen.length} with subject in-frame (${pctStr(marqueeSeen.length / Math.max(1, marqueeAll.length))}), ` +
      `${marqueeAll.length - marqueeSeen.length} off-frame`,
    )
    lines.push(
      `    charFrac WITH push (in-frame)  p50=${pctStr(pct(mcf, 0.5))}  p90=${pctStr(pct(mcf, 0.9))}  p99=${pctStr(pct(mcf, 0.99))}  ` +
      `mean=${pctStr(mean(mcf))}  min=${pctStr(minA(mcf))}   %<40%=${pctStr(fracBelow(mcf, 0.40))}  %<35%=${pctStr(fracBelow(mcf, 0.35))}`,
    )
    lines.push(
      `    push-free control (in-frame)  p50=${pctStr(pct(mctrl, 0.5))}  mean=${pctStr(mean(mctrl))}  min=${pctStr(minA(mctrl))}` +
      `   → cine push buys back ${buyback * 100 >= 0 ? '+' : ''}${(buyback * 100).toFixed(1)} pts (mean) on marquee frames`,
    )

    // The decider: what ARE the small frames? If they are super/ko/juggle, the
    // money shot renders small; if they are neutral/footsies, nobody screenshots
    // them and this is cosmetically irrelevant.
    for (const th of [0.40, 0.35]) {
      const small = matrix.filter((r) => r.cfPushed < th) // small AFTER the cine push (the real camera)
      const parts = BEATS.map((bt) => `${bt}=${pctStr(small.filter((r) => r.beat === bt).length / Math.max(1, small.length))}`)
      const mShare = small.filter((r) => r.marquee).length / Math.max(1, small.length)
      lines.push('')
      lines.push(`  Composition of the ${small.length} frames BELOW ${(th * 100).toFixed(0)}% WITH push  (marquee share = ${pctStr(mShare)}):`)
      lines.push(`    ${parts.join('  ')}`)
    }

    lines.push('')
    lines.push('  per-pairing        frames   cf(push) p50/p90/min     %<40% %<35%   marquee push p50/min  mrq %<35%  ctrl p50')
    for (const p of perPair) {
      const cf = cfOf(p.frames)
      const seen = p.frames.filter((r) => r.marquee && r.contained)
      const mc = cfOf(seen)
      const mctl = ctrlOf(seen)
      lines.push(
        `  ${p.name.padEnd(17)}  ${String(p.frames.length).padStart(6)}   ` +
        `${pctStr(pct(cf, 0.5))}/${pctStr(pct(cf, 0.9))}/${pctStr(minA(cf))}`.padEnd(20) + '  ' +
        `${pctStr(fracBelow(cf, 0.40)).padStart(5)} ${pctStr(fracBelow(cf, 0.35)).padStart(5)}   ` +
        `${pctStr(pct(mc, 0.5))}/${pctStr(minA(mc))}`.padEnd(18) + '  ' + `${pctStr(fracBelow(mc, 0.35)).padStart(6)}` + '   ' + `${pctStr(pct(mctl, 0.5))}`,
      )
    }
    lines.push('')

    // -----------------------------------------------------------------------
    // FOLLOW-UP — warden/warden per-beat split, to test the critic's
    // PRE-REGISTERED falsifier (committed blind, before this data existed):
    //   "if warden super p50 < 45%, 'push-in saves supers' is false → escalate."
    // Emitted RAW and left to fall — deliberately NOT converted into an
    // expect(super>=45%): tuning a gate toward a pre-registered number is the
    // masquerade this project bans, and the coordinator asked to let it fall.
    // Same cinematic WITH-push matrix frames, restricted to the zoner mirror.
    // Size stats are over IN-FRAME frames only (rule 1: never measure a subject
    // that left the crop); the total/in-frame split rides alongside so a low
    // containment rate can't masquerade as a real charFrac.
    // -----------------------------------------------------------------------
    const wFrames = perPair.find((p) => p.name === 'warden/warden')?.frames ?? []
    lines.push('=== FOLLOW-UP: warden/warden per-beat split (zoner mirror, WITH cine push, in-frame) ===')
    lines.push('  beat        total   in-frame  charFrac(push) p50/p90/p99/min      %<40%   %<35%   ctrl p50')
    for (const bt of BEATS) {
      const all = wFrames.filter((r) => r.beat === bt)
      const seen = all.filter((r) => r.contained)
      if (!seen.length) { lines.push(`  ${bt.padEnd(9)}  ${String(all.length).padStart(6)}   (none in-frame)`); continue }
      const cf = cfOf(seen)
      const ct = ctrlOf(seen)
      lines.push(
        `  ${bt.padEnd(9)}  ${String(all.length).padStart(6)}  ${pctStr(seen.length / all.length).padStart(7)}   ` +
        `${pctStr(pct(cf, 0.5))}/${pctStr(pct(cf, 0.9))}/${pctStr(pct(cf, 0.99))}/${pctStr(minA(cf))}`.padEnd(26) + '   ' +
        `${pctStr(fracBelow(cf, 0.40)).padStart(5)}   ${pctStr(fracBelow(cf, 0.35)).padStart(5)}   ${pctStr(pct(ct, 0.5)).padStart(5)}`,
      )
    }

    const wSuperAll = wFrames.filter((r) => r.beat === 'super')
    const wSuperSeen = wSuperAll.filter((r) => r.contained)
    const wSuperP50 = pct(cfOf(wSuperSeen), 0.5)
    const wKoSeen = wFrames.filter((r) => r.beat === 'ko' && r.contained)
    const enoughSupers = wSuperSeen.length >= 20 // below this the p50 is noise, not a verdict
    lines.push('')
    lines.push(
      `  > FALSIFIER (critic, pre-registered blind): warden super p50 = ${pctStr(wSuperP50)} ` +
      `over ${wSuperSeen.length}/${wSuperAll.length} in-frame super frames — ` +
      `${!enoughSupers ? 'INSUFFICIENT (n<20): cannot adjudicate from this matrix alone'
        : wSuperP50 >= 0.45 ? 'PASS (>=45%): push-in-saves-supers survives its own falsifier'
        : 'FALSIFIED (<45%): escalate per the committed criterion'}`,
    )
    lines.push(`    (warden KO p50 = ${pctStr(pct(cfOf(wKoSeen), 0.5))} over ${wKoSeen.length} in-frame KO frames)`)

    const wSmall = wFrames.filter((r) => r.cfPushed < 0.35 && r.contained)
    const wParts = BEATS.map((bt) => `${bt}=${pctStr(wSmall.filter((r) => r.beat === bt).length / Math.max(1, wSmall.length))}`)
    lines.push(`  warden sub-35% composition (${wSmall.length} in-frame frames): ${wParts.join('  ')}`)

    // The coordinator's sharpest worry: does the beat classifier tag 'super'
    // frames BEFORE punchIn ramps in, so the split measures a push that hasn't
    // fired? Prove it can't hide by measuring held-vs-live ON SUPERS ONLY:
    // 'super' is read from move.id starting 'super' (the whole move, not one
    // flash frame), so we sample the entire ramp→peak→bleed curve; if the push
    // were absent the held and live medians would coincide. held > live is
    // positive proof the cine push is present on super frames (the capture path
    // holds its peak; live bleeds it). Aggregated over SEEDS @ hard for volume.
    const wardenSuper = (heldMode: boolean): number[] => {
      const out: number[] = []
      for (const seed of SEEDS) {
        out.push(...runFight(seed, 'hard', 'hard', 'warden', 'warden', 20000, true, heldMode)
          .frames.filter((r) => r.beat === 'super' && r.contained).map((r) => r.cfPushed))
      }
      return out
    }
    const wsLive = wardenSuper(false)
    const wsHeld = wardenSuper(true)
    lines.push(
      `  warden super push-timing check: live p50 ${pctStr(pct(wsLive, 0.5))} (${wsLive.length} fr) ` +
      `-> capture-held p50 ${pctStr(pct(wsHeld, 0.5))} (${wsHeld.length} fr)  ` +
      `[held > live => push IS firing on supers; live merely bleeds it]`,
    )
    lines.push('')

    // ---- Built-in mutation proof that the freeze-push is APPLIED and material:
    // the SAME fight, cine ON vs cine OFF (the code's own __MUT_NO_CINE__ hook,
    // which nulls camera.punchIn's dolly and leaves the impact kick intact). ON
    // must buy back real screen height on marquee frames; OFF must collapse to the
    // push-free control. This isolates the d88862e cine push from everything else,
    // so a regression that silently unwires punchIn reddens here with a live delta.
    const avg = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)
    const cineDelta = (mutate: boolean): { delta: number; pushed: number; ctrl: number; n: number } => {
      if (mutate) (globalThis as unknown as Record<string, unknown>).__MUT_NO_CINE__ = true
      const seen = runFight(4242, 'hard', 'hard', 'vanguard', 'vanguard', 20000, true)
        .frames.filter((r) => r.marquee && r.contained)
      if (mutate) delete (globalThis as unknown as Record<string, unknown>).__MUT_NO_CINE__
      const pushed = avg(seen.map((r) => r.cfPushed))
      const ctrl = avg(seen.map((r) => r.cf))
      return { delta: pushed - ctrl, pushed, ctrl, n: seen.length }
    }
    const cineOn = cineDelta(false)
    const cineOff = cineDelta(true)
    lines.push(`  CINE-PUSH MUTATION (vanguard mirror, seed 4242, ${cineOn.n} marquee-in-frame frames):`)
    lines.push(
      `    cine ON : pushed ${pctStr(cineOn.pushed)} vs control ${pctStr(cineOn.ctrl)}` +
      `  → buy-back ${cineOn.delta * 100 >= 0 ? '+' : ''}${(cineOn.delta * 100).toFixed(2)} pts`,
    )
    lines.push(
      `    cine OFF: pushed ${pctStr(cineOff.pushed)} vs control ${pctStr(cineOff.ctrl)}` +
      `  → buy-back ${cineOff.delta * 100 >= 0 ? '+' : ''}${(cineOff.delta * 100).toFixed(2)} pts  (~0 expected: push disabled)`,
    )
    lines.push('')

    // Live play vs frame-stepped capture: the authored freeze-"hold" only manifests
    // on the capture path (screenshots/marketing), where the push holds at full; in
    // live play it punches then bleeds. The captured money-shot is therefore >= the
    // live number. This only moves the needle where the marquee sits lowest — the
    // warden (zoner) mirror — so measure held vs live there and at a shoto mirror.
    const heldVsLive = (p1: string, p2: string): { live: number; held: number; n: number } => {
      const liveF = runFight(7, 'hard', 'hard', p1, p2, 20000, true, false).frames.filter((r) => r.marquee && r.contained)
      const heldF = runFight(7, 'hard', 'hard', p1, p2, 20000, true, true).frames.filter((r) => r.marquee && r.contained)
      return { live: pct(liveF.map((r) => r.cfPushed), 0.5), held: pct(heldF.map((r) => r.cfPushed), 0.5), n: liveF.length }
    }
    const wm = heldVsLive('warden', 'warden')
    const sm = heldVsLive('operator', 'operator')
    lines.push('  CAPTURE-HELD vs LIVE marquee p50 (authored freeze-hold only holds on the capture/screenshot path):')
    lines.push(`    warden/warden    : live ${pctStr(wm.live)}  → capture-held ${pctStr(wm.held)}   (${wm.n} marquee-in-frame)`)
    lines.push(`    operator/operator: live ${pctStr(sm.live)}  → capture-held ${pctStr(sm.held)}   (${sm.n} marquee-in-frame)`)
    lines.push('')

    // The full report is a reproducible measurement, not part of the normal test
    // signal, so it is gated behind SPACING_REPORT to keep the suite quiet. Get
    // it with:  SPACING_REPORT=1 npx vitest run <this file> --disable-console-intercept
    if (process.env.SPACING_REPORT) {
      // eslint-disable-next-line no-console
      console.log(lines.join('\n'))
    }

    // ---- Assertions: every one of these can actually FAIL, and the ones that
    // matter are mutation-proved in the same run (TWO live mutations: the *_off
    // kick, and cine ON/OFF via __MUT_NO_CINE__). They assert STRUCTURAL invariants
    // of the camera + wiring, never brittle AI-tuning distribution thresholds that
    // a rebalance could redden. ----

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
    const a = runFight(12345, 'hard', 'hard', 'operator', 'vanguard', 20000, true)
    const b = runFight(12345, 'hard', 'hard', 'operator', 'vanguard', 20000, true)
    expect(a.sepCm.length).toBe(b.sepCm.length)
    expect(a.sepCm[0]).toBe(b.sepCm[0])
    expect(a.sepCm[a.sepCm.length - 1]).toBe(b.sepCm[b.sepCm.length - 1])
    // the per-frame beat trace AND the cine-pushed charFrac are deterministic too
    // (same seed ⇒ same sim ⇒ same events ⇒ same FightVfx push ⇒ byte-identical).
    expect(a.frames.length).toBe(b.frames.length)
    expect(a.frames[a.frames.length - 1]?.cf).toBe(b.frames[b.frames.length - 1]?.cf)
    expect(a.frames[a.frames.length - 1]?.cfPushed).toBe(b.frames[b.frames.length - 1]?.cfPushed)

    // (6) PART 3 anti-vacuity (rule 1 — the one that has burned this project):
    //     the marquee measurement is over REAL, IN-FRAME money-shot frames, not
    //     nothing. A crop that stopped containing the fighter, or a beat map that
    //     silenced supers, collapses these. All can fail.
    expect(matrix.length).toBeGreaterThan(20000)          // the 72-match matrix actually ran
    expect(marqueeAll.length).toBeGreaterThan(500)        // supers/KOs/juggles occur in CPU play
    expect(marqueeSeen.length).toBeGreaterThan(300)       // and their subject is genuinely framed
    //     containment is plausible, not degenerate: most marquee subjects are in
    //     frame (a broken beat/subject/containment map would collapse this ratio).
    expect(marqueeSeen.length / marqueeAll.length).toBeGreaterThan(0.6)
    //     each headline marquee beat is exercised at least once across the roster
    //     (if a future change silences supers or KOs, this reddens by name).
    for (const bt of ['ko', 'super', 'juggle'] as Beat[]) {
      expect(matrix.some((r) => r.beat === bt), `no ${bt} frames anywhere in the matrix`).toBe(true)
    }

    // (7) The shipped cinematic freeze-push is APPLIED and MATERIAL on marquee
    //     frames in LIVE play, and it is the punchIn/cine code that produces it —
    //     proved by the __MUT_NO_CINE__ mutation in the SAME run: ON buys back real
    //     screen height, OFF collapses to the push-free control. The live buy-back
    //     is deliberately small (~0.6 pt): the push punches then bleeds across the
    //     freeze (kickDt=DT every live tick) AND is clamped by zKeep at the ~60%
    //     close range where money shots land. Thresholds track that measured
    //     reality, NOT the unsourced "15-30%" in cameraFreezeShot.test.ts (flagged,
    //     not inherited). Without this gate Part 3 would silently measure the
    //     pre-d88862e camera — the exact error the coordinator caught.
    expect(cineOn.n).toBeGreaterThan(20)                        // the focused fight had money shots
    expect(cineOn.delta).toBeGreaterThan(0.003)                 // live cine push buys back real height
    expect(cineOff.delta).toBeLessThan(0.001)                   // disabling it collapses the buy-back
    expect(cineOn.delta).toBeGreaterThan(cineOff.delta + 0.003) // ON strictly beats OFF
    //     and the same buy-back holds in aggregate across the whole matrix, and the
    //     push never SHRINKS the median money shot.
    expect(buyback).toBeGreaterThan(0.002)
    expect(pct(mcf, 0.5)).toBeGreaterThanOrEqual(pct(mctrl, 0.5))

    // (8) The capture path HOLDS the push (kickDt=0 in the freeze), so a captured
    //     money-shot is strictly LARGER than the live one, and the hold does real
    //     work where it matters most (the low-marquee warden mirror it lifts to
    //     ~35% — the low end of an unanchored 🔴 max-range estimate, NOT a genre
    //     spec; see _reference-research.md:229 — and a shoto money shot to ~67%).
    //     STRICT (> live + margin), not >=, so a held mode that silently stopped
    //     holding — collapsing held back to live — reddens here instead of passing.
    expect(wm.n).toBeGreaterThan(20)
    expect(wm.held).toBeGreaterThan(wm.live + 0.01) // warden mirror: hold lifts the money shot
    expect(sm.held).toBeGreaterThan(sm.live + 0.02) // shoto mirror: hold punches in hard

    // (9) FOLLOW-UP anti-vacuity (the critic's pre-registered warden-super
    //     falsifier). The zoner mirror throws ZERO supers in CPU sim — warden's
    //     Ion Storm (super.storm) is an AI combo-tail, and the zoning mirror
    //     rarely lands the combo that fires it — so a super p50 is genuinely
    //     unmeasurable here. We therefore assert the beat that ACTUALLY carries
    //     warden's small-frame money shot (the KO) is measured and non-vacuous,
    //     and DELIBERATELY assert no super threshold: rendering a verdict on <20
    //     super frames would be the exact "checked 0" lie rule 1 bans (the report
    //     prints INSUFFICIENT instead). If a future roster change makes the zoner
    //     mirror throw real supers, the report surfaces them; nothing here fakes
    //     a green. These guard the numbers the write-up rests on and can fail:
    //     drop the warden pairing and both collapse.
    expect(wFrames.length).toBeGreaterThan(1000) // the zoner mirror actually ran
    expect(wKoSeen.length).toBeGreaterThan(100)  // its KO money shot is measured (~2588 seen), not empty
  })
})
