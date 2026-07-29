import type { QualityTier } from '../types'

/**
 * Boot-time quality selection.
 *
 * We can't measure GPU throughput before we've drawn anything, so we use the
 * usual proxies: reported renderer string, device memory, logical cores and
 * screen size. Deliberately optimistic — the engine's adaptive loop will drop
 * a tier within ~1.5s if we guessed too high, and starting high means capable
 * machines never see the cheap version even for a second.
 */
export function detectQuality(): QualityTier {
  if (typeof navigator === 'undefined') return 'high'

  const forced = readForcedQuality()
  if (forced) return forced

  const cores = navigator.hardwareConcurrency ?? 4
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  const gpu = detectGpuString().toLowerCase()

  // Known-slow integrated parts.
  const weakGpu = /(intel).*(hd|uhd) graphics (5|6)\d{2}/.test(gpu) || /swiftshader|llvmpipe|software/.test(gpu)
  if (weakGpu) return 'low'

  if (mobile) {
    // Apple silicon phones/tablets punch well above their core count.
    return /iphone|ipad/i.test(navigator.userAgent) ? 'high' : 'medium'
  }

  // Core count is the only CPU proxy we have. (navigator.deviceMemory is capped
  // at 8 by Chrome and undefined in Safari, so the old `mem >= 8` gate was true
  // on essentially every desktop — it measured nothing and is gone.) But CPU
  // says nothing about FILL rate, which is this renderer's actual bottleneck, so
  // core count alone must never buy the top tier.
  let tier: QualityTier =
    cores >= 8 ? 'ultra' : cores >= 6 ? 'high' : cores >= 4 ? 'medium' : 'low'

  // Fill-aware haircut. A high-DPI or oversized viewport pushes several times the
  // pixels of a 1080p/dpr1 panel through the same screen-space post stack, so the
  // ultra particle/crowd budget isn't affordable there whatever the core count.
  // Boot one tier down when the render budget is heavy; the runtime adaptor drops
  // further if needed, and pixelRatio is independently fill-capped in the Engine.
  if (tier === 'ultra' && bootFillBudgetPx() > HEAVY_FILL_PX) tier = 'high'
  return tier
}

/** Boot-time native render budget: CSS viewport area × devicePixelRatio². */
function bootFillBudgetPx(): number {
  if (typeof window === 'undefined') return 0
  const dpr = window.devicePixelRatio || 1
  const w = window.innerWidth || 1920
  const h = window.innerHeight || 1080
  return w * h * dpr * dpr
}

/** ~1080p/dpr1 is 2.07M px; 1080p Retina is 8.3M. 4M splits standard from heavy. */
const HEAVY_FILL_PX = 4_000_000

function readForcedQuality(): QualityTier | null {
  try {
    const q = new URLSearchParams(window.location.search).get('quality')
    if (q === 'low' || q === 'medium' || q === 'high' || q === 'ultra') return q
    const stored = localStorage.getItem('ops.quality')
    if (stored === 'low' || stored === 'medium' || stored === 'high' || stored === 'ultra') return stored
  } catch {
    /* ignore */
  }
  return null
}

let cachedGpu: string | null = null

/** Best-effort GPU name via WEBGL_debug_renderer_info. */
export function detectGpuString(): string {
  if (cachedGpu !== null) return cachedGpu
  cachedGpu = ''
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') ?? c.getContext('webgl')
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      if (ext) cachedGpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '')
      const lose = gl.getExtension('WEBGL_lose_context')
      lose?.loseContext()
    }
  } catch {
    /* ignore */
  }
  return cachedGpu
}

/** Feature gates keyed off the tier, so every subsystem agrees on what's on. */
export interface QualityFlags {
  shadows: boolean
  shadowMapSize: number
  bloom: boolean
  ssao: boolean
  depthOfField: boolean
  motionBlur: boolean
  chromaticAberration: boolean
  filmGrain: boolean
  volumetricLight: boolean
  reflections: boolean
  particleBudget: number
  crowdCount: number
  /** Anti-aliasing mode. */
  aa: 'none' | 'fxaa' | 'smaa'
}

export function flagsFor(q: QualityTier): QualityFlags {
  switch (q) {
    case 'low':
      return {
        shadows: false, shadowMapSize: 512, bloom: true, ssao: false,
        depthOfField: false, motionBlur: false, chromaticAberration: false,
        filmGrain: true, volumetricLight: false, reflections: false,
        particleBudget: 400, crowdCount: 0, aa: 'fxaa',
      }
    case 'medium':
      return {
        shadows: true, shadowMapSize: 1024, bloom: true, ssao: false,
        depthOfField: true, motionBlur: false, chromaticAberration: true,
        filmGrain: true, volumetricLight: true, reflections: false,
        particleBudget: 1200, crowdCount: 24, aa: 'smaa',
      }
    case 'high':
      return {
        shadows: true, shadowMapSize: 2048, bloom: true, ssao: true,
        depthOfField: true, motionBlur: true, chromaticAberration: true,
        filmGrain: true, volumetricLight: true, reflections: true,
        particleBudget: 3000, crowdCount: 48, aa: 'smaa',
      }
    case 'ultra':
      return {
        shadows: true, shadowMapSize: 2048, bloom: true, ssao: true,
        depthOfField: true, motionBlur: true, chromaticAberration: true,
        filmGrain: true, volumetricLight: true, reflections: true,
        particleBudget: 6000, crowdCount: 72, aa: 'smaa',
      }
  }
}
