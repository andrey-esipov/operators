/**
 * AUDIOLAB — self-contained audio QA harness at /audiolab.html.
 *
 * Two jobs:
 *  1. Human/interactive: buttons to fire every impact flavour, KO, shatter,
 *     feel-SFX, stage switch, announcer/voice lines. (Live playback.)
 *  2. Machine/objective: `window.__AUDIOLAB__.render(name, opts)` renders a
 *     sound OFFLINE through the exact shipping mastering chain and returns the
 *     raw stereo PCM (base64) so a headless script can measure it.
 */

import { fightAudio } from './index'
import { renderOffline, renderSound, ALL_SOUNDS, type SoundName } from './catalog'
import { buildMasterGraph } from './master'
import { stageImpulse, STAGE_ACOUSTICS, type StageId } from './reverb'
import { FightAudioReactor, type FightAudioSink } from './reactor'
import type { ImpactRouting, ImpactOpts, Flavor } from './impacts'
import type { FightEvent } from '../fight/types'
import { Voice } from '../lib/voice'
import { Announcer } from '../lib/announcer'
import { Music } from '../lib/music'

const STAGES: StageId[] = [
  'pre-pmf', 'hypergrowth', 'plateau', 'ai-native',
  'monetization', 'crisis', 'ipo-prep', 'distribution',
]

// ─── offline render bridge (for the headless metric harness) ──────────────

interface RenderResult {
  name: string
  sampleRate: number
  length: number
  channels: number
  b64: string // interleaved Float32 stereo, base64
}

function f32ToB64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return btoa(bin)
}

async function renderForMetrics(name: SoundName, opts: { stage?: StageId; dry?: boolean; opts?: import('./impacts').ImpactOpts } = {}): Promise<RenderResult> {
  const buf = await renderOffline(name, { stage: opts.stage, dry: opts.dry, opts: opts.opts })
  const L = buf.getChannelData(0)
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L
  const inter = new Float32Array(buf.length * 2)
  for (let i = 0; i < buf.length; i++) { inter[i * 2] = L[i]; inter[i * 2 + 1] = R[i] }
  return { name, sampleRate: buf.sampleRate, length: buf.length, channels: 2, b64: f32ToB64(inter) }
}

// ─── offline TIMELINE render (proves the reactor wiring, not just the catalog) ─
//
// `render()` above measures one catalog sound in isolation. `renderTimeline()`
// drives the ACTUAL `FightAudioReactor` — the exact class the game wires into
// the renderer — over a script of sim events, rendering its synth one-shots
// into one OfflineAudioContext at scripted times. So what a headless script
// measures is the whole seam: event → reactor → sink → PCM. The announcer/voice
// /music/tension calls are MP3- or live-only, so the offline sink no-ops them;
// what remains is every audible synth moment, at the right time.

interface TimelineItem { t: number; ev: FightEvent }
type TimelineMutate = 'none' | 'no-wiring' | 'drop-hit'

/**
 * An offline sink: every synth one-shot the reactor asks for is scheduled into
 * `ctx` at `now` (set by the driver before each event). Everything MP3/live-
 * backed is a no-op — it cannot be rendered offline and is not what this probe
 * measures.
 */
class OfflineTimelineSink implements FightAudioSink {
  now = 0
  private readonly ctx: BaseAudioContext
  private readonly routing: ImpactRouting
  constructor(ctx: BaseAudioContext, routing: ImpactRouting) {
    this.ctx = ctx
    this.routing = routing
  }
  private fire(name: SoundName, opts?: ImpactOpts) { renderSound(this.ctx, this.routing, this.now, name, opts ?? {}) }
  impact(flavor: Flavor, opts?: ImpactOpts) { this.fire(flavor, opts) }
  ko(opts?: ImpactOpts) { this.fire('ko', opts) }
  shatter(opts?: ImpactOpts) { this.fire('shatter', opts) }
  whiff(opts?: ImpactOpts) { this.fire('whiff', opts) }
  footstep(opts?: ImpactOpts) { this.fire('footstep', opts) }
  cloth(opts?: ImpactOpts) { this.fire('cloth', opts) }
  meterCharge() { this.fire('meterCharge') }
  superStinger() { this.fire('superStinger') }
  victory() { this.fire('victory') }
  defeat() { this.fire('defeat') }
  setStage() {}
  setTension() {}
  duckMusic() {}
  announce() {}
  voice() {}
  musicStart() {}
  musicStop() {}
}

async function renderTimeline(
  script: TimelineItem[],
  o: { stage?: StageId; sampleRate?: number; seconds?: number; dry?: boolean; mutate?: TimelineMutate } = {},
): Promise<RenderResult> {
  const sampleRate = o.sampleRate ?? 48000
  const stage = o.stage ?? 'hypergrowth'
  const dry = o.dry ?? true
  const mutate = o.mutate ?? 'none'
  const lastT = script.reduce((m, s) => Math.max(m, s.t), 0)
  const seconds = o.seconds ?? lastT + 3.4 // tail long enough for ko/ult (~3s decay)

  const OAC: typeof OfflineAudioContext =
    (globalThis as unknown as { OfflineAudioContext: typeof OfflineAudioContext }).OfflineAudioContext
  const ctx = new OAC(2, Math.ceil(seconds * sampleRate), sampleRate)

  const graph = buildMasterGraph(ctx, ctx.destination, 0.9)
  graph.convolver.buffer = stageImpulse(ctx, stage)
  graph.reverbReturn.gain.value = STAGE_ACOUSTICS[stage].wet
  const routing: ImpactRouting = { out: graph.sfxBus, reverb: dry ? null : graph.reverbBus }

  const sink = new OfflineTimelineSink(ctx, routing)
  const reactor = new FightAudioReactor(sink)

  for (const item of script) {
    // Mutations exercise the real wiring path, so the measure tool can watch a
    // specific window collapse to silence:
    //   no-wiring : never drive the reactor at all → the exact shipped defect
    //   drop-hit  : skip only `hit` events → hit windows silent, others sound
    if (mutate === 'no-wiring') break
    if (mutate === 'drop-hit' && item.ev.type === 'hit') continue
    sink.now = item.t
    reactor.handle(item.ev)
  }

  const buf = await ctx.startRendering()
  const L = buf.getChannelData(0)
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L
  const inter = new Float32Array(buf.length * 2)
  for (let i = 0; i < buf.length; i++) { inter[i * 2] = L[i]; inter[i * 2 + 1] = R[i] }
  return { name: 'timeline', sampleRate: buf.sampleRate, length: buf.length, channels: 2, b64: f32ToB64(inter) }
}

;(window as unknown as { __AUDIOLAB__: unknown }).__AUDIOLAB__ = {
  ready: () => true,
  sounds: ALL_SOUNDS,
  stages: STAGES,
  render: (name: SoundName, opts?: { stage?: StageId; dry?: boolean; opts?: import('./impacts').ImpactOpts }) => renderForMetrics(name, opts),
  renderTimeline: (script: TimelineItem[], opts?: { stage?: StageId; sampleRate?: number; seconds?: number; dry?: boolean; mutate?: TimelineMutate }) => renderTimeline(script, opts),
}

// ─── interactive UI ───────────────────────────────────────────────────────

function el(tag: string, props: { textContent?: string; className?: string; style?: string; title?: string } = {}, kids: (Node | string)[] = []): HTMLElement {
  const n = document.createElement(tag)
  if (props.textContent) n.textContent = props.textContent
  if (props.className) n.className = props.className
  if (props.style) n.setAttribute('style', props.style)
  if (props.title) n.title = props.title
  for (const k of kids) n.append(k)
  return n
}

function button(label: string, onClick: () => void, accent = '#8b5cf6'): HTMLButtonElement {
  const b = document.createElement('button')
  b.textContent = label
  b.setAttribute('style', `
    font: 12px 'VT323', monospace; letter-spacing:.5px; cursor:pointer;
    background:#161326; color:#e9e6ff; border:1px solid ${accent};
    border-radius:6px; padding:10px 12px; min-width:96px; transition:.1s;
  `)
  b.onmouseenter = () => (b.style.background = accent)
  b.onmouseleave = () => (b.style.background = '#161326')
  b.onclick = onClick
  return b
}

function section(title: string): { wrap: HTMLElement; row: HTMLElement } {
  const wrap = el('div', { style: 'margin:0 0 18px' })
  wrap.append(el('div', { textContent: title, style: 'font:14px "Press Start 2P",monospace;color:#c4b5fd;margin:0 0 10px' }))
  const row = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px' })
  wrap.append(row)
  return { wrap, row }
}

function mount() {
  const root = el('div', { style: `
    min-height:100vh; background:radial-gradient(1200px 600px at 50% -10%, #241a3d, #0c0a16);
    color:#e9e6ff; padding:28px 32px 80px; font-family:'VT323',monospace;
  ` })

  root.append(el('h1', { textContent: '🔊 OPERATORS · AUDIOLAB', style: 'font:20px "Press Start 2P",monospace;color:#a78bfa;margin:0 0 6px' }))
  root.append(el('div', { textContent: 'Procedural Web-Audio fight engine · click anything to unlock audio', style: 'color:#8b83ad;margin:0 0 22px' }))

  // impacts
  const impacts = section('IMPACTS')
  ;(['light', 'heavy', 'crit', 'combo', 'ex', 'ult', 'signature'] as const).forEach((f) => {
    impacts.row.append(button(f.toUpperCase(), () => fightAudio.impact(f, { power: 0.85, damage: 120, pan: (Math.random() * 2 - 1) * 0.4 }), '#8b5cf6'))
  })
  impacts.row.append(button('SHATTER', () => fightAudio.shatter({ power: 1 }), '#ef4444'))
  impacts.row.append(button('K.O.', () => fightAudio.ko({ power: 1 }), '#ef4444'))
  root.append(impacts.wrap)

  // feel
  const feel = section('FEEL / FOLEY')
  feel.row.append(button('WHIFF', () => fightAudio.whiff({ pan: -0.3 }), '#22d3ee'))
  feel.row.append(button('FOOTSTEP', () => fightAudio.footstep({ pan: 0.2 }), '#22d3ee'))
  feel.row.append(button('CLOTH', () => fightAudio.cloth(), '#22d3ee'))
  feel.row.append(button('METER CHARGE', () => fightAudio.meterCharge(), '#22d3ee'))
  feel.row.append(button('SUPER STINGER', () => fightAudio.superStinger(), '#f59e0b'))
  feel.row.append(button('VICTORY', () => fightAudio.victory(), '#34d399'))
  feel.row.append(button('DEFEAT', () => fightAudio.defeat(), '#64748b'))
  feel.row.append(button('MENU MOVE', () => fightAudio.menuMove(), '#64748b'))
  feel.row.append(button('MENU SELECT', () => fightAudio.menuSelect(), '#64748b'))
  root.append(feel.wrap)

  // combo mash test (voice-stealing)
  const mash = section('STRESS')
  mash.row.append(button('MASH x12', () => {
    for (let i = 0; i < 12; i++) setTimeout(() => fightAudio.impact('light', { pan: (Math.random() * 2 - 1) }), i * 45)
  }, '#f472b6'))
  root.append(mash.wrap)

  // stages
  const stages = section('ARENA (reverb + ambience)')
  STAGES.forEach((s) => {
    stages.row.append(button(s, () => { fightAudio.setStage(s); Music.play('fight') }, '#a78bfa'))
  })
  root.append(stages.wrap)

  // tension
  const tension = section('TENSION (HP)')
  const slider = document.createElement('input')
  slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.value = '100'
  slider.setAttribute('style', 'width:280px')
  slider.oninput = () => fightAudio.setTension(Number(slider.value) / 100)
  tension.row.append(slider)
  root.append(tension.wrap)

  // announcer / voice
  const ann = section('ANNOUNCER / VOICE')
  ;(['fight', 'ko', 'combo', 'crit', 'ultimate', 'perfect'] as const).forEach((k) => {
    ann.row.append(button(k, () => (Announcer as unknown as Record<string, () => void>)[k]?.(), '#fbbf24'))
  })
  ann.row.append(button('VOICE: altman', () => Voice.say('Move fast and break things', 'altman', 'crit'), '#fbbf24'))
  root.append(ann.wrap)

  // music
  const music = section('MUSIC')
  music.row.append(button('MENU', () => Music.play('menu'), '#60a5fa'))
  music.row.append(button('FIGHT', () => Music.play('fight'), '#60a5fa'))
  music.row.append(button('STOP', () => Music.stop(), '#64748b'))
  root.append(music.wrap)

  document.body.style.margin = '0'
  document.body.append(root)
}

mount()
fightAudio.init()
