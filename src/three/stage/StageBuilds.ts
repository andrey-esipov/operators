import type { ScenarioId } from '../../types'
import type { QualityFlags } from '../core/QualityManager'
import type { StageConfig } from './StageRegistry'
import { StageBuild } from './StageKit'
import { buildPrePmf } from './arenas/prePmf'
import { buildHypergrowth } from './arenas/hypergrowth'
import { buildPlateau } from './arenas/plateau'
import { buildAiNative } from './arenas/aiNative'
import { buildMonetization } from './arenas/monetization'
import { buildCrisis } from './arenas/crisis'
import { buildIpoPrep } from './arenas/ipoPrep'
import { buildDistribution } from './arenas/distribution'

/**
 * Arena dispatch. Each of the eight stages lives in its own module under
 * `arenas/` so they can be authored independently; `arenas/StageSet.ts` holds the
 * sub-assemblies they share.
 */
const BUILDERS: Record<ScenarioId, (b: StageBuild, cfg: StageConfig, flags: QualityFlags) => void> = {
  'pre-pmf': buildPrePmf,
  hypergrowth: buildHypergrowth,
  plateau: buildPlateau,
  'ai-native': buildAiNative,
  monetization: buildMonetization,
  crisis: buildCrisis,
  'ipo-prep': buildIpoPrep,
  distribution: buildDistribution,
}

export function buildStageScene(id: ScenarioId, cfg: StageConfig, flags: QualityFlags): StageBuild {
  const b = new StageBuild()
  const fn = BUILDERS[id] ?? buildPrePmf
  fn(b, cfg, flags)
  return b
}
