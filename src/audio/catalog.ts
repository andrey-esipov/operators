/**
 * A single registry of every one-shot the engine can fire, plus an offline
 * renderer. The audiolab and the live engine both trigger sounds by name
 * through this catalog, so what you measure offline is exactly what ships.
 */

import { type Ctx } from './dsp'
import { renderImpact, type Flavor, type ImpactRouting, type ImpactOpts } from './impacts'
import {
  renderWhiff, renderFootstep, renderCloth, renderMeterCharge,
  renderSuperStinger, renderVictory, renderDefeat, renderMenuBlip,
} from './sfx'
import { buildMasterGraph } from './master'
import { STAGE_ACOUSTICS, stageImpulse, type StageId } from './reverb'

export type SoundName =
  | Flavor
  | 'whiff' | 'footstep' | 'cloth' | 'meterCharge'
  | 'superStinger' | 'victory' | 'defeat' | 'menuMove' | 'menuSelect'

const IMPACT_FLAVORS: Flavor[] = ['light', 'medium', 'heavy', 'sweep', 'launcher', 'crit', 'combo', 'ex', 'ult', 'signature', 'shatter', 'ko']

/** Build a named sound at `when`; returns its end time. */
export function renderSound(
  ctx: Ctx,
  routing: ImpactRouting,
  when: number,
  name: SoundName,
  opts: ImpactOpts = {},
): number {
  if ((IMPACT_FLAVORS as string[]).includes(name)) {
    return renderImpact(ctx, routing, when, name as Flavor, opts)
  }
  switch (name) {
    case 'whiff': return renderWhiff(ctx, routing, when, opts)
    case 'footstep': return renderFootstep(ctx, routing, when, opts)
    case 'cloth': return renderCloth(ctx, routing, when, opts)
    case 'meterCharge': return renderMeterCharge(ctx, routing, when, 0.8)
    case 'superStinger': return renderSuperStinger(ctx, routing, when)
    case 'victory': return renderVictory(ctx, routing, when)
    case 'defeat': return renderDefeat(ctx, routing, when)
    case 'menuMove': return renderMenuBlip(ctx, routing, when, false)
    case 'menuSelect': return renderMenuBlip(ctx, routing, when, true)
  }
  return when + 0.1
}

export interface OfflineRenderOpts {
  stage?: StageId
  sampleRate?: number
  seconds?: number
  opts?: ImpactOpts
  dry?: boolean // skip reverb send (isolate the dry hit)
}

/**
 * Render a named sound through the full mastering chain offline and return
 * the resulting AudioBuffer (stereo). Deterministic when opts.seed is set.
 */
export async function renderOffline(name: SoundName, o: OfflineRenderOpts = {}): Promise<AudioBuffer> {
  const sampleRate = o.sampleRate ?? 48000
  const stage = o.stage ?? 'hypergrowth'
  const acou = STAGE_ACOUSTICS[stage]
  const seconds = o.seconds ?? defaultDuration(name)
  const OAC: typeof OfflineAudioContext =
    (globalThis as unknown as { OfflineAudioContext: typeof OfflineAudioContext }).OfflineAudioContext
  const ctx = new OAC(2, Math.ceil(seconds * sampleRate), sampleRate)

  const graph = buildMasterGraph(ctx, ctx.destination, 0.9)
  graph.convolver.buffer = stageImpulse(ctx, stage)
  graph.reverbReturn.gain.value = acou.wet

  const routing: ImpactRouting = {
    out: graph.sfxBus,
    reverb: o.dry ? null : graph.reverbBus,
  }
  renderSound(ctx, routing, 0.02, name, { seed: 12345, ...o.opts })
  return await ctx.startRendering()
}

function defaultDuration(name: SoundName): number {
  switch (name) {
    case 'ult': return 3.0
    case 'signature': return 3.2
    case 'ko': return 3.0
    case 'shatter': return 1.6
    case 'launcher': return 1.0
    case 'sweep': return 1.0
    case 'combo': return 1.2
    case 'crit': return 1.2
    case 'heavy': return 1.0
    case 'victory': return 1.6
    case 'defeat': return 1.6
    case 'meterCharge': return 1.4
    case 'superStinger': return 1.4
    default: return 0.6
  }
}

export const ALL_SOUNDS: SoundName[] = [
  'light', 'medium', 'heavy', 'sweep', 'launcher', 'crit', 'combo', 'ex', 'ult', 'signature', 'shatter', 'ko',
  'whiff', 'footstep', 'cloth', 'meterCharge', 'superStinger', 'victory', 'defeat',
  'menuMove', 'menuSelect',
]
