/**
 * Portrait loader — owned by src/fighthud/**.
 *
 * The roster fighters ship a packed sprite atlas (`/fighters/<id>/atlas.png`)
 * described by `assets.json` (named frames + pixel rects). There is no separate
 * portrait art, so we crop an idle frame's head/upper body straight out of the
 * atlas. This keeps all the atlas math in the HUD layer and needs nothing from
 * the caller beyond a roster id.
 *
 * The crop is expressed purely from the frame rect (no atlas dimensions needed):
 * a CSS transform scales the frame width to the box width and clips the top of
 * the sprite, so it works for any fighter regardless of atlas size.
 */

import { FIGHTERS } from '../data/fighters'

/**
 * Resolve a roster atlas id from a fighter's display name.
 *
 * The playable match passes the HUD a fighter `name` ("Brian Chesky") but not
 * the atlas id ("chesky"), and the id is not derivable from the name by rule
 * (chesky = surname, lenny = given name). So we map through the roster, which is
 * the single source of truth. Matching is done on the full name and the short
 * name, case-insensitively. Returns `undefined` when there is no match — the
 * caller then falls back to the initial badge, and even a matched id whose atlas
 * is missing degrades to the badge (the loader 404s to `null`), so this is
 * always safe to call.
 */
const NAME_TO_ID: Map<string, string> = (() => {
  const m = new Map<string, string>()
  for (const f of FIGHTERS) {
    const id = (f as { id?: string }).id
    if (!id) continue
    const name = (f as { name?: string }).name
    const shortName = (f as { shortName?: string }).shortName
    if (name) m.set(name.trim().toLowerCase(), id)
    if (shortName) m.set(shortName.trim().toLowerCase(), id)
  }
  return m
})()

export function rosterIdForName(name?: string): string | undefined {
  if (!name) return undefined
  return NAME_TO_ID.get(name.trim().toLowerCase())
}

export interface PortraitInfo {
  /** Absolute URL of the atlas image. */
  atlas: string
  /** The idle frame rect in atlas pixels. */
  rect: { x: number; y: number; w: number; h: number }
}

interface AssetsFrame {
  name: string
  rect: { x: number; y: number; w: number; h: number }
}
interface AssetsJson {
  atlas: string
  frames: AssetsFrame[]
}

// Resolve-once cache keyed by roster id. `null` means "known-absent" so we
// don't retry a 404 on every mount.
const cache = new Map<string, Promise<PortraitInfo | null>>()

/** Pick the frame we want to portrait: prefer a mid idle, else first idle, else first frame. */
function pickFrame(frames: AssetsFrame[]): AssetsFrame | null {
  if (!frames.length) return null
  const idles = frames.filter((f) => f.name.startsWith('idle'))
  if (idles.length) return idles[Math.floor(idles.length / 2)]
  return frames[0]
}

export function loadPortrait(rosterId: string): Promise<PortraitInfo | null> {
  const hit = cache.get(rosterId)
  if (hit) return hit

  const p = (async (): Promise<PortraitInfo | null> => {
    try {
      const res = await fetch(`/fighters/${rosterId}/assets.json`)
      if (!res.ok) return null
      const json = (await res.json()) as AssetsJson
      const frame = pickFrame(json.frames)
      if (!frame) return null
      const atlas = json.atlas || `/fighters/${rosterId}/atlas.png`
      return { atlas, rect: frame.rect }
    } catch {
      return null
    }
  })()

  cache.set(rosterId, p)
  return p
}
