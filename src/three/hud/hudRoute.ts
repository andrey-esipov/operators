/** Route helper for the standalone HUD preview. */
export function isHudRoute(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('hud') === '1'
}

export function hudQuery(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams()
  return new URLSearchParams(window.location.search)
}
