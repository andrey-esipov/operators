/**
 * Generate 16-bit pixel-art stage backgrounds via Azure OpenAI gpt-image-2.
 *
 * Each stage gets a single composed background image (back + mid + foreground
 * blended for now; we can split into parallax layers later).
 *
 * Usage:
 *   npx tsx scripts/generate-stage-backgrounds.ts
 */

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { SCENARIOS } from '../src/data/scenarios'

const ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT!.replace(/\/$/, '')
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-image-2'
const API_KEY = process.env.AZURE_OPENAI_API_KEY!
const API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview'

const OUT_DIR = path.resolve(process.cwd(), 'public/stages')

const STAGE_PROMPTS: Record<string, string> = {
  'pre-pmf':
    'a startup garage office at night, whiteboards covered in scribbled diagrams, glowing computer monitors, takeout boxes, exposed brick wall, warm orange lamps, side-on perspective designed for a 2D fighting game backdrop',
  hypergrowth:
    'a hypergrowth tech office at peak hour, wall of monitors with rising charts, people in motion blur, cyan/teal neon lighting, glass partitions, side-on perspective for 2D fighting game backdrop',
  plateau:
    'a stalled corporate boardroom with empty chairs at sunset, dramatic light through tall windows, single suit silhouette in foreground, purple/magenta tones, side-on perspective for 2D fighting game backdrop',
  'ai-native':
    'an AI datacenter with rows of GPU racks, blue and green neon glow, cables snaking across the floor, cooling steam rising, side-on perspective for 2D fighting game backdrop',
  monetization:
    'an executive negotiation room with stacks of contracts on a polished table, suited silhouettes around it, gold accents, dim warm light, side-on perspective for 2D fighting game backdrop',
  crisis:
    'an empty office during a layoff, boxes packed by abandoned desks, single desk lamp on, red emergency exit sign glowing, ominous purple-red lighting, side-on perspective for 2D fighting game backdrop',
  'ipo-prep':
    'a packed conference auditorium with a massive presentation screen, single spotlight on an empty stage, hundreds of seats occupied by silhouettes, blue stage lighting, side-on perspective for 2D fighting game backdrop',
  distribution:
    'the Hollywood Sign on a hill at golden hour, palm trees in foreground, the Los Angeles cityscape sprawling below, orange-pink sky, side-on perspective for 2D fighting game backdrop',
}

const MASTER_PROMPT = `16-bit pixel-art stage background of {SCENE}.

STYLE:
- Pixel art in the style of Street Fighter II stages and King of Fighters '98
- Hard crisp pixel boundaries, NO anti-aliasing, NO blur
- Limited 32-color palette with cel-shaded hard shadows
- Vibrant saturated arcade colors
- Painterly pixel art reminiscent of Eastward or Octopath Traveler backgrounds

COMPOSITION:
- Wide cinematic 16:9 horizontal composition
- No characters in scene
- Side-view perspective (matches a side-scrolling fighting game)
- Designed as a fighting game background — there is empty space where fighters would stand
- Visible depth via parallax-style layering (sky/background/midground/foreground)

NEGATIVE:
- No anti-aliasing
- No characters or people in clear focus (silhouettes far away are OK)
- No text, no UI, no logos, no watermark
- No 3D rendered look

OUTPUT: 1792×1024 pixel art PNG, ready for use as a 2D fighting game stage.`

async function generate(scenarioId: string, scene: string) {
  const prompt = MASTER_PROMPT.replace('{SCENE}', scene)
  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/images/generations?api-version=${API_VERSION}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      n: 1,
      size: '1792x1024',
      quality: 'high',
      output_format: 'png',
    }),
  })
  if (!res.ok) throw new Error(`Azure ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { data: Array<{ b64_json?: string; url?: string }> }
  const first = data.data[0]
  if (first.b64_json) return Buffer.from(first.b64_json, 'base64')
  if (first.url) {
    const r = await fetch(first.url)
    return Buffer.from(await r.arrayBuffer())
  }
  throw new Error('no image')
}

async function main() {
  if (!ENDPOINT || !API_KEY) {
    console.error('Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY in your .env')
    process.exit(1)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })

  for (const [id, scenario] of Object.entries(SCENARIOS)) {
    const out = path.join(OUT_DIR, `${id}.png`)
    if (fs.existsSync(out) && !process.argv.includes('--force')) {
      console.log(`· ${id}.png exists — skipping`)
      continue
    }
    console.log(`→ ${id} (${scenario.name}) …`)
    try {
      const buf = await generate(id, STAGE_PROMPTS[id])
      fs.writeFileSync(out, buf)
      console.log(`  ✓ wrote ${out}`)
    } catch (e) {
      console.warn(`  ✗ failed: ${(e as Error).message}`)
    }
    await new Promise((r) => setTimeout(r, 700))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
