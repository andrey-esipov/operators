import { describe, it, expect } from 'vitest'
import type { QualityTier } from '../../types'
import { qualityRank, QUALITY_ORDER } from '../../types'
import {
  QualityAdaptor,
  affordablePixelRatio,
  DEFAULT_ADAPT,
  TARGET_RENDER_PIXELS,
} from '../QualityAdaptor'

// ────────────────────────────────────────────────────────────────────────────
// Deterministic gate for the runtime quality policy.
//
// PROXY UNDER TEST: "given a synthetic frame-time series, does the controller
// demote the right amount within a bounded WALL-CLOCK time?" This is a pure
// function of its input arrays — no GPU, no Engine, no wall clock, no box load —
// so it is load-invariant where a measured-fps gate is not. (This project has
// already killed one "performance gate cosplaying as a hang-guard"; a gate whose
// verdict moves with co-tenant CPU is worthless.)
//
// WHY THE FAILURE MODE CANNOT SATISFY IT:
//  • The bug being fixed is a FRAME-COUNT warmup (90 frames), whose reaction
//    time balloons as fps falls — 90 frames is ~15s at 6fps. `reactsInBoundedTime`
//    asserts the FIRST demotion lands in wall-clock ms regardless of fps, so the
//    old logic (≥9000ms at 6fps even with the 100ms clamp) fails it. A gate that
//    only asserted "eventually demotes" would pass the buggy code — this one can't.
//  • Anti-vacuity: `neverDemotesHealthy` proves the controller is capable of
//    NOT demoting, so a mutant that just always-demotes is caught, not rewarded.
//    Without it, every "does it demote?" assertion is satisfiable by demote-always.
//
// Mutation-proved (before→after, each restored byte-identical; full log in the
// commit message):
//   ratchet fix —
//     bootGraceMs 1000→0            BOOT EXCLUSION goes red (boot stall scored → demote @1066ms)
//     discontinuityMs 1000→1e9      lone 5s frame scored → catastrophic demote @7016ms
//     `frameMs>=0` → `>=-1e12`      negative delta counted → spurious promote (0→1)
//     promoteBelowMs 17.5→0         REVERSIBLE goes red (recovery never fires, 0 promotes)
//     `locked` disabled             OSCILLATION CAP goes red (12 promotes vs bound 8)
//   pre-existing (still bite) —
//     windowMs 900→90_000           reaction bound red; catastrophicMs→Infinity un-floors the
//     jump; dropping the sqrt in affordablePixelRatio reddens the Retina cap (1.109 vs <1.1).
// ────────────────────────────────────────────────────────────────────────────

interface Action { t: number; kind: 'demote' | 'promote'; from: QualityTier; to: QualityTier; reason?: string; reactionMs?: number }

/**
 * Drive a fresh series of `fps` frames for `durationMs` of simulated time,
 * applying each demotion/promotion to the running tier. `frameMs` is the
 * UNCLAMPED wall-clock delta — exactly what `Engine.frame` now hands the adaptor
 * (`runAdapt(now, wallDtMs)`). The Engine still clamps `rawDt` to 100ms for the
 * SIM, but the adaptor sees the true delta so it can tell a genuinely slow frame
 * apart from an unmeasurable gap. A 6fps series therefore feeds 166.7ms frames,
 * not the old 100ms clamp value.
 */
function simulate(adaptor: QualityAdaptor, fps: number, durationMs: number, startTier: QualityTier) {
  const frameMs = 1000 / fps
  let tier = startTier
  const actions: Action[] = []
  for (let t = 0; t <= durationMs + 1e-6; t += frameMs) {
    const a = adaptor.sample(t, frameMs, tier)
    if (a.kind !== 'none') {
      actions.push({ t: +t.toFixed(1), kind: a.kind, from: a.from, to: a.to, reason: (a as { reason?: string }).reason, reactionMs: +((a as { reactionMs?: number }).reactionMs ?? 0).toFixed(1) })
      tier = a.to
    }
  }
  return { tier, actions }
}

/**
 * Drive an explicit list of [frameMs, count] segments back-to-back, tracking the
 * running tier and every action. Lets a test compose a boot stall, a slow
 * stretch and a healthy recovery in one continuous wall-clock timeline — which
 * `simulate` (one fixed fps) can't express.
 */
function feed(adaptor: QualityAdaptor, segments: [number, number][], startTier: QualityTier) {
  let tier = startTier
  let t = 0
  const actions: Action[] = []
  for (const [frameMs, count] of segments) {
    for (let i = 0; i < count; i++) {
      t += frameMs
      const a = adaptor.sample(t, frameMs, tier)
      if (a.kind !== 'none') {
        actions.push({ t: +t.toFixed(1), kind: a.kind, from: a.from, to: a.to, reason: (a as { reason?: string }).reason, reactionMs: +((a as { reactionMs?: number }).reactionMs ?? 0).toFixed(1) })
        tier = a.to
      }
    }
  }
  return { tier, actions, endT: t }
}

/**
 * Stress ONE tier boundary repeatedly: a slow burst (enough for one demotion)
 * then a healthy burst (enough for one promotion), `cycles` times, after clearing
 * the boot grace. Returns how many promotions fired — the oscillation-cap metric.
 * With the cap, re-entry into a repeatedly-failing tier stops and the count stays
 * small; without it, a promotion fires every cycle.
 */
function flap(adaptor: QualityAdaptor, cycles: number, startTier: QualityTier) {
  let tier = startTier
  let t = 0
  let promotes = 0
  let demotes = 0
  const slowMs = 1000 / 30
  const step = (ms: number, n: number) => {
    for (let i = 0; i < n; i++) {
      t += ms
      const a = adaptor.sample(t, ms, tier)
      if (a.kind === 'promote') { promotes++; tier = a.to }
      else if (a.kind === 'demote') { demotes++; tier = a.to }
    }
  }
  step(1000 / 60, 120) // clear the boot grace with health
  for (let c = 0; c < cycles; c++) {
    step(slowMs, 40)     // ~1.3s slow → one demotion
    step(1000 / 60, 260) // ~4.3s healthy → one promotion (> promoteWindowMs)
  }
  return { tier, promotes, demotes }
}

describe('QualityAdaptor — demotion policy', () => {
  it('anti-vacuity: a healthy 60fps series NEVER demotes (from ultra or high)', () => {
    for (const start of ['ultra', 'high'] as QualityTier[]) {
      const { tier, actions } = simulate(new QualityAdaptor(), 60, 6000, start)
      expect(actions).toEqual([])
      expect(tier).toBe(start)
    }
  })

  it('anti-vacuity: 55fps (just under the 60 cap, above the 45 floor) does NOT demote', () => {
    // 55fps ≈ 18.2ms < demoteAboveMs (22.2). A gate that demoted here would be
    // punishing an essentially-fine frame rate.
    const { actions } = simulate(new QualityAdaptor(), 55, 6000, 'ultra')
    expect(actions).toEqual([])
  })

  it('sustained 30fps demotes exactly ONE tier per step (a walk, not a leap)', () => {
    // 33.3ms is below 45fps but not catastrophic, so we step down conservatively
    // rather than dumping straight to the floor.
    const adaptor = new QualityAdaptor()
    const { actions } = simulate(adaptor, 30, DEFAULT_ADAPT.bootGraceMs + DEFAULT_ADAPT.windowMs * 1.5 + 5, 'ultra')
    expect(actions.length).toBeGreaterThanOrEqual(1)
    expect(actions[0]).toMatchObject({ from: 'ultra', to: 'high', reason: 'slow' })
    // exactly one tier of movement in the first window
    expect(qualityRank(actions[0].from) - qualityRank(actions[0].to)).toBe(1)
  })

  it('30fps eventually walks ultra→…→low, one tier at a time', () => {
    const { tier, actions } = simulate(new QualityAdaptor(), 30, DEFAULT_ADAPT.bootGraceMs + DEFAULT_ADAPT.windowMs * 5, 'ultra')
    expect(tier).toBe('low')
    // Every hop is a single tier — never a multi-tier jump on a merely-slow read.
    for (const a of actions) expect(qualityRank(a.from) - qualityRank(a.to)).toBe(1)
    expect(actions.every((a) => a.reason === 'slow')).toBe(true)
  })

  it('a catastrophic 6fps series JUMPS straight to the floor in a single action', () => {
    const adaptor = new QualityAdaptor()
    const { tier, actions } = simulate(adaptor, 6, 4000, 'ultra')
    expect(actions[0]).toMatchObject({ from: 'ultra', to: 'low', reason: 'catastrophic' })
    expect(tier).toBe('low')
    // ONE action reaches the floor — not the three a per-tier walk would need.
    expect(actions.filter((a) => a.to === 'low').length).toBe(1)
    expect(actions.length).toBe(1)
  })

  it('REGRESSION GUARD: reaction time is wall-clock-bounded, NOT frame-count-bounded', () => {
    // The whole point of the original fix. At 6fps the old 90-frame warmup could
    // not react before 90×frame = 9000ms+. Boot exclusion now adds a FIXED
    // wall-clock offset (bootGraceMs) before the first decision — the SAME offset
    // at every fps, which is itself the proof the delay is not frame-count-based.
    // Past that, reactionMs (elapsed since the window armed) is ~one window
    // regardless of fps, so a ~1-window bound reddens the old 90-frame logic hard.
    for (const fps of [6, 10, 20]) {
      const frameMs = 1000 / fps
      const { actions } = simulate(new QualityAdaptor(), fps, 4000, 'ultra')
      expect(actions.length).toBeGreaterThanOrEqual(1)
      expect(actions[0].reactionMs!).toBeLessThan(DEFAULT_ADAPT.windowMs + 3 * frameMs)
      expect(actions[0].t).toBeLessThan(DEFAULT_ADAPT.bootGraceMs + DEFAULT_ADAPT.windowMs + 3 * frameMs)
    }
  })

  it('respects a time-based warmup: no demotion before one window of data', () => {
    // Feed a catastrophic rate but stop just short of windowMs — a transient sub-
    // window spike must not trigger a demotion.
    const adaptor = new QualityAdaptor()
    const { actions } = simulate(adaptor, 6, DEFAULT_ADAPT.windowMs - 150, 'ultra')
    expect(actions).toEqual([])
  })

  it('the floor is terminal: at low, a catastrophic series emits no demotion', () => {
    const adaptor = new QualityAdaptor()
    const { tier, actions } = simulate(adaptor, 6, 5000, 'low')
    expect(tier).toBe('low')
    expect(actions).toEqual([])
  })

  it('enforces a cooldown: successive demotions are ≥ windowMs apart', () => {
    const { actions } = simulate(new QualityAdaptor(), 30, DEFAULT_ADAPT.bootGraceMs + DEFAULT_ADAPT.windowMs * 5, 'ultra')
    for (let i = 1; i < actions.length; i++) {
      expect(actions[i].t - actions[i - 1].t).toBeGreaterThanOrEqual(DEFAULT_ADAPT.windowMs - 1e-3)
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// The ratchet fix. The first cut of this controller shipped a one-way downward
// fuse: a ~900ms boot stall (shader compile + atlas upload) read as catastrophic
// and floored the tier at t≈1s, and there was NO promotion path, so sixty
// seconds of locked 60fps on a 4090 never recovered a single tier. These gates
// pin the three mechanisms that make it adaptation again — and each is
// mutation-proved (see the run log in the commit message).
//
// WHY THE FAILURE MODE CANNOT SATISFY THEM:
//  • `bootStallThenHealthy…` demotes NOTHING despite a solid slow boot stretch —
//    a mutant that scores boot samples (bootGraceMs→0) emits a catastrophic
//    demote and reddens it. A gate that only checked the FINAL tier would be
//    fooled once promotion exists (it would recover), so this asserts NO demote
//    action ever fired, which the promotion path cannot paper over.
//  • `unmeasurableSampleNotCatastrophic` feeds a 5s frame among healthy ones;
//    scoring it (discontinuityMs→∞) floors the tier. Discarding it is the only
//    way the assertion holds.
//  • `demotionIsReversible` FORCES a real post-boot collapse to the floor, then
//    proves sustained health climbs all the way back to the boot tier — the
//    property whose absence WAS the bug. Removing the promote branch
//    (promoteBelowMs→0) leaves it pinned at the floor.
//  • Anti-vacuity: `deadBandNeitherPromotesNorDemotes` proves promotion is not a
//    disguised always-promote, and `promotionNeverExceedsBootTier` proves the
//    detector's ceiling is respected. Without them a "does it recover?" assertion
//    is satisfiable by promote-always.
// ────────────────────────────────────────────────────────────────────────────
describe('QualityAdaptor — recovery, validity & boot exclusion (the ratchet fix)', () => {
  const fast = 1000 / 60 // 16.67ms — a healthy vsync-locked frame

  it('BOOT EXCLUSION: a slow boot stall followed by sustained 60fps demotes NOTHING', () => {
    // The reviewer's own repro, inverted. ~900ms of 6.7fps (the compile/upload
    // transient) then 3s of locked 60fps. The boot stretch is discarded, so the
    // tier is never touched. (Mutant bootGraceMs→0 scores the stall → a
    // catastrophic demote appears and this reddens.)
    const { tier, actions } = feed(new QualityAdaptor(), [
      [150, 6],       // 6 frames × 150ms ≈ 900ms boot stall (shader compile)
      [fast, 180],    // ~3s sustained healthy 60fps
    ], 'ultra')
    expect(actions).toEqual([])
    expect(tier).toBe('ultra')
  })

  it('UNMEASURABLE ≠ CATASTROPHIC: a lone multi-second frame is discarded, not scored', () => {
    // A 5s tab-restore/GC pause among healthy frames. Its wall-delta (5000ms) is
    // unmeasurable, not slow — discarded, never scored. (Mutant discontinuityMs→∞
    // scores it → the window collapses to that one giant sample → catastrophic
    // demote to the floor, and this reddens.)
    const { tier, actions } = feed(new QualityAdaptor(), [
      [fast, 120],    // ~2s healthy, clears the boot grace
      [5000, 1],      // one 5s frame — a pause, not sustained render load
      [fast, 120],    // ~2s healthy again
    ], 'ultra')
    expect(actions.filter((a) => a.kind === 'demote')).toEqual([])
    expect(tier).toBe('ultra')
  })

  it('UNMEASURABLE ≠ CATASTROPHIC: a negative frame delta is discarded and re-arms the promote window', () => {
    // Model the real event faithfully: rAF `now` marches FORWARD, but the reported
    // DELTA is negative because lastTime was left on the virtual step clock ahead
    // of wall time (measured -336ms). If such a sample entered the window it would
    // both corrupt the median AND fail to re-arm — so a promotion could fire on a
    // window that never actually held sustained health. Discarding it re-arms the
    // promote clock. (Mutant: widen the `frameMs >= 0` guard to admit negatives and
    // the promote fires early → this reddens. The discontinuity test can't catch
    // that mutation because it only exercises the upper half of the same guard.)
    const a = new QualityAdaptor()
    let t = 0
    let tier: QualityTier = 'ultra'
    let promotes = 0
    const drive = (frameMs: number, n: number) => {
      const adv = frameMs >= 0 ? frameMs : fast // a negative DELTA never rewinds `now`
      for (let i = 0; i < n; i++) {
        t += adv
        const act = a.sample(t, frameMs, tier)
        if (act.kind === 'promote') { promotes++; tier = act.to }
        else if (act.kind === 'demote') tier = act.to
      }
    }
    drive(fast, 90)      // clear the boot grace (healthy, no-op at ultra)
    drive(1000 / 8, 60)  // ~7.5s @8fps → genuine collapse to the floor
    expect(tier).toBe('low') // promotion is now structurally possible (ceiling 'ultra')
    drive(fast, 150)     // ~2.5s healthy — approaches, but < promoteWindowMs(3000)
    drive(-336, 1)       // the negative-delta frame
    drive(fast, 40)      // only ~0.67s more health after it
    // Correct: the negative re-armed the window, so 0.67s < 3000ms ⇒ NO promote.
    // If it had been counted, ~3.2s of accumulated window would have promoted.
    expect(promotes).toBe(0)
    expect(tier).toBe('low')
  })

  it('REVERSIBLE: a post-boot collapse floors the tier, then sustained 60fps climbs back to the boot tier', () => {
    // FORCE the exact defect scenario — a real sustained collapse that reaches
    // the floor — then hold a long healthy window and prove every tier comes
    // back. This is the property whose absence was the bug.
    const { tier, actions } = feed(new QualityAdaptor(), [
      [fast, 90],     // ~1.5s healthy — clear the boot grace cleanly
      [1000 / 8, 60], // ~7.5s at 8fps — a genuine catastrophic collapse → floor
      [fast, 1800],   // ~30s of locked 60fps — the "60s never recovers" window
    ], 'ultra')
    const demotes = actions.filter((a) => a.kind === 'demote')
    const promotes = actions.filter((a) => a.kind === 'promote')
    expect(demotes.length).toBeGreaterThanOrEqual(1)
    expect(promotes.length).toBeGreaterThanOrEqual(1)
    // Fully recovered to the boot tier — not stuck one below, not stuck at floor.
    expect(tier).toBe('ultra')
    // Recovery is a WALK: every promotion is a single tier, mirroring demotion.
    for (const p of promotes) expect(qualityRank(p.to) - qualityRank(p.from)).toBe(1)
  })

  it('ANTI-VACUITY: a 50fps dead-band series neither promotes nor demotes', () => {
    // 50fps = 20ms sits between the promote line (17.5) and the demote line
    // (22.2). Even with headroom to promote (we sit at medium under an ultra
    // ceiling), a merely-OK rate must NOT be read as an invitation to climb —
    // otherwise "does it recover?" would be satisfiable by always-promote.
    const a = new QualityAdaptor()
    feed(a, [[fast, 90], [1000 / 8, 60]], 'ultra') // collapse ultra → low first
    // now climb is possible (low, ceiling ultra); feed the dead band from 'low'
    const { tier, actions } = feed(a, [[1000 / 50, 400]], 'low')
    expect(actions).toEqual([])
    expect(tier).toBe('low')
  })

  it('CEILING: promotion never climbs above the boot tier the detector chose', () => {
    // Boot at 'high' and run absurdly healthy (120fps). Adaptation restores
    // toward the boot choice but must never SECOND-GUESS it upward.
    const { tier, actions } = simulate(new QualityAdaptor(), 120, 30_000, 'high')
    expect(tier).toBe('high')
    expect(actions.filter((a) => a.kind === 'promote')).toEqual([])
  })

  it('OSCILLATION CAP: a repeatedly-failing tier stops being re-entered, so it settles', () => {
    // Alternate a slow burst (one demote) with a healthy burst (one promote) at
    // the same boundary, many times. The cap stops promoting back into a tier
    // that keeps failing, so the number of promotions is bounded far below the
    // cycle count instead of flapping once per cycle forever.
    const { promotes } = flap(new QualityAdaptor(), 12, 'ultra')
    expect(promotes).toBeLessThanOrEqual(QUALITY_ORDER.length * DEFAULT_ADAPT.maxSlowDemotesPerTier)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// The cap DECAY. `slowDemotes` only ever climbs during adaptive play (reset()
// fires solely on an EXTERNAL quality set — exactly when adaptation is off), and
// the shipped Engine is a persistent shell that lives the whole session, so
// without decay any two slow demotes per tier — from ANY cause: two supers, a GC
// pause, an atlas decode, an alt-tab under discontinuityMs — pin the promote path
// at the floor for the rest of the session, silently, with nothing flapping. The
// cap is anti-FLAP memory, not a lifetime ceiling; capDecayMs of sustained CALM
// (no slow demote from any tier) forgives one demote per tier.
//
// WHY THE FAILURE MODE CANNOT SATISFY THESE:
//  • `permanentLockIsBroken` FORCES the real defect — two full slow-walks to the
//    floor, so every crossed tier hits the cap — then proves a calm interval
//    climbs all the way back, and that the climb could NOT have started until a
//    full capDecayMs of calm had passed. Disabling decay (capDecayMs→∞) leaves it
//    pinned at low and reddens both the recovery and the timing assertion.
//  • `calmIsRequired` locks every tier with two full walks to the floor, then
//    holds a calm window SHORTER than capDecayMs and proves the tier is still
//    pinned at the floor — no decay, no promotion. A mutant that decays every
//    frame (capDecayMs→0) forgives the locks inside that window and it climbs back
//    to ultra → this reddens. It is the anti-flap direction, independent of the
//    70s OSCILLATION CAP flap above.
//  • `spacedTransientsDoNotAccumulate` fires three isolated blips each separated
//    by more than capDecayMs; because each is forgiven before the next, the count
//    never reaches the cap and every recovery succeeds. Without decay the blips
//    stack to a lock on the second one and the third recovery never fires — so a
//    strict count of full recoveries reddens the mutant.
//  • `aPauseIsNotCalm` locks the floor, then spends the capDecayMs interval inside
//    a single 35s discontinuity frame followed by only ~5s of real health. The
//    discard must RESTART the calm clock — a backgrounded tab is not proof of a
//    machine that can hold the tier — so the lock holds. A mutant that drops the
//    clock restart lets paused wall-time forgive the lock and the tier leaves the
//    floor → this reddens.
// ────────────────────────────────────────────────────────────────────────────
describe('QualityAdaptor — oscillation-cap decay (the permanent-lock fix)', () => {
  const fast = 1000 / 60   // 16.67ms — healthy vsync-locked frame
  const slow = 1000 / 30   // 33.3ms — below the 45fps demote floor, not catastrophic

  it('PERMANENT LOCK BROKEN: two slow-walks to the floor lock every tier, then sustained calm climbs back', () => {
    // Walk ultra→low once (each tier demoted once, count 1), recover to ultra,
    // then walk to low AGAIN (count 2 per tier — the cap is now hit on every
    // tier). Under the old monotonic cap this is the permanent-low pin. A long
    // calm window must decay the caps and let it fully recover.
    const { tier, actions } = feed(new QualityAdaptor(), [
      [fast, 90],     // ~1.5s boot grace, healthy
      [slow, 170],    // ~5.7s @30fps: slow-walk ultra→high→medium→low (counts → 1)
      [fast, 780],    // ~13s @60fps: recover low→…→ultra (counts stay 1)
      [slow, 170],    // ~5.7s @30fps: slow-walk to low AGAIN (counts → 2, LOCKED)
      [fast, 3000],   // ~50s @60fps: > capDecayMs, then the full climb back
    ], 'ultra')
    // Fully recovered — not pinned at the floor, not stuck one tier below.
    expect(tier).toBe('ultra')
    // The lock was real: the second walk bottomed out at low.
    const lowDemotes = actions.filter((a) => a.kind === 'demote' && a.to === 'low')
    expect(lowDemotes.length).toBeGreaterThanOrEqual(2)
    // And the climb back could NOT have begun until a full decay interval of calm
    // had elapsed since that bottom — proof it was the decay, not some faster path.
    const bottom = lowDemotes[lowDemotes.length - 1].t
    const backToUltra = actions.filter((a) => a.kind === 'promote' && a.to === 'ultra')
    expect(backToUltra.length).toBeGreaterThanOrEqual(1)
    expect(backToUltra[backToUltra.length - 1].t - bottom).toBeGreaterThanOrEqual(DEFAULT_ADAPT.capDecayMs)
  })

  it('CALM IS REQUIRED: a lock held by two walks survives a calm window shorter than capDecayMs', () => {
    // Walk to the floor twice (every tier demoted twice → every tier locked),
    // then hold calm for LESS than capDecayMs. No decay fires, so every promote
    // stays capped and the tier is pinned at the floor — it cannot even take the
    // first step back to medium. (Mutant capDecayMs→0 forgives the locks during
    // this window and it climbs back to ultra → this reddens.) The long-calm
    // recovery that SHOULD eventually happen is D1; this is the anti-flap half.
    const { tier, actions } = feed(new QualityAdaptor(), [
      [fast, 90],     // boot
      [slow, 170],    // walk ultra→low (counts → 1)
      [fast, 780],    // recover to ultra (counts stay 1)
      [slow, 170],    // walk to low AGAIN (counts → 2, every tier LOCKED)
      [fast, 900],    // ~15s calm — deliberately < capDecayMs(30s): no decay
    ], 'ultra')
    // Still pinned at the floor: the locks have not been forgiven.
    expect(tier).toBe('low')
    // Sanity that the two-walk setup was real — the mid recovery did reach ultra.
    expect(actions.filter((a) => a.kind === 'promote' && a.to === 'ultra').length).toBe(1)
  })

  it('SPACED TRANSIENTS DO NOT ACCUMULATE: blips > capDecayMs apart never stack to a lock', () => {
    // Three isolated slow blips, each followed by more than capDecayMs of health.
    // Every blip is forgiven before the next, so the count never reaches the cap
    // and all three recoveries succeed. (Mutant capDecayMs→∞ makes the count
    // monotonic → the second blip locks ultra → the third recovery never fires.)
    const { tier, actions } = feed(new QualityAdaptor(), [
      [fast, 90],     // boot
      [slow, 45], [fast, 2160],   // blip 1 + ~36s health (> capDecayMs): decays, recovers
      [slow, 45], [fast, 2160],   // blip 2 + ~36s health
      [slow, 45], [fast, 2160],   // blip 3 + ~36s health
    ], 'ultra')
    expect(tier).toBe('ultra')
    // All three round-trips completed: three demotes out of ultra, three back in.
    expect(actions.filter((a) => a.kind === 'demote' && a.from === 'ultra').length).toBe(3)
    expect(actions.filter((a) => a.kind === 'promote' && a.to === 'ultra').length).toBe(3)
  })

  it('A PAUSE IS NOT CALM: a discontinuity restarts the decay clock, so backgrounded time cannot forgive a lock', () => {
    // Lock every tier (two walks to low), let a little healthy time pass — but far
    // under capDecayMs — then feed ONE 35s discontinuity frame (a tab-restore /
    // long GC pause) followed by only ~5s of health. The wall clock is now well
    // past capDecayMs since the last demote, but that span was a PAUSE, not calm
    // rendering: the discard must restart the calm clock, so the lock still holds
    // and the tier stays pinned at the floor. (Mutant: drop the clock restart on
    // the discontinuity branch → the paused wall-time counts as calm, the lock is
    // forgiven and the tier climbs off the floor → this reddens.)
    const { tier } = feed(new QualityAdaptor(), [
      [fast, 90],     // boot
      [slow, 170],    // walk ultra→low (counts → 1)
      [fast, 780],    // recover to ultra (counts stay 1)
      [slow, 170],    // walk to low AGAIN (counts → 2, every tier LOCKED)
      [fast, 120],    // ~2s healthy — well under capDecayMs, no decay yet
      [35000, 1],     // one 35s frame: a pause/tab-restore, discarded as unmeasurable
      [fast, 300],    // ~5s health AFTER the pause — the only genuinely-calm span
    ], 'ultra')
    // Still pinned: only ~5s of real calm has elapsed since the pause, not 30s.
    expect(tier).toBe('low')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// SCRIPTED-TRANSIENT DISCARD (supers/cinematics excluded from the demote
// decision, but their cost RECORDED — never swallowed).
//
// The money-moment defect: a super frame sits above the 45fps demote line for
// most of a ~1s freeze, so the adaptor demotes MID-SUPER — and (source-proven)
// the super VFX reads no quality tier, so that demotion buys ZERO frame-time
// back and then rides the persistent Engine for the rest of the session. The fix
// marks such frames `isTransient` and discards them from the DECISION, exactly
// like a discontinuity — while RECORDING their cost so "supers cost N ms here"
// stays a fact (`transientCostReport`), not a blind spot we built on purpose.
//
// Four-way mutation map (the source lever is the single line `if (isTransient)`
// in sample(); each mutant restored byte-identical):
//   A  capable machine + flagged super          ⇒ NO demote      (tier holds)
//   B  SAME cost but UNFLAGGED (real slow play)  ⇒ STILL demotes  (scoped, not blanket)
//   M1 flag-everything  `if (isTransient)`→`if (true)`   ⇒ B reds (real slow play stops demoting)
//   M2 ignore-flag      `if (isTransient)`→`if (false)`  ⇒ A reds (the super demotes again)
// B is the load-bearing half: it proves we did NOT build a suppression that
// swallows a genuinely slow machine. Two observability tests then prove the cost
// is recorded at full magnitude while moving no tier — discarded ≠ unmeasured.
// ────────────────────────────────────────────────────────────────────────────
describe('QualityAdaptor — scripted-transient discard (the mid-super demote fix)', () => {
  const fast = 1000 / 60      // ~16.67ms — healthy
  const superFrame = 1000 / 24 // ~41.67ms — a heavy but MEASURABLE super frame:
                               // above demoteAboveMs (22.2), below catastrophicMs
                               // (50), far below discontinuityMs (1000).

  // Like `feed`, but each segment carries an explicit `isTransient` flag — the
  // one boolean the Engine passes from the render state (super freeze / cinematic).
  function feedFlagged(
    adaptor: QualityAdaptor,
    segments: [number, number, boolean][],
    startTier: QualityTier,
  ) {
    let tier = startTier
    let t = 0
    const actions: Action[] = []
    for (const [frameMs, count, transient] of segments) {
      for (let i = 0; i < count; i++) {
        t += frameMs
        const a = adaptor.sample(t, frameMs, tier, transient)
        if (a.kind !== 'none') {
          actions.push({ t: +t.toFixed(1), kind: a.kind, from: a.from, to: a.to, reason: (a as { reason?: string }).reason })
          tier = a.to
        }
      }
    }
    return { tier, actions, endT: t }
  }

  it('A — a FLAGGED super does not demote, even sustained well past a demote window', () => {
    const a = new QualityAdaptor()
    const { tier } = feedFlagged(a, [
      [fast, 90, false],       // boot: clear grace + arm the window with health
      [superFrame, 60, true],  // ~2.5s of >demote-line frames, FLAGGED as a super
      [fast, 60, false],       // ~1s health after
    ], 'ultra')
    // Discarded from the DECISION: the super never enters the scored window, so a
    // capable machine keeps its tier through the money moment. (M2 `if (false)`
    // scores them → slow demote → tier leaves ultra → this reddens.)
    expect(tier).toBe('ultra')
  })

  it('B — the SAME cost UNFLAGGED still demotes: the discard is scoped, not a blanket super exemption', () => {
    const a = new QualityAdaptor()
    const { tier, actions } = feedFlagged(a, [
      [fast, 90, false],        // boot
      [superFrame, 60, false],  // SAME frame cost, but UNFLAGGED — a genuinely slow machine
    ], 'ultra')
    // The controller MUST still protect framerate in real gameplay. This is the
    // proof we didn't build a suppression that swallows a slow box. (M1 `if (true)`
    // discards these too → no demote → this reddens.)
    expect(actions.some((x) => x.kind === 'demote')).toBe(true)
    expect(qualityRank(tier)).toBeLessThan(qualityRank('ultra'))
    // …and nothing was mis-booked as transient cost — these were real frames.
    expect(a.transientCostReport().count).toBe(0)
  })

  it('records the discarded super cost at full magnitude while moving no tier (discarded ≠ unmeasured)', () => {
    const a = new QualityAdaptor()
    const { tier } = feedFlagged(a, [
      [fast, 90, false],
      [superFrame, 60, true],
      [fast, 30, false],
    ], 'ultra')
    expect(tier).toBe('ultra') // not acted upon
    const report = a.transientCostReport()
    expect(report.count).toBe(60)                 // every flagged frame observed
    expect(report.maxMs).toBeCloseTo(superFrame, 5)
    expect(report.p90Ms).toBeCloseTo(superFrame, 5)
    expect(report.lastMs).toBeCloseTo(superFrame, 5)
  })

  it('discards even a catastrophic-magnitude super spike, yet still surfaces its cost', () => {
    const a = new QualityAdaptor()
    const spike = 80 // > catastrophicMs (50): UNFLAGGED this would jump STRAIGHT to the floor
    const { tier } = feedFlagged(a, [
      [fast, 90, false],
      [spike, 40, true],  // ~3.2s of 80ms frames, FLAGGED
      [fast, 60, false],
    ], 'ultra')
    // The discard covers the catastrophic branch too — a super that blows the
    // budget entirely still must not floor the session.
    expect(tier).toBe('ultra')
    // But "this machine can't render supers" is exactly the fact we must NOT hide:
    // record it so someone can act on it (e.g. build per-tier super VFX).
    const report = a.transientCostReport()
    expect(report.maxMs).toBe(80)
    expect(report.count).toBe(40)
  })

  it('a PAUSE during a super is UNMEASURABLE, not super cost — discontinuity must win over the transient discard', () => {
    // Gates the ordering the class comment (property 5 / sample block 1.5) only
    // ASSERTS: block (1) discontinuity runs BEFORE block (1.5) transient. A
    // discontinuity-magnitude frame (GC pause, alt-tab, shader stall) that happens
    // to land while a super is flagged must be treated as unmeasurable — NOT
    // booked as "what a super costs." If the two blocks are ever reordered (the
    // obvious refactor: hoist the cheap boolean check up front), the pause gets
    // recorded and silently poisons transientCostReport — the ONE channel that
    // answers "can this machine render supers at all," which nothing else can see.
    // The telemetry built to catch a silent failure would itself fail silently.
    const a = new QualityAdaptor()
    const pause = 1500 // >= discontinuityMs (1000): unmeasurable by definition

    // Non-vacuity: a MEASURABLE flagged super frame IS recorded (recording works)...
    a.sample(100, superFrame, 'ultra', true)
    expect(a.transientCostReport().count, 'a measurable flagged frame must be recorded').toBe(1)

    // ...but a discontinuity-magnitude flagged frame must leave the count UNCHANGED:
    // caught by the validity/discontinuity guard first, discarded unrecorded.
    a.sample(100 + pause, pause, 'ultra', true)
    const report = a.transientCostReport()
    expect(report.count, 'a pause flagged transient must NOT be booked as super cost').toBe(1)
    expect(report.maxMs, 'the unmeasurable pause must not inflate the recorded super max').toBe(superFrame)
  })
})

describe('affordablePixelRatio — fill-aware cap', () => {
  it('defuses the 1080p Retina catastrophe: caps well under 2.0 (near 1.0)', () => {
    const pr = affordablePixelRatio(1920, 1080, 2, 1.5)
    expect(pr).toBeLessThan(1.1)
    expect(pr).toBeGreaterThanOrEqual(1.0)
    // and the whole point — the rendered pixel count lands at/under the budget.
    expect(1920 * 1080 * pr * pr).toBeLessThanOrEqual(TARGET_RENDER_PIXELS * 1.02)
  })

  it('is a no-op on a non-Retina panel (deviceDpr 1 ⇒ exactly 1.0)', () => {
    expect(affordablePixelRatio(1920, 1080, 1, 1.5)).toBe(1)
    expect(affordablePixelRatio(2560, 1440, 1, 1.5)).toBe(1)
  })

  it('lets a SMALL high-DPI viewport spend more (few CSS px ⇒ ratio up to the tier cap)', () => {
    const pr = affordablePixelRatio(800, 600, 2, 1.5)
    expect(pr).toBeGreaterThan(1.0)
    expect(pr).toBeLessThanOrEqual(1.5) // tier cap binds, never exceeded
  })

  it('never renders below native: a huge viewport floors at 1.0, not below', () => {
    expect(affordablePixelRatio(3840, 2160, 2, 1.5)).toBe(1)
    expect(affordablePixelRatio(5120, 2880, 2, 1.5)).toBe(1)
  })

  it('is monotonic: a larger viewport never gets a larger ratio', () => {
    const sizes: [number, number][] = [[800, 600], [1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]]
    let prev = Infinity
    for (const [w, h] of sizes) {
      const pr = affordablePixelRatio(w, h, 2, 1.5)
      expect(pr).toBeLessThanOrEqual(prev + 1e-9)
      prev = pr
    }
  })

  it('never exceeds the tier cap even when the budget would allow it', () => {
    // Tiny viewport, generous budget — the tier cap (1.0 for low) must still bind.
    expect(affordablePixelRatio(320, 240, 2, 1.0)).toBe(1)
  })
})
