/**
 * The live `FightAudioSink` — the adapter that plugs the pure reactor into the
 * real, shipping audio backend.
 *
 * It maps the reactor's imperative surface onto three existing systems that
 * were already built and (for the fighter) never called together:
 *
 *   • `fightAudio`  — the procedural Web-Audio engine (impacts, feel SFX,
 *                     per-arena convolution reverb, HP-driven tension, music
 *                     ducking). This is the code the fighter never touched.
 *   • `Announcer`   — pre-rendered "FIGHT!" / "K.O." shouts, routed through
 *                     `fightAudio`'s radio-EQ + plate-reverb voice bus.
 *   • `Voice`       — per-fighter voice lines (`public/audio/voices/<id>/`).
 *
 * Plus a duckable music bed: fight music is routed *through* `fightAudio`'s
 * music bus (`musicBusNode()`), which sits upstream of the sidechain `musicDuck`
 * gain — so `duckMusic()` on a super or KO pumps the track automatically.
 *
 * Fail-silent contract: this sink is constructed on the real `?play=1` route,
 * which the headless capture tools also drive. It must NEVER throw. `fightAudio`
 * already guards context creation/resume and schedules safely on a suspended
 * context; here we additionally wrap the music-element wiring (the one path that
 * can throw — `createMediaElementSource`) in try/catch, and only ever build the
 * `AudioContext` lazily on the first call (never at module load), honouring the
 * browser autoplay policy.
 */

import { fightAudio } from './index'
import type { FightAudioSink, AnnouncerKey, VoiceKey } from './reactor'
import type { Flavor, ImpactOpts } from './impacts'
import type { StageId } from './reverb'
import { Announcer } from '../lib/announcer'
import { Voice } from '../lib/voice'
import { Music } from '../lib/music'

export interface LiveSinkOptions {
  /** Fighter ids [p1, p2] — selects the voice pack per side. */
  fighterIds: [string, string]
  /** Whether to start a music bed. Respects the player's music toggle. */
  music?: boolean
}

/** Short fallback texts for the SpeechSynthesis path when a voice MP3 is absent. */
const VOICE_TEXT: Record<VoiceKey, string> = {
  matchStart: 'Let\u2019s go.',
  ult: 'Ultimate!',
  win: 'Good game.',
  lose: '...',
  crit: 'Read you.',
  ko: 'Argh!',
  trash1: 'Is that all?',
  trash2: 'Too slow.',
  trash3: 'Come on.',
}

const MUSIC_TRACKS = ['/audio/music/fight.mp3', '/audio/music/fight-b.mp3']

/**
 * Diagnostics the live smoke test reads through `window.__PLAY__.audio()`.
 * Proves the renderer is actually feeding the reactor (counts climb) and that
 * the AudioContext has unlocked (`contextRunning`).
 */
export interface LiveSinkStats {
  calls: number
  impacts: number
  footsteps: number
  announces: number
  voices: number
  contextRunning: boolean
  musicStarted: boolean
}

export class LiveFightAudioSink implements FightAudioSink {
  private readonly ids: [string, string]
  private readonly enableMusic: boolean

  private musicEl: HTMLAudioElement | null = null
  private musicStarted = false

  private _calls = 0
  private _impacts = 0
  private _footsteps = 0
  private _announces = 0
  private _voices = 0

  constructor(opts: LiveSinkOptions) {
    this.ids = opts.fighterIds
    this.enableMusic = opts.music ?? true
  }

  /**
   * Create the AudioContext + graph now (on a user gesture, from the caller)
   * and point the reverb at the opening stage. Safe to call repeatedly.
   */
  init(stage: StageId): void {
    try {
      fightAudio.init()
      fightAudio.setStage(stage)
    } catch { /* fail silent */ }
  }

  stats(): LiveSinkStats {
    return {
      calls: this._calls,
      impacts: this._impacts,
      footsteps: this._footsteps,
      announces: this._announces,
      voices: this._voices,
      contextRunning: safe(() => fightAudio.isReady(), false),
      musicStarted: this.musicStarted,
    }
  }

  // ─── synth one-shots ──────────────────────────────────────────────────
  impact(flavor: Flavor, opts?: ImpactOpts): void { this._calls++; this._impacts++; safeVoid(() => fightAudio.impact(flavor, opts ?? {})) }
  ko(opts?: ImpactOpts): void { this._calls++; this._impacts++; safeVoid(() => fightAudio.ko(opts ?? {})) }
  shatter(opts?: ImpactOpts): void { this._calls++; this._impacts++; safeVoid(() => fightAudio.shatter(opts ?? {})) }
  whiff(opts?: ImpactOpts): void { this._calls++; safeVoid(() => fightAudio.whiff(opts ?? {})) }
  footstep(opts?: ImpactOpts): void { this._calls++; this._footsteps++; safeVoid(() => fightAudio.footstep(opts ?? {})) }
  cloth(opts?: ImpactOpts): void { this._calls++; safeVoid(() => fightAudio.cloth(opts ?? {})) }
  meterCharge(): void { this._calls++; safeVoid(() => fightAudio.meterCharge()) }
  superStinger(): void { this._calls++; safeVoid(() => fightAudio.superStinger()) }
  victory(): void { this._calls++; safeVoid(() => fightAudio.victory()) }
  defeat(): void { this._calls++; safeVoid(() => fightAudio.defeat()) }

  // ─── adaptive mix ─────────────────────────────────────────────────────
  setStage(stage: StageId): void { safeVoid(() => fightAudio.setStage(stage)) }
  setTension(hp01: number): void { safeVoid(() => fightAudio.setTension(hp01)) }
  duckMusic(intensity: number): void { safeVoid(() => fightAudio.duckMusicNow(intensity)) }

  // ─── narrative ────────────────────────────────────────────────────────
  announce(key: AnnouncerKey): void {
    this._calls++; this._announces++
    safeVoid(() => {
      switch (key) {
        case 'fight': return Announcer.fight()
        case 'ko': return Announcer.ko()
        case 'combo': return Announcer.combo()
        case 'crit': return Announcer.crit()
        case 'ultimate': return Announcer.ultimate()
        case 'perfect': return Announcer.perfect()
        case 'timeup': return Announcer.timeup()
        case 'reading': return Announcer.reading()
        case 'round1': return Announcer.round(1)
        case 'round2': return Announcer.round(2)
        case 'round3': return Announcer.round(3)
      }
    })
  }

  voice(side: 0 | 1, key: VoiceKey, text: string): void {
    this._calls++; this._voices++
    safeVoid(() => Voice.say(text || VOICE_TEXT[key], this.ids[side], key))
  }

  // ─── music bed ────────────────────────────────────────────────────────
  musicStart(): void {
    if (!this.enableMusic || this.musicStarted) return
    this.musicStarted = true
    safeVoid(() => {
      // Kill any menu track the shell (App.tsx) may have parked for this route,
      // so we never stack two music beds under the fight.
      try { Music.stop() } catch { /* noop */ }
      if (typeof Audio === 'undefined') return
      fightAudio.init()
      const bus = fightAudio.musicBusNode()
      if (!bus) return
      const el = new Audio(MUSIC_TRACKS[Math.random() < 0.5 ? 0 : 1])
      el.loop = true
      el.crossOrigin = 'anonymous'
      el.volume = 0.55
      try {
        // Route through the mastering + ducking chain: `musicBus` feeds
        // `musicDuck`, so duckMusic()/super/KO pumps this automatically. Once
        // an element is a media-element source its output goes only through the
        // graph, so nothing plays until the context is running (fail-silent in
        // headless).
        const src = (bus.context as AudioContext).createMediaElementSource(el)
        src.connect(bus)
      } catch {
        // createMediaElementSource can throw (already-sourced element, or an
        // offline context). Fall back to routing the element straight to the
        // speakers — still music, just not duckable.
      }
      el.play().catch(() => {})
      this.musicEl = el
    })
  }

  musicStop(): void {
    safeVoid(() => {
      if (this.musicEl) {
        this.musicEl.pause()
        this.musicEl = null
      }
    })
  }
}

/** Run a side-effecting thunk, swallowing anything it throws. */
function safeVoid(fn: () => void): void {
  try { fn() } catch { /* audio must never break the render loop */ }
}

/** Run a value thunk, returning a fallback if it throws. */
function safe<T>(fn: () => T, fallback: T): T {
  try { return fn() } catch { return fallback }
}

/** Build the live sink for a match. */
export function createLiveSink(opts: LiveSinkOptions): LiveFightAudioSink {
  return new LiveFightAudioSink(opts)
}
