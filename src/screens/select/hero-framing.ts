/*
 * Per-fighter hero framing.
 *
 * The base 1024×1024 stance art frames every operator feet-at-bottom with a
 * modest amount of headroom, so a single global crop works for the roster.
 * A handful of sprites sit a little higher or lower in their frame, though —
 * heads brushing the top edge, or a floating body with dead space beneath.
 *
 * `heroYOffset` returns a vertical nudge (in % of the render height; negative
 * moves the art UP, positive moves it DOWN) applied to the big hero render.
 * `portraitYOffset` returns the equivalent nudge for the zoomed face-crop shown
 * in the roster grid, where getting the head centred matters even more.
 *
 * Owned by the select-screens agent — kept in-screen because it is pure
 * presentation framing, not fighter game data.
 */

/** Hero render vertical nudge, in % of the hero frame height. */
export const HERO_Y_OFFSET: Record<string, number> = {
  // Robot / mascot silhouettes read tall — pull down so the head isn't clipped.
  turley: 3,
  // Tightly-framed sprites that otherwise float — nudge down onto the floor.
  lenny: 2,
}

/** Roster face-crop vertical nudge, in % of the crop height. */
export const PORTRAIT_Y_OFFSET: Record<string, number> = {
  turley: 4,
  lenny: 2,
}

export function heroYOffset(id: string): number {
  return HERO_Y_OFFSET[id] ?? 0
}

export function portraitYOffset(id: string): number {
  return PORTRAIT_Y_OFFSET[id] ?? 0
}
