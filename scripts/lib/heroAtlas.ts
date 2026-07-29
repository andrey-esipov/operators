import sharp from 'sharp'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FighterAssets } from '../../src/fight/types'

/**
 * The reduced "hero" opener atlas — the progressive/low-res tier for the attract
 * reel's FIRST bout on a reported-slow connection.
 *
 * WHY THIS EXISTS. The first-bout download budget (attractLoadCost.ts) keeps the
 * heaviest atlases off the opener on a slow link. As the funded art run grows
 * those atlases the budget admits fewer and fewer openers — a ratchet that ends
 * with the shop window opening on the LIGHTEST art precisely because the heavy
 * art got better. `Infinity` broke that ratchet on FAST links by removing the
 * cap; this breaks it on SLOW links by removing the *coupling*: the opener is
 * served (and priced) from a reduced hero atlas whose bytes are decoupled from
 * the full atlas, so improving the full art can no longer cost a pairing.
 *
 * HOW IT'S CORRECT WITHOUT A RENDERER CHANGE. The renderer is
 * resolution-independent: it derives world size from `heightCm /
 * refFrame.rect.h` and every UV as `rect / atlasDim` (see Fighter.ts and the
 * SCALE=2 note in generate-animation-set.ts — "2x pixels render at the same
 * world size with twice the detail, no renderer change"). A hero variant is the
 * inverse of that: scale the atlas image AND every frame rect/anchor by the same
 * factor, and every ratio the renderer computes is invariant — the sprite draws
 * at an IDENTICAL world size and pose, only at lower fidelity. So a hero atlas is
 * loaded through the exact same path as the full one (a self-consistent
 * manifest+image pair), and the only thing that changes on screen is sharpness —
 * which is the single property that needs visual sign-off.
 */

/**
 * Linear downscale for the hero atlas. 0.5 ⇒ a quarter of the pixels and half
 * the linear detail at an IDENTICAL rendered world size. Chosen as the highest
 * fidelity that still makes every slow opener fast: at 0.5 the heaviest hero
 * pairing is ~2.7 MB (~14 s at Lighthouse slow-4G) against the ~6.6 MB / 33 s
 * budget, so every roster pairing is admissible on slow (the concentration onto
 * the lightest atlas is gone) with headroom to spare for future art growth.
 * Lower scales (0.375, 0.25) fit too but trade sharpness the opener does not
 * need to spend — see the task report's measured table.
 */
export const HERO_ATLAS_SCALE = 0.5

/**
 * webp encode for the hero variant. `alphaQuality: 100` keeps the silhouette
 * keyline / coverage-AA edge as crisp as a half-res raster allows (the edge is
 * where this project invests, so it is the one channel not traded); colour
 * `quality: 80` is invisible at opener scale and buys the download win; `effort:
 * 6` matches the shipped full-atlas encode.
 */
export const HERO_WEBP_OPTS = { quality: 80, alphaQuality: 100, effort: 6 } as const

/** Conventional on-disk names, kept next to the full atlas under the fighter dir. */
export const HERO_ATLAS_FILENAME = 'atlas.hero.webp'
export const HERO_MANIFEST_FILENAME = 'assets.hero.json'
/** Public URL the hero manifest's `atlas` field points at, resolved by the loader. */
export const heroAtlasPublicPath = (id: string): string => `/fighters/${id}/${HERO_ATLAS_FILENAME}`

/**
 * Scale a full-res manifest's frame rects and anchors by the actual per-axis
 * resize ratio, returning a hero manifest pointing at the hero atlas. Every rect
 * and anchor is scaled by the SAME ratio the atlas image is, so the renderer's
 * ratios — `rect/atlasDim` (UV), `rect.w / refFrame.rect.h` (world size),
 * `anchor/rect` (pivot) — are all invariant. `clips`, `heightCm` and `id` carry
 * over unchanged: the animation topology and world scale are identical, only the
 * pixel resolution drops.
 */
export function scaleHeroManifest(
  full: FighterAssets,
  heroAtlasPath: string,
  sx: number,
  sy: number,
): FighterAssets {
  return {
    ...full,
    atlas: heroAtlasPath,
    frames: full.frames.map((f) => ({
      name: f.name,
      rect: {
        x: Math.round(f.rect.x * sx),
        y: Math.round(f.rect.y * sy),
        w: Math.max(1, Math.round(f.rect.w * sx)),
        h: Math.max(1, Math.round(f.rect.h * sy)),
      },
      anchor: { x: Math.round(f.anchor.x * sx), y: Math.round(f.anchor.y * sy) },
    })),
  }
}

export interface HeroBuildResult {
  id: string
  fullBytes: number
  heroBytes: number
  fullDim: [number, number]
  heroDim: [number, number]
  wroteAtlas: boolean
  wroteManifest: boolean
}

function writeIfChanged(path: string, next: Buffer): boolean {
  if (existsSync(path)) {
    const prev = readFileSync(path)
    if (prev.equals(next)) return false
  }
  writeFileSync(path, next)
  return true
}

/**
 * Build (or refresh) a fighter's hero atlas + hero manifest from its full atlas
 * on disk. Idempotent — rewrites a file only when its bytes change, so a re-run
 * on an unchanged roster is a no-op (and the committed-vs-disk freshness gate
 * stays green). Returns null when the fighter has no manifest or full atlas.
 */
export async function buildHeroAtlas(id: string, publicDir: string): Promise<HeroBuildResult | null> {
  const dir = resolve(publicDir, 'fighters', id)
  const manifestPath = resolve(dir, 'assets.json')
  if (!existsSync(manifestPath)) return null
  const full = JSON.parse(readFileSync(manifestPath, 'utf-8')) as FighterAssets
  const fullAtlasPath = resolve(publicDir, (full.atlas ?? `/fighters/${id}/atlas.webp`).replace(/^\/+/, ''))
  if (!existsSync(fullAtlasPath)) return null

  const md = await sharp(fullAtlasPath).metadata()
  const fullW = md.width ?? 0
  const fullH = md.height ?? 0
  if (!fullW || !fullH) return null
  const heroW = Math.max(1, Math.round(fullW * HERO_ATLAS_SCALE))
  const heroH = Math.max(1, Math.round(fullH * HERO_ATLAS_SCALE))
  const sx = heroW / fullW
  const sy = heroH / fullH

  const heroBuf = await sharp(fullAtlasPath)
    .resize(heroW, heroH, { kernel: 'lanczos3' })
    .webp(HERO_WEBP_OPTS)
    .toBuffer()
  const heroAtlasPath = resolve(dir, HERO_ATLAS_FILENAME)
  const wroteAtlas = writeIfChanged(heroAtlasPath, heroBuf)

  const heroManifest = scaleHeroManifest(full, heroAtlasPublicPath(id), sx, sy)
  const heroManifestPath = resolve(dir, HERO_MANIFEST_FILENAME)
  const wroteManifest = writeIfChanged(heroManifestPath, Buffer.from(JSON.stringify(heroManifest, null, 2) + '\n'))

  return {
    id,
    fullBytes: statSync(fullAtlasPath).size,
    heroBytes: statSync(heroAtlasPath).size,
    fullDim: [fullW, fullH],
    heroDim: [heroW, heroH],
    wroteAtlas,
    wroteManifest,
  }
}
