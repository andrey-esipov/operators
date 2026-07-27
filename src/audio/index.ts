/**
 * fightAudio — the public, imperatively-driven fight-audio engine.
 *
 * A single shared AudioContext feeds one mixing + mastering graph (see
 * master.ts). Impacts, feel-SFX, per-arena convolution reverb, ambience beds
 * and sidechain music ducking all live here. Designed to be driven from the
 * fight screen without any dependency on the Three.js event bus:
 *
 *   fightAudio.setStage('ipo-prep')
 *   fightAudio.setTension(0.2)            // 0..1 defender HP → mix intensity
 *   fightAudio.impact('crit', { power: 0.9, damage: 180, pan: 0.3 })
 *   fightAudio.ko()
 *
 * All state is process-global (one fight at a time). Safe to call before the
 * first user gesture — playback unlocks automatically on the first pointer/key.
 */

import { renderSound, type SoundName } from './catalog'
import type { ImpactRouting, ImpactOpts, Flavor } from './impacts'
import { buildMasterGraph, type MasterGraph } from './master'
import { stageImpulse, STAGE_ACOUSTICS, type StageId } from './reverb'
import { buildAmbience, type AmbienceHandle } from './ambience'
import { clamp, impulseResponse } from './dsp'

type WinCtx = typeof AudioContext

let ctx: AudioContext | null = null
let graph: MasterGraph | null = null
let ambience: AmbienceHandle | null = null
let currentStage: StageId = 'hypergrowth'
let tension = 1
let masterVolume = 0.9
let muted = false
let unlockAttached = false

// Lazily-built announcer/voice processing chain (radio EQ + plate reverb send).
let voiceChain: { input: GainNode } | null = null

// Simple voice-stealing budget: decays over time; small sounds are dropped
// when the budget is exhausted so a mash of inputs never turns to mud.
let voiceBudget = 0
let lastBudgetTs = 0
const VOICE_MAX = 6

const UNLOCK_EVENTS = ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'click'] as const

function getCtx(): AudioContext {
  if (!ctx) {
    const Ctor: WinCtx = window.AudioContext || (window as unknown as { webkitAudioContext: WinCtx }).webkitAudioContext
    ctx = new Ctor()
    graph = buildMasterGraph(ctx, ctx.destination, muted ? 0 : masterVolume)
    applyStage(currentStage, ctx.currentTime)
    attachUnlock()
  }
  return ctx
}

function attachUnlock() {
  if (unlockAttached || typeof window === 'undefined') return
  unlockAttached = true
  const unlock = () => {
    ctx?.resume().catch(() => {})
    for (const e of UNLOCK_EVENTS) window.removeEventListener(e, unlock)
    unlockAttached = false
  }
  for (const e of UNLOCK_EVENTS) window.addEventListener(e, unlock, { passive: true })
}

function applyStage(stage: StageId, when: number) {
  if (!ctx || !graph) return
  const acou = STAGE_ACOUSTICS[stage] ?? STAGE_ACOUSTICS.hypergrowth
  graph.convolver.buffer = stageImpulse(ctx, stage)
  graph.reverbReturn.gain.cancelScheduledValues(when)
  graph.reverbReturn.gain.setTargetAtTime(acou.wet, when, 0.2)
  // swap ambience bed
  ambience?.stop(when, 1.0)
  ambience = buildAmbience(ctx, graph.musicBus, acou.ambience, when + 0.02)
}

function routing(): ImpactRouting {
  const g = graph!
  return {
    out: g.sfxBus,
    reverb: g.reverbBus,
    onImpact: (when, intensity) => duck(when, intensity),
  }
}

/**
 * Sidechain duck of music + reverb return on each hit. Bigger hits duck
 * harder and recover slower — the classic "punch" pump.
 */
function duck(when: number, intensity: number) {
  if (!graph) return
  const amt = clamp(intensity, 0, 1.2)
  const depth = clamp(0.32 + amt * 0.4, 0, 0.85)
  const recover = 0.18 + amt * 0.25
  const md = graph.musicDuck.gain
  md.cancelScheduledValues(when)
  md.setValueAtTime(md.value, when)
  md.linearRampToValueAtTime(1 - depth, when + 0.012)
  md.setTargetAtTime(1, when + 0.02, recover)
}

/** Track a decaying concurrency budget; return true if a voice is allowed. */
function takeVoice(cost = 1): boolean {
  const t = ctx ? ctx.currentTime : 0
  const dt = Math.max(0, t - lastBudgetTs)
  voiceBudget = Math.max(0, voiceBudget - dt * 8) // decay 8 voices/sec
  lastBudgetTs = t
  if (voiceBudget + cost > VOICE_MAX) return false
  voiceBudget += cost
  return true
}

/**
 * Build (once) the announcer voice-processing chain and return its input node.
 * Signal path: input ─► radio band-pass EQ (HPF 320 + presence peak + LPF 3.4k)
 * ─► voiceBus, with a parallel send into a short PLATE reverb so the shout sits
 * in a space like a real arena PA.
 */
function ensureVoiceChain(): GainNode | null {
  if (!graph || !ctx) return null
  if (voiceChain) return voiceChain.input
  const input = ctx.createGain(); input.gain.value = 1.0

  // Radio EQ: telephone-ish band with a presence bump so consonants cut.
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 320; hp.Q.value = 0.7
  const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 2400; presence.Q.value = 1.1; presence.gain.value = 4.5
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3400; lp.Q.value = 0.7
  input.connect(hp); hp.connect(presence); presence.connect(lp)
  lp.connect(graph.voiceBus)

  // Parallel PLATE reverb send — short, bright, dense.
  const send = ctx.createGain(); send.gain.value = 0.22
  const plate = ctx.createConvolver()
  plate.buffer = impulseResponse(ctx, { seconds: 0.8, decay: 4.5, bright: 0.65, seed: 4242 })
  lp.connect(send); send.connect(plate); plate.connect(graph.voiceBus)

  voiceChain = { input }
  return input
}

/** Duck the music bus under an announcer line, releasing after `dur` seconds. */
function duckMusicForVoice(when: number, dur: number, depth = 0.55) {
  if (!graph) return
  const md = graph.musicDuck.gain
  md.cancelScheduledValues(when)
  md.setValueAtTime(md.value, when)
  md.linearRampToValueAtTime(1 - depth, when + 0.05)
  md.setValueAtTime(1 - depth, when + Math.max(0.1, dur))
  md.setTargetAtTime(1, when + Math.max(0.1, dur), 0.25)
}

function fire(name: SoundName, opts: ImpactOpts = {}, cost = 1): number {
  const c = getCtx()
  if (muted) return c.currentTime
  if (!takeVoice(cost)) return c.currentTime
  return renderSound(c, routing(), c.currentTime + 0.005, name, opts)
}

export const fightAudio = {
  // ─── lifecycle ──────────────────────────────────────────────────────
  init() { getCtx() },
  resume() { getCtx().resume().catch(() => {}) },
  isReady() { return !!ctx && ctx.state === 'running' },

  // ─── space ──────────────────────────────────────────────────────────
  setStage(stage: StageId) {
    currentStage = stage
    if (ctx) applyStage(stage, ctx.currentTime)
  },
  getStage() { return currentStage },

  /** 0..1 defender HP → global tension. Lower HP = tenser (drier duck, more low-end). */
  setTension(hp01: number) {
    tension = clamp(hp01, 0, 1)
    if (graph && ctx) {
      // as tension rises (HP falls), pull the reverb in a touch for intimacy
      const acou = STAGE_ACOUSTICS[currentStage]
      const wet = acou.wet * (0.7 + 0.3 * tension)
      graph.reverbReturn.gain.setTargetAtTime(wet, ctx.currentTime, 0.4)
    }
  },
  getTension() { return tension },

  // ─── impacts ────────────────────────────────────────────────────────
  impact(flavor: Flavor, opts: ImpactOpts = {}) {
    // big hits are never voice-stolen
    const cost = flavor === 'ult' || flavor === 'ko' || flavor === 'signature' ? 0 : 1
    return fire(flavor, opts, cost)
  },
  ko(opts: ImpactOpts = {}) { return fire('ko', opts, 0) },
  shatter(opts: ImpactOpts = {}) { return fire('shatter', opts, 0) },

  // ─── feel SFX ───────────────────────────────────────────────────────
  whiff(opts: ImpactOpts = {}) { return fire('whiff', opts, 0.5) },
  footstep(opts: ImpactOpts = {}) { return fire('footstep', opts, 0.5) },
  cloth(opts: ImpactOpts = {}) { return fire('cloth', opts, 0.4) },
  meterCharge() { return fire('meterCharge', {}, 0) },
  superStinger() { return fire('superStinger', {}, 0) },
  victory() { return fire('victory', {}, 0) },
  defeat() { return fire('defeat', {}, 0) },
  menuMove() { return fire('menuMove', {}, 0.3) },
  menuSelect() { return fire('menuSelect', {}, 0.3) },

  // ─── music bus (for external music routing / ducking) ───────────────
  /** Returns the music bus GainNode so an external source can route through
   * the mastering + ducking chain. Only valid after init(). */
  musicBusNode(): GainNode | null { return graph?.musicBus ?? null },
  duckMusicNow(intensity = 0.8) { if (ctx) duck(ctx.currentTime + 0.005, intensity) },

  // ─── announcer / voice (radio EQ + plate reverb + music duck) ───────
  /**
   * Play a voice/announcer MP3 through the processed voice bus: radio-EQ +
   * short plate reverb, and duck the music underneath it. Returns the backing
   * HTMLAudioElement on success, or null if Web-Audio routing wasn't possible
   * (caller should then fall back to raw `<audio>` playback). Same-origin URLs
   * only. Safe to call repeatedly; the processing chain is built once.
   */
  playVoice(url: string, opts: { volume?: number } = {}): HTMLAudioElement | null {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return null
    try {
      const c = getCtx()
      const input = ensureVoiceChain()
      if (!input) return null
      c.resume().catch(() => {})
      const el = new Audio(url)
      el.crossOrigin = 'anonymous'
      el.volume = clamp(opts.volume ?? 0.95, 0, 1)
      const srcNode = c.createMediaElementSource(el)
      srcNode.connect(input)
      const startDuck = (dur: number) => duckMusicForVoice(c.currentTime + 0.02, dur)
      el.addEventListener('loadedmetadata', () => startDuck(isFinite(el.duration) && el.duration > 0 ? el.duration : 1.3))
      // fire an immediate short duck too, in case metadata is slow
      startDuck(1.2)
      el.play().catch(() => {})
      return el
    } catch {
      return null
    }
  },

  // ─── mix control ────────────────────────────────────────────────────
  setMasterVolume(v: number) {
    masterVolume = clamp(v, 0, 1)
    if (graph && ctx && !muted) graph.masterGain.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.05)
  },
  getMasterVolume() { return masterVolume },
  setMuted(m: boolean) {
    muted = m
    if (graph && ctx) graph.masterGain.gain.setTargetAtTime(muted ? 0 : masterVolume, ctx.currentTime, 0.03)
  },
  isMuted() { return muted },

  // ─── teardown ───────────────────────────────────────────────────────
  teardown() {
    try { ambience?.stop(ctx ? ctx.currentTime : 0, 0.3) } catch { /* noop */ }
    ambience = null
    voiceChain = null
    if (ctx) { ctx.close().catch(() => {}); ctx = null; graph = null }
  },
}

export type { StageId, Flavor, SoundName }
