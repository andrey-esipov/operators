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
import { clamp } from './dsp'

type WinCtx = typeof AudioContext

let ctx: AudioContext | null = null
let graph: MasterGraph | null = null
let ambience: AmbienceHandle | null = null
let currentStage: StageId = 'hypergrowth'
let tension = 1
let masterVolume = 0.9
let muted = false
let unlockAttached = false

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
    if (ctx) { ctx.close().catch(() => {}); ctx = null; graph = null }
  },
}

export type { StageId, Flavor, SoundName }
