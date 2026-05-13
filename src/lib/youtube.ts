import episodeMap from '../data/episode-youtube.json'

interface Entry { videoId: string; url: string }
const MAP = episodeMap as Record<string, Entry>

/** "MM:SS" or "HH:MM:SS" → seconds */
function timestampToSeconds(ts: string | undefined): number {
  if (!ts) return 0
  const parts = ts.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return 0
}

/**
 * Build a deep-link to the YouTube episode at a specific timestamp.
 * Returns null if we don't have a video for this fighter.
 */
export function youtubeDeepLink(fighterId: string, timestamp?: string): string | null {
  const entry = MAP[fighterId]
  if (!entry) return null
  const t = timestampToSeconds(timestamp)
  return t > 0 ? `${entry.url}&t=${t}s` : entry.url
}

export function hasYouTube(fighterId: string): boolean {
  return fighterId in MAP
}
