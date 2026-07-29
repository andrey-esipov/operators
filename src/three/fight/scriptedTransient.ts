import type { FightState } from '../../fight/types'

/**
 * True for a frame rendered during a bounded, scripted event — a super freeze OR
 * a `ko` / `round-end` / `match-end` celebration beat. The quality adaptor reads
 * this (plumbed onto the render state as `scriptedTransient`) to EXCLUDE such
 * frames from its demote decision: their cost is not evidence of a machine that
 * can't keep up, and — source-proven — the super/cinematic VFX reads no quality
 * tier, so a demotion cannot reduce it. See QualityAdaptor property 5.
 *
 * Deliberately NARROW. `intro` and ordinary `fight` frames are NOT transient, so
 * a genuinely slow machine still demotes during real gameplay — the load-bearing
 * property that keeps this a scoped discard, not a blanket "supers are exempt".
 * Pure (only a type import) so it is gated directly in a node test.
 */
export function isScriptedTransient(
  phase: FightState['phase'] | undefined,
  superFreeze: number | undefined,
): boolean {
  if ((superFreeze ?? 0) > 0) return true
  return phase === 'ko' || phase === 'round-end' || phase === 'match-end'
}
