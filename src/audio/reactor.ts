/**
 * FightAudioReactor — turns simulation events into fight audio.
 *
 * This is the missing seam. The renderer already translates the sim's event
 * list into VFX through `FightVfx.handle(e)`; this class is the exact audio
 * mirror of that, so a hit that sparks also cracks, a whiff that the sim emits
 * *specifically for audio* finally swings, and a counter-hit lands with a
 * distinctive, meatier sound.
 *
 * Three design rules, all inherited from the VFX side:
 *
 *  1. **The sim stays pure.** Nothing in `src/fight/**` imports audio. This
 *     reactor lives in `src/audio/` and consumes the same read-only
 *     `FightEvent[]` the VFX consumes — dropping an event can never desync the
 *     simulation, and the sim never knows audio exists.
 *  2. **No backend dependency.** The reactor talks to a `FightAudioSink`
 *     interface, never to `fightAudio` directly. The live game passes a sink
 *     backed by the real Web-Audio engine; the offline audiolab passes a sink
 *     that renders the same catalog sounds into an `OfflineAudioContext`, so
 *     what a headless script MEASURES is exactly the mapping the game plays.
 *  3. **No per-frame allocation.** `handle()` and `step()` do integer/float
 *     comparisons and fixed method calls only — no arrays, no objects built in
 *     the hot path. The one small `ImpactOpts` literal per *event* is fine
 *     (events are rare); the per-*frame* `step()` path allocates nothing.
 *
 * Everything here is imperative and synchronous. It must never throw: a thrown
 * audio error in the render loop would break the ~25 headless capture tools
 * that drive the game. The reactor keeps its own logic total (every switch arm
 * is covered) and trusts the sink to swallow backend failures.
 */

import type { FightEvent, FightState, HitLevel, Vec2 } from '../fight/types'
import type { Flavor, ImpactOpts } from './impacts'
import type { StageId } from './reverb'

/** Announcer shout keys — one per pre-rendered announcer MP3. */
export type AnnouncerKey =
  | 'fight' | 'ko' | 'combo' | 'crit' | 'ultimate'
  | 'perfect' | 'timeup' | 'reading' | 'round1' | 'round2' | 'round3'

/** Per-fighter voice-line keys — one per file in `public/audio/voices/<id>/`. */
export type VoiceKey =
  | 'matchStart' | 'ult' | 'win' | 'lose' | 'crit' | 'ko'
  | 'trash1' | 'trash2' | 'trash3'

/**
 * The imperative surface the reactor drives. The live adapter maps these onto
 * `fightAudio` + `Announcer` + `Voice` + music; the offline adapter maps the
 * synth one-shots onto an `OfflineAudioContext` render and no-ops the rest.
 *
 * Every method must be total and non-throwing — the reactor calls them from the
 * render loop and never guards the calls itself.
 */
export interface FightAudioSink {
  // ─── synth one-shots (measurable PCM) ─────────────────────────────────
  impact(flavor: Flavor, opts?: ImpactOpts): void
  ko(opts?: ImpactOpts): void
  shatter(opts?: ImpactOpts): void
  whiff(opts?: ImpactOpts): void
  footstep(opts?: ImpactOpts): void
  cloth(opts?: ImpactOpts): void
  meterCharge(): void
  superStinger(): void
  victory(): void
  defeat(): void
  // ─── adaptive mix ─────────────────────────────────────────────────────
  setStage(stage: StageId): void
  setTension(hp01: number): void
  duckMusic(intensity: number): void
  // ─── narrative (MP3-backed; no-op offline) ────────────────────────────
  announce(key: AnnouncerKey): void
  voice(side: 0 | 1, key: VoiceKey, text: string): void
  // ─── music bed ────────────────────────────────────────────────────────
  musicStart(): void
  musicStop(): void
}

/**
 * Half the playable stage width, mirrored from `src/fight/constants`
 * (`STAGE_HALF_W`). Inlined rather than imported to keep the reactor free of
 * any sim dependency — it is used only to pan a sound left/right by where the
 * contact happened, so a small drift if the sim widens the stage is cosmetic.
 */
const STAGE_HALF_W = 480

/** Ground distance (cm) a walking fighter covers between footstep sounds. */
const STRIDE_CM = 46

/** One full super bar, in meter units (`MAX_METER` is two bars = 2000). */
const METER_BAR = 1000

/** Only re-send tension when the HP fraction moves this much — avoids redundant
 *  automation ramps every frame while still tracking the fight closely. */
const TENSION_EPS = 0.02

/** Stances during which feet are striking the floor. */
function isWalking(stance: FightState['fighters'][0]['stance']): boolean {
  return stance === 'walk-fwd' || stance === 'walk-back' || stance === 'dash' || stance === 'backdash'
}

/** −1..1 stereo pan from a world contact point. */
function panOf(at: Vec2): number {
  const p = at.x / STAGE_HALF_W
  return p < -1 ? -1 : p > 1 ? 1 : p
}

/** Base flavour + intrinsic power for a clean hit of each level. Each weight
 *  class now voices its OWN synth: light/medium/heavy/sweep/launcher are
 *  distinct impacts (bright-tight medium, dark-low sweep, bright rising-body
 *  launcher — not one `heavy` synth at rising volume), and a crumple — the
 *  heaviest stun — gets the sharp `crit` transient. Power still scales size
 *  within each flavour; the reactor's HIT_GAIN trim carries the loudness ladder. */
export function flavorForHit(level: HitLevel): { flavor: Flavor; power: number } {
  switch (level) {
    case 'light': return { flavor: 'light', power: 0.5 }
    case 'medium': return { flavor: 'medium', power: 0.55 }
    case 'heavy': return { flavor: 'heavy', power: 0.9 }
    case 'launcher': return { flavor: 'launcher', power: 0.95 }
    case 'sweep': return { flavor: 'sweep', power: 0.72 }
    case 'crumple': return { flavor: 'crit', power: 0.9 }
  }
}

/** Nudge the intrinsic power up a touch with raw damage, clamped so a chip
 *  never sounds like a launcher and a launcher never clips. */
function powerWithDamage(base: number, damage: number): number {
  const scaled = base * (0.7 + 0.5 * clamp01(damage / 120))
  return scaled < 0.12 ? 0.12 : scaled > 1 ? 1 : scaled
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/**
 * LOUDNESS HIERARCHY — the deliberate per-tier output trim (`ImpactOpts.gain`)
 * that makes weight read as LEVEL, not just spectrum. In SF6/Tekken 8/Strive a
 * jab is a tick and a super/KO takes over the room; the pre-fix mix crushed
 * every hit into a ~3 dB band (a counter-hit landed QUIETER than a medium hit).
 * These trims, tuned against tools/measure-fight-audio.mjs, seat the tiers on a
 * ~2.5–3 dB-per-step ladder — whiff < light < medium < heavy < counter < KO,
 * KO unmistakably loudest — while the synths themselves stay untouched. They
 * only bite once the master (master.ts) was relaxed to stop levelling them; the
 * two halves are proved together by the `flatten` + `crush-master` mutations.
 */
const HIT_GAIN: Record<HitLevel, number> = {
  light: 0.85,
  medium: 0.82,
  heavy: 1.3,
  launcher: 1.45,
  sweep: 1.05,
  crumple: 1.7,
}
/** Counter-hit: a bright crit crack the read-reward is built on, plus a modest
 *  heavy body for weight. Crit-DOMINANT so the counter is louder than a clean
 *  heavy AND spectrally brighter than a medium hit (both measured) — the body is
 *  kept low so it adds sub-weight without dulling the crack. */
const COUNTER_CRIT_GAIN = 3.4
const COUNTER_BODY_GAIN = 0.3
/** The KO — the single loudest moment in a round, alone at the ceiling. */
const KO_GAIN = 2.7
/** The whiff feel-sound — floor of the ladder, a swing you barely register. */
const WHIFF_GAIN = 1.0
/** A blocked hit sits below even a light clean hit: a dull guarded thud. */
const BLOCK_GAIN = 0.7

export class FightAudioReactor {
  private readonly sink: FightAudioSink

  // Per-match derived state. All primitive, all reset in `reset()`.
  private stridePhase: [number, number] = [0, 0]
  private meterBar: [number, number] = [0, 0]
  private tension = 1
  private koThisRound = false
  private matchEnded = false

  constructor(sink: FightAudioSink) {
    this.sink = sink
  }

  /** Point the reverb + ambience at an arena. Idempotent per stage. */
  setStage(stage: StageId): void {
    this.sink.setStage(stage)
  }

  /**
   * The audio mirror of `FightVfx.handle`. One discrete sound moment per
   * simulation event. Covers all thirteen event types — including the four the
   * VFX side has no case for (`whiff`, `counter-hit`, `round-start`,
   * `round-end`), which is precisely the audio that never played.
   */
  handle(e: FightEvent): void {
    switch (e.type) {
      case 'hit': return this.hit(e.level, e.damage, e.at, false)
      case 'counter-hit': return this.hit(e.level, e.damage, e.at, true)
      case 'block': return this.block(e.at)
      case 'parry': return this.parry(e.at)
      case 'whiff': return void this.sink.whiff({ pan: panOf(e.at), power: 0.7, gain: WHIFF_GAIN })
      case 'throw': return this.throwFx(e.at, e.level, e.damage)
      case 'launch': return this.launch(e.at)
      case 'knockdown': return this.knockdown(e.at)
      case 'wall-bounce': return this.wallBounce(e.at)
      case 'super-flash': return this.superFlash(e.who)
      case 'ko': return this.koEvent(e.who)
      case 'round-start': return this.roundStart(e.round)
      case 'round-end': return this.roundEnd(e.winner)
    }
  }

  // ─── event handlers ─────────────────────────────────────────────────────

  private hit(level: HitLevel, damage: number, at: Vec2, counter: boolean): void {
    const pan = panOf(at)
    const { flavor, power } = flavorForHit(level)
    const p = powerWithDamage(power, damage)
    if (counter) {
      // A counter-hit is the reward for reading the opponent, so it has to
      // *sound* like a bigger deal than the same button on a neutral hit:
      // a sharp `crit` transient layered over a heavy body thump gives it more
      // level AND more sub-200Hz weight than a normal hit of the same level,
      // and it ducks the music harder for punch. Both the loudness (it sits a
      // tier above a clean heavy) and the brightness are measurable — see
      // tools/measure-fight-audio.mjs (`counter > medium/heavy` + the crit crack).
      this.sink.impact('crit', { power: p < 0.95 ? 0.95 : p, damage, pan, gain: COUNTER_CRIT_GAIN })
      this.sink.impact('heavy', { power: 0.82, damage, pan, gain: COUNTER_BODY_GAIN })
      this.sink.duckMusic(0.85)
    } else {
      this.sink.impact(flavor, { power: p, damage, pan, gain: HIT_GAIN[level] })
      // Heavier connects punch the mix a little.
      if (p > 0.8) this.sink.duckMusic(0.5)
    }
  }

  /** A blocked hit: duller and quieter than a clean hit — a leather-on-guard
   *  thud, not a crack. Deliberately softer than even a `light` hit. */
  private block(at: Vec2): void {
    const pan = panOf(at)
    this.sink.impact('light', { power: 0.32, pan, gain: BLOCK_GAIN })
    this.sink.cloth({ pan, power: 0.6 })
  }

  /** A parry: a bright, metallic deflection with the `ex` flavour — distinct
   *  from both the dull block and the meaty counter-hit. */
  private parry(at: Vec2): void {
    this.sink.impact('ex', { power: 0.62, pan: panOf(at) })
  }

  /** A throw: a cloth grab (the catch) + a heavy body SLAM weighted by the
   *  throw's authored `level`/`damage` — the same ladder a strike uses. The body
   *  is always the low `heavy` thud (a throw is a slam, never a sharp crack even
   *  at the top tier), but its power AND gain now scale with the level, so a
   *  140-dmg command grab lands a full heavy slam (power→1, gain 1.3) and ducks
   *  the music, instead of the old fixed, underweight 0.42 that dropped `level`.
   *  A sub-heavy floor keeps even a basic throw a real slam. */
  private throwFx(at: Vec2, level: HitLevel, damage: number): void {
    const pan = panOf(at)
    const { power } = flavorForHit(level)
    const slamPower = Math.max(0.6, powerWithDamage(power, damage))
    this.sink.cloth({ pan, power: 0.9 })
    this.sink.impact('heavy', { power: slamPower, damage, pan, gain: HIT_GAIN[level] })
    if (slamPower > 0.8) this.sink.duckMusic(0.6)
  }

  /** A launch: heavy connect plus an upward whoosh as the body leaves the floor. */
  private launch(at: Vec2): void {
    const pan = panOf(at)
    this.sink.impact('heavy', { power: 0.6, pan })
    this.sink.whiff({ pan, power: 0.9 })
  }

  /** A body hitting the ground on knockdown. */
  private knockdown(at: Vec2): void {
    this.sink.impact('heavy', { power: 0.46, pan: panOf(at) })
  }

  /** A juggled fighter slamming into the wall — sharp and bright. */
  private wallBounce(at: Vec2): void {
    this.sink.impact('crit', { power: 0.72, pan: panOf(at) })
  }

  /** Super activation: the "stop the world" stinger, a hard music duck, the
   *  announcer, and the owner's ult voice line. */
  private superFlash(who: 0 | 1): void {
    this.sink.superStinger()
    this.sink.duckMusic(0.95)
    this.sink.announce('ultimate')
    this.sink.voice(who, 'ult', 'Ultimate!')
  }

  /** A knockout. `who` is the fighter who got KO'd. */
  private koEvent(who: 0 | 1): void {
    this.koThisRound = true
    this.sink.ko({ power: 1, gain: KO_GAIN })
    this.sink.duckMusic(1)
    this.sink.announce('ko')
    this.sink.voice(who, 'ko', '...')
  }

  private roundStart(round: number): void {
    this.koThisRound = false
    this.stridePhase[0] = 0
    this.stridePhase[1] = 0
    const key: AnnouncerKey = round <= 1 ? 'round1' : round === 2 ? 'round2' : 'round3'
    this.sink.announce(key)
  }

  /** End of a round. A KO round already fired its `ko` beat; a round that ended
   *  on the clock did not, so announce "time up" there. The match result
   *  (victory/defeat + win/lose voices) is fired from `step()` on the
   *  transition into `match-end`, so it is not double-played here. */
  private roundEnd(_winner: 0 | 1 | null): void {
    if (!this.koThisRound) this.sink.announce('timeup')
  }

  // ─── derived, per advanced frame ────────────────────────────────────────

  /**
   * Effects that are not discrete events but continuous state: footsteps,
   * HP-driven tension, meter-bar charge, and the phase-transition beats
   * (FIGHT!, match result). Mirrors `FightRenderer._derived` (dash/landing
   * dust) — call it once per *advanced* simulation frame (never on a frozen
   * capture frame, where `next.frame === prev.frame`). Allocation-free.
   */
  step(prev: FightState, next: FightState): void {
    // Footsteps + landings, per fighter.
    for (let i = 0; i < 2; i++) {
      const p = prev.fighters[i]
      const n = next.fighters[i]
      // Landing thud: was airborne, now grounded.
      if (n.grounded && !p.grounded) {
        this.sink.footstep({ pan: panOf(n.pos), power: 0.85 })
        this.stridePhase[i] = 0
        continue
      }
      if (n.grounded && isWalking(n.stance)) {
        this.stridePhase[i] += Math.abs(n.pos.x - p.pos.x)
        if (this.stridePhase[i] >= STRIDE_CM) {
          this.stridePhase[i] -= STRIDE_CM
          this.sink.footstep({ pan: panOf(n.pos), power: 0.5 })
        }
      } else {
        // Not walking on the ground: reset so the next stride starts clean and
        // a footstep never fires from an idle micro-drift.
        this.stridePhase[i] = 0
      }
    }

    // Meter-bar charge cue: fire when a fighter crosses INTO a new full bar.
    // Assigning `bar` unconditionally means a spend or a round reset (meter
    // dropping) silently re-arms without firing.
    for (let i = 0; i < 2; i++) {
      const bar = Math.floor(next.fighters[i].meter / METER_BAR)
      if (bar > this.meterBar[i]) this.sink.meterCharge()
      this.meterBar[i] = bar
    }

    // HP-driven tension: the mix tightens as the *nearest-to-death* fighter
    // fades. Only re-sent when it actually moves, so this is near-free.
    const hp01 = Math.min(hpFrac(next.fighters[0]), hpFrac(next.fighters[1]))
    if (Math.abs(hp01 - this.tension) > TENSION_EPS) {
      this.tension = hp01
      this.sink.setTension(hp01)
    }

    // Phase transitions the event list does not carry. `prev` and `next` are
    // consecutive *advanced* sim frames, so their phases are the true
    // frame-to-frame transition — no separate tracker needed (and none that
    // could start out of sync). The sim re-enters `intro` at the top of every
    // round (sim.ts), so intro→fight fires "FIGHT!" each round — the classic
    // "Round 2… FIGHT!" cadence — while music start stays idempotent in the sink.
    if (next.phase !== prev.phase) {
      if (next.phase === 'fight' && prev.phase === 'intro') {
        this.sink.announce('fight')
        this.sink.musicStart()
      } else if (next.phase === 'match-end' && !this.matchEnded) {
        this.matchEnded = true
        this.matchResult(next)
      }
    }
  }

  private matchResult(state: FightState): void {
    const [w0, w1] = state.wins
    let winner: 0 | 1
    if (w0 !== w1) winner = w0 > w1 ? 0 : 1
    else winner = hpFrac(state.fighters[0]) >= hpFrac(state.fighters[1]) ? 0 : 1
    const loser = (winner ^ 1) as 0 | 1
    this.sink.duckMusic(0.6)
    this.sink.victory()
    this.sink.voice(winner, 'win', 'GG.')
    this.sink.voice(loser, 'lose', '...')
  }

  /** Clear per-match state for a rematch. Leaves the stage/ambience alone. */
  reset(): void {
    this.stridePhase[0] = 0
    this.stridePhase[1] = 0
    this.meterBar[0] = 0
    this.meterBar[1] = 0
    this.tension = 1
    this.koThisRound = false
    this.matchEnded = false
  }

  /** Stop any long-lived audio (the music bed). One-shots decay on their own. */
  dispose(): void {
    this.sink.musicStop()
  }
}

function hpFrac(f: FightState['fighters'][0]): number {
  return f.maxHealth > 0 ? clamp01(f.health / f.maxHealth) : 0
}
