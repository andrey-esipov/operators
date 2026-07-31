/**
 * Portrait loader — owned by src/fighthud/**.
 *
 * The roster fighters ship a packed sprite atlas (`/fighters/<id>/atlas.webp`)
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
import { fighterAtlas, fighterPortrait, fighterPortraitMeta } from './select/portraitAssets'

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
  anchor?: { x: number; y: number }
}
interface AssetsClip {
  frames: number[]
  durations: number[]
  loop?: boolean
}
interface AssetsJson {
  atlas: string
  frames: AssetsFrame[]
  clips?: Record<string, AssetsClip>
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
      const atlas = json.atlas || fighterAtlas(rosterId)
      return { atlas, rect: frame.rect }
    } catch {
      return null
    }
  })()

  cache.set(rosterId, p)
  return p
}

// Image-decode cache keyed by atlas URL, so warming an atlas twice is free and a
// grid can await "all portraits decodable" once.
const imgCache = new Map<string, Promise<void>>()

/**
 * Warm a portrait all the way to a decoded image, not just resolved metadata.
 *
 * `loadPortrait` only fetches the tiny `assets.json`; the actual `atlas.webp` is
 * still fetched lazily when an `<img>` first mounts. On a grid that means cells
 * pop in one-by-one and, worse, a capture taken mid-load photographs black
 * boxes (the select screen's documented load race). Preloading every roster
 * atlas on mount collapses that race: by the time the grid paints, the browser
 * cache is warm and every portrait appears at once. Resolves (never rejects) on
 * load, decode-failure, or known-absent art, so callers can simply
 * `Promise.all(...)` without guarding.
 */
export function preloadPortrait(rosterId: string): Promise<void> {
  return loadPortrait(rosterId).then((info) => {
    if (!info || typeof Image === 'undefined') return
    const cached = imgCache.get(info.atlas)
    if (cached) return cached
    const warm = new Promise<void>((resolve) => {
      const img = new Image()
      img.onload = () => resolve()
      img.onerror = () => resolve()
      img.src = info.atlas
    })
    imgCache.set(info.atlas, warm)
    return warm
  })
}

/* ── Select-screen VS portrait (small, pre-baked) ──────────────────────────
 *
 * The roster grid + podium show a fighter *still*, and cropping that still out
 * of the multi-MB sprite atlas is what made the select screen eagerly pull all
 * six full atlases (~24 MB post-WebP) just to paint a menu. tools/bake-vs-
 * portraits.mjs already bakes a small dedicated still (portrait.png, ~0.3–1.3 MB)
 * for exactly this surface; these loaders finally consume it. A fighter that
 * ships no baked still falls back to the atlas crop, so the grid always paints.
 * The animated HeroRender still pulls the full atlas on demand — one fighter at
 * a time — so the atlas is never fetched six-at-once up front.
 */

export interface VsPortraitInfo {
  /** URL of the pre-baked still. */
  image: string
  /** Native pixel dims of the still. */
  w: number
  h: number
}

const vsCache = new Map<string, Promise<VsPortraitInfo | null>>()

/**
 * Resolve a fighter's pre-baked VS still. Resolves `null` (never rejects) when a
 * fighter ships none — a missing/!ok `portrait.json` or one without dims — so the
 * caller falls back to an atlas crop. Only the tiny sidecar is fetched here; the
 * still itself is warmed by `preloadVsPortrait` / mounted by the grid `<img>`.
 */
export function loadVsPortrait(rosterId: string): Promise<VsPortraitInfo | null> {
  const hit = vsCache.get(rosterId)
  if (hit) return hit
  const p = (async (): Promise<VsPortraitInfo | null> => {
    try {
      const res = await fetch(fighterPortraitMeta(rosterId))
      if (!res.ok) return null
      const pj = (await res.json()) as { w?: number; h?: number }
      if (!pj.w || !pj.h) return null
      return { image: fighterPortrait(rosterId), w: pj.w, h: pj.h }
    } catch {
      return null
    }
  })()
  vsCache.set(rosterId, p)
  return p
}

export interface SelectCrop {
  /** URL of the image the grid cell draws. */
  image: string
  /** Region of `image`, in its own pixels, to frame. */
  rect: { x: number; y: number; w: number; h: number }
  /** Smooth-scale a supersampled still; keep the native atlas frame pixelated. */
  smooth: boolean
}

/**
 * Resolve what a select-grid cell should draw: the small pre-baked VS still when
 * the fighter ships one (smooth-scaled — it is a 2× supersample meant to be
 * *minified*), else the idle-frame crop straight out of the atlas (pixelated), so
 * the grid still paints for an un-baked fighter. The frame is bbox-tight in both
 * cases (portrait.json bakes the trimmed idle frame), so the caller's crop math
 * frames identically either way.
 */
export async function loadSelectCrop(rosterId: string): Promise<SelectCrop | null> {
  const vs = await loadVsPortrait(rosterId)
  if (vs) return { image: vs.image, rect: { x: 0, y: 0, w: vs.w, h: vs.h }, smooth: true }
  const pf = await loadPortrait(rosterId)
  return pf ? { image: pf.atlas, rect: pf.rect, smooth: false } : null
}

const vsImgCache = new Map<string, Promise<void>>()

/**
 * Warm the grid's images up front so it paints at once instead of popping in
 * one-by-one (the documented load race). Warms the small VS still when present,
 * else falls back to `preloadPortrait` (the atlas crop) so an un-baked fighter
 * still preloads. Resolves (never rejects) so callers can `Promise.all(...)`.
 */
export function preloadVsPortrait(rosterId: string): Promise<void> {
  return loadVsPortrait(rosterId).then((vs) => {
    if (!vs) return preloadPortrait(rosterId)
    if (typeof Image === 'undefined') return
    const cached = vsImgCache.get(vs.image)
    if (cached) return cached
    const warm = new Promise<void>((resolve) => {
      const img = new Image()
      img.onload = () => resolve()
      img.onerror = () => resolve()
      img.src = vs.image
    })
    vsImgCache.set(vs.image, warm)
    return warm
  })
}

/* ── Animated hero render (select screen) ──────────────────────────────────
 *
 * The v9 critic's #2: the select suite has "no large animated hero render of
 * the hovered fighter". The atlas already ships a real looping `idle` clip
 * (frame indices + per-frame sim-frame durations) — the same data the in-match
 * Fighter plays — so the hero render is not new art, it is the existing clip
 * finally consumed on the front door. Loading the whole frame table + the idle
 * clip here keeps every atlas decision in the HUD layer; HeroRender just asks
 * for a roster id and animates. */

export interface AtlasFrame {
  rect: { x: number; y: number; w: number; h: number }
  /** Feet position in px from the rect's top-left. Falls back to bottom-centre. */
  anchor: { x: number; y: number }
}
export interface AtlasClip {
  /** Indices into `frames`. */
  frames: number[]
  /** Per-entry hold in sim frames (60fps). */
  durations: number[]
  loop: boolean
}
export interface FighterAtlas {
  atlas: string
  frames: AtlasFrame[]
  /** The looping idle clip, or null when the atlas has none. */
  idle: AtlasClip | null
  /** Tallest idle-frame height, so a hero render can scale by a constant and
   *  not throb as frames change size. */
  refH: number
}

const atlasCache = new Map<string, Promise<FighterAtlas | null>>()

function idleClip(json: AssetsJson): AtlasClip | null {
  const c = json.clips?.['idle'] ?? json.clips?.['stance']
  if (!c || !c.frames?.length) return null
  return { frames: c.frames, durations: c.durations ?? [], loop: c.loop !== false }
}

/**
 * Resolve a fighter's full frame table + idle clip for the animated hero
 * render. Resolves to `null` (never rejects) on a missing/!ok atlas so a caller
 * can fall back to the static portrait crop; a fighter without an idle clip
 * resolves with `idle: null` and the caller shows a held pose.
 */
export function loadFighterAtlas(rosterId: string): Promise<FighterAtlas | null> {
  const hit = atlasCache.get(rosterId)
  if (hit) return hit
  const p = (async (): Promise<FighterAtlas | null> => {
    try {
      const res = await fetch(`/fighters/${rosterId}/assets.json`)
      if (!res.ok) return null
      const json = (await res.json()) as AssetsJson
      if (!json.frames?.length) return null
      const frames: AtlasFrame[] = json.frames.map((f) => ({
        rect: f.rect,
        anchor: f.anchor ?? { x: f.rect.w / 2, y: f.rect.h },
      }))
      const idle = idleClip(json)
      // Reference height: the tallest frame the idle actually visits, so the
      // constant hero scale is sized to the pose that needs the most room.
      let refH = 0
      const visited = idle?.frames ?? frames.map((_, i) => i)
      for (const i of visited) {
        const h = frames[i]?.rect.h ?? 0
        if (h > refH) refH = h
      }
      if (refH <= 0) refH = frames[0]?.rect.h || 1
      return { atlas: json.atlas || fighterAtlas(rosterId), frames, idle, refH }
    } catch {
      return null
    }
  })()
  atlasCache.set(rosterId, p)
  return p
}

/**
 * Index into `clip.frames` for an elapsed count of sim frames — the same clock
 * the in-match AnimationDriver uses, kept in sync so the front-door idle reads
 * identically to the fighting idle. Non-looping clips clamp at the last frame.
 */
export function frameAt(clip: AtlasClip, elapsed: number): number {
  const durs = clip.durations
  let total = 0
  for (let i = 0; i < clip.frames.length; i++) total += Math.max(1, durs[i] ?? 1)
  if (total <= 0) return clip.frames[0] ?? 0
  let t = clip.loop ? ((elapsed % total) + total) % total : Math.min(elapsed, total - 1)
  for (let i = 0; i < clip.frames.length; i++) {
    t -= Math.max(1, durs[i] ?? 1)
    if (t < 0) return clip.frames[i]
  }
  return clip.frames[clip.frames.length - 1]
}
