/**
 * Build src/data/episode-youtube.json — a fighter-id → YouTube video_id map
 * sourced from the per-fighter transcript frontmatter.
 *
 * Use:  npx tsx scripts/extract-youtube-map.ts
 */
import fs from 'node:fs'
import path from 'node:path'

const DATASET_DIR = path.resolve(process.cwd(), 'dataset/03-podcasts')

// Same mapping as scripts/extract-quote-pool.ts — keep in sync
const FIGHTER_TRANSCRIPTS: Record<string, string[]> = {
  chesky: ['brian-chesky'],
  doshi: ['shreyas-doshi'],
  catwu: ['cat-wu'],
  madhavan: ['madhavan-ramanujam'],
  spiegel: ['evan-spiegel'],
  turley: ['nick-turley'],
  cagan: ['marty-cagan'],
  altman: ['sam-altman', 'altman'],
  taylor: ['bret-taylor'],
  lazar: ['lazar-jovanovic'],
  amjad: ['amjad-masad'],
  gokul: ['gokul-rajaram'],
  dunford: ['april-dunford'],
  andreessen: ['marc-andreessen'],
  tobi: ['tobi-lutke'],
  drew: ['drew-houston'],
  dylan: ['dylan-field'],
  krieger: ['mike-krieger'],
  stewart: ['stewart-butterfield'],
  jason: ['jason-fried'],
  simon: ['simon-willison'],
  seth: ['seth-godin'],
  nikita: ['nikita-bier'],
  julie: ['julie-zhuo'],
  annie: ['annie-duke'],
  boris: ['boris-cherny'],
  lenny: [],  // host — no single episode
}

function readYouTubeMeta(filePath: string): { url: string | null; videoId: string | null } {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const urlMatch = content.match(/youtube_url:\s*"([^"]+)"/)
    const idMatch = content.match(/video_id:\s*"([^"]+)"/)
    return {
      url: urlMatch?.[1] ?? null,
      videoId: idMatch?.[1] ?? null,
    }
  } catch {
    return { url: null, videoId: null }
  }
}

async function main() {
  const files = fs.readdirSync(DATASET_DIR)
  const out: Record<string, { videoId: string; url: string }> = {}

  for (const [fighterId, slugs] of Object.entries(FIGHTER_TRANSCRIPTS)) {
    if (slugs.length === 0) continue
    // Find the first matching transcript and read its metadata
    const match = files.find((f) => slugs.some((s) => f.toLowerCase().includes(s)))
    if (!match) {
      console.log(`  ✗ ${fighterId}: no transcript found for slugs ${slugs.join(', ')}`)
      continue
    }
    const meta = readYouTubeMeta(path.join(DATASET_DIR, match))
    if (meta.videoId && meta.url) {
      out[fighterId] = { videoId: meta.videoId, url: meta.url }
      console.log(`  ✓ ${fighterId}: ${meta.videoId}`)
    } else {
      console.log(`  ✗ ${fighterId}: no YouTube metadata in ${match}`)
    }
  }

  const outPath = path.resolve(process.cwd(), 'src/data/episode-youtube.json')
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log(`\nWrote ${outPath} (${Object.keys(out).length} entries)`)
}

main().catch(console.error)
