/**
 * Which renderer draws the fight.
 *
 * The WebGL layer is the default, but the original 2D sprite path stays
 * reachable — it is the fallback when a machine has no usable GPU, and it
 * remains the reference for A/B comparing the new render layer.
 *
 * Resolution order: `?render=` query param > saved preference > 3D.
 */
export type RenderMode = '3d' | '2d'

const STORAGE_KEY = 'operators:renderMode'

function fromQuery(): RenderMode | null {
  if (typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get('render')
  return v === '2d' || v === '3d' ? v : null
}

function fromStorage(): RenderMode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === '2d' || v === '3d' ? v : null
  } catch {
    return null
  }
}

/** True when the browser can actually run the WebGL2 render layer. */
export function supportsWebGL2(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return !!canvas.getContext('webgl2')
  } catch {
    return false
  }
}

export function getRenderMode(): RenderMode {
  const forced = fromQuery()
  if (forced) return forced === '3d' && !supportsWebGL2() ? '2d' : forced
  const saved = fromStorage()
  if (saved) return saved === '3d' && !supportsWebGL2() ? '2d' : saved
  return supportsWebGL2() ? '3d' : '2d'
}

export function setRenderMode(mode: RenderMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* private mode — the choice just won't persist */
  }
}
