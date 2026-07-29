/**
 * Loads a fighter's real generated animation set.
 *
 * These atlases — 37 frames and ~55 named clips per fighter, including one per
 * move id — were generated, committed and then never rendered. Both entry
 * points called `buildMockAtlas()`, which reads the four legacy PNGs under
 * `public/sprites/<id>/` and maps *every* hurt state onto the same lying-down
 * `lose` frame: `hurt`, `juggle`, `knockdown` and `ko` were all one prone
 * image, `jump` and `walk` were both the standing `stance`, and all six attack
 * buttons were a single `attack` pose.
 *
 * That one indirection produced most of what the visual critique blamed on
 * lighting and VFX: "airborne reads as the ground idle translated upward",
 * "the victim lies prone while the attacker punches the air above them", and
 * "no startup/active/recovery". The animation existed the whole time; nothing
 * pointed at it.
 *
 * Only part of the roster has a generated set, so this falls back to the mock
 * rather than failing — but the fallback is reported, because silently
 * rendering the four-pose stand-in is exactly how this went unnoticed.
 */

import type { FighterAssets } from '../../fight/types'
import { buildMockAtlas } from './mockAtlas'
import type { AtlasSource } from './AtlasTextures'

export interface LoadedAtlas {
  assets: FighterAssets
  atlas: AtlasSource
  /** False when we fell back to the four-pose stand-in. */
  real: boolean
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`atlas image failed: ${src}`))
    img.src = src
  })
}

/** Fighters whose generated set is present under `public/fighters/<id>/`. */
async function loadFromManifest(id: string, manifestUrl: string, heroFallback: boolean): Promise<LoadedAtlas> {
  const res = await fetch(manifestUrl)
  // A dev server happily returns index.html for a missing asset, so a 200 is
  // not enough — the payload has to actually parse as an atlas manifest.
  if (!res.ok) throw new Error(`no manifest (${res.status})`)
  const assets = (await res.json()) as FighterAssets
  if (!assets?.frames?.length || !assets?.clips) throw new Error('manifest is not an atlas')
  const atlas = await loadImage(assets.atlas ?? `/fighters/${id}/atlas${heroFallback ? '.hero' : ''}.webp`)
  return { assets, atlas, real: true }
}

/**
 * Load a fighter's animation set. `variant` selects the atlas tier: 'full' (the
 * default, and every existing caller) loads the shipped full-res atlas; 'hero'
 * loads the reduced opener atlas (`assets.hero.json` / `atlas.hero.webp`) used for
 * the attract opener on a reported-slow link. A hero request that cannot be
 * satisfied — a fighter without a hero variant, or a decode failure — falls back
 * to the FULL atlas (correct art, not the 4-pose mock); only a failed FULL load
 * degrades to the stand-in, exactly as before.
 */
export async function loadFighterAtlas(id: string, variant: 'full' | 'hero' = 'full'): Promise<LoadedAtlas> {
  if (variant === 'hero') {
    try {
      return await loadFromManifest(id, `/fighters/${id}/assets.hero.json`, true)
    } catch (err) {
      console.warn(
        `[atlas] "${id}" hero variant unavailable (${
          err instanceof Error ? err.message : err
        }) — using full atlas for the opener.`,
      )
    }
  }
  try {
    return await loadFromManifest(id, `/fighters/${id}/assets.json`, false)
  } catch (err) {
    console.warn(
      `[atlas] "${id}" has no generated animation set (${
        err instanceof Error ? err.message : err
      }) — falling back to the 4-pose stand-in. Hurt, juggle, knockdown and KO ` +
        'will all render as the same prone frame.',
    )
    const mock = await buildMockAtlas(id)
    return { assets: mock.assets, atlas: mock.atlas, real: false }
  }
}
