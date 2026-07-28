import type { FighterAssets, Stance } from '../../fight/types'

/**
 * Resolves which discrete atlas frame a fighter should show this instant.
 *
 * Animation is deliberately *not* interpolated: sprite frames are discrete
 * artwork and cross-fading them reads as a smear. Positions get interpolated
 * for smoothness (see FightRenderer); frames snap.
 *
 * Two timing sources feed in:
 *  - Looping locomotion (idle/walk/crouch) is clocked off the global sim frame
 *    counter so every client agrees and it never depends on render rate.
 *  - Action frames (an attack, hitstun) are clocked off the move's own elapsed
 *    frame from the sim, so the sprite tracks exactly where the move is.
 */

/** Ordered clip-name candidates for a stance; first that exists in the atlas wins. */
function clipCandidates(stance: Stance, moveId?: string): string[] {
  switch (stance) {
    case 'idle': return ['idle', 'stance']
    case 'walk-fwd': return ['walk', 'walk-fwd', 'idle']
    case 'walk-back': return ['walk-back', 'walk', 'idle']
    case 'crouch': return ['crouch', 'idle']
    case 'jump-rise': return ['jump-rise', 'jump', 'idle']
    case 'jump-fall': return ['jump-fall', 'jump', 'idle']
    case 'dash': return ['dash', 'walk', 'idle']
    case 'backdash': return ['backdash', 'dash', 'idle']
    case 'attack': return moveId ? [moveId, 'attack', 'idle'] : ['attack', 'idle']
    case 'blockstun': return ['block', 'guard', 'idle']
    case 'hitstun': return ['hurt', 'hit', 'idle']
    case 'juggle': return ['juggle', 'hurt', 'idle']
    case 'knockdown': return ['knockdown', 'down', 'hurt', 'idle']
    case 'wakeup': return ['wakeup', 'idle']
    case 'throw-tech': return ['throw-tech', 'idle']
    case 'ko': return ['ko', 'lose', 'knockdown', 'idle']
    case 'victory': return ['victory', 'win', 'idle']
    case 'defeat': return ['defeat', 'lose', 'ko', 'knockdown', 'idle']
    default: return ['idle', 'stance']
  }
}

type Clip = FighterAssets['clips'][string]

function firstClip(assets: FighterAssets, names: string[]): { name: string; clip: Clip } | null {
  for (const n of names) {
    const clip = assets.clips[n]
    if (clip && clip.frames.length) return { name: n, clip }
  }
  // Last resort: any clip at all, then any frame.
  const anyName = Object.keys(assets.clips)[0]
  if (anyName) return { name: anyName, clip: assets.clips[anyName] }
  return null
}

/** Index into clip.frames for an elapsed count of sim frames. */
function frameAt(clip: Clip, elapsed: number, loop: boolean): number {
  const durs = clip.durations
  let total = 0
  for (let i = 0; i < durs.length; i++) total += Math.max(1, durs[i])
  if (total <= 0) return clip.frames[0] ?? 0
  let t = loop ? ((elapsed % total) + total) % total : Math.min(elapsed, total - 1)
  for (let i = 0; i < clip.frames.length; i++) {
    t -= Math.max(1, durs[i] ?? 1)
    if (t < 0) return clip.frames[i]
  }
  return clip.frames[clip.frames.length - 1]
}

export interface AnimQuery {
  stance: Stance
  move?: { id: string; frame: number }
  /** Global sim frame counter, for looping clips. */
  globalFrame: number
}

/**
 * Returns the index into `assets.frames` to draw. Falls back sensibly at every
 * step so a partially-authored atlas (missing a clip) still renders *something*
 * rather than throwing or drawing frame 0 forever.
 */
export function resolveFrame(assets: FighterAssets, q: AnimQuery): number {
  const found = firstClip(assets, clipCandidates(q.stance, q.move?.id))
  if (!found) return 0
  const { clip } = found

  // Action stances driven by the move's own elapsed frame.
  const actionDriven = q.stance === 'attack' || q.stance === 'hitstun' ||
    q.stance === 'blockstun' || q.stance === 'juggle'
  if (actionDriven && q.move) {
    return frameAt(clip, q.move.frame, false)
  }
  const loop = clip.loop
  return frameAt(clip, loop ? q.globalFrame : q.globalFrame, loop)
}
