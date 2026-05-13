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
import os from 'node:os'
import { SCENARIOS } from '../src/data/scenarios'

// ── Azure config from env → ~/.gstack/openai.json
function loadAzureConfig() {
  const gstackPath = path.join(os.homedir(), '.gstack', 'openai.json')
  let file: any = {}
  try {
    if (fs.existsSync(gstackPath)) {
      file = JSON.parse(fs.readFileSync(gstackPath, 'utf-8'))
    }
  } catch { /* ignore */ }
  const azureFile = file?.azure || {}
  return {
    endpoint: (process.env.AZURE_OPENAI_ENDPOINT || azureFile.endpoint || '').replace(/\/$/, ''),
    apiKey: process.env.AZURE_OPENAI_API_KEY || azureFile.api_key || '',
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT || process.env.AZURE_OPENAI_IMAGE_DEPLOYMENT || azureFile.image_deployment || 'gpt-image-2',
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || azureFile.api_version || '2025-04-01-preview',
  }
}

const cfg = loadAzureConfig()
const ENDPOINT = cfg.endpoint
const DEPLOYMENT = cfg.deployment
const API_KEY = cfg.apiKey
const API_VERSION = cfg.apiVersion

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

async function generateOnce(_scenarioId: string, scene: string) {
  const prompt = MASTER_PROMPT.replace('{SCENE}', scene)
  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/images/generations?api-version=${API_VERSION}`
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 360_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'api-key': API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        n: 1,
        size: '1536x1024',
        quality: 'high',
        output_format: 'png',
      }),
      signal: ctl.signal,
    })
    if (!res.ok) throw new Error(`Azure ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const data = (await res.json()) as { data: Array<{ b64_json?: string; url?: string }> }
    const first = data.data[0]
    if (first.b64_json) return Buffer.from(first.b64_json, 'base64')
    if (first.url) {
      const r = await fetch(first.url)
      return Buffer.from(await r.arrayBuffer())
    }
    throw new Error('no image')
  } finally {
    clearTimeout(t)
  }
}

async function generate(scenarioId: string, scene: string) {
  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await generateOnce(scenarioId, scene)
    } catch (e) {
      lastErr = e as Error
      const msg = lastErr.message
      const retryable = /fetch failed|429|5\d\d|aborted|ECONNRESET/i.test(msg)
      if (!retryable || attempt === 4) throw lastErr
      const wait = Math.pow(3, attempt) * 1000 + Math.random() * 1500
      console.log(`    ↻ retry ${attempt}/3 after ${(wait / 1000).toFixed(1)}s — ${msg.slice(0, 80)}`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw lastErr ?? new Error('unknown')
}

async function main() {
  if (!ENDPOINT || !API_KEY) {
    console.error('Azure config not found. Set AZURE_OPENAI_* env vars or ~/.gstack/openai.json')
    process.exit(1)
  }
  console.log(`Using endpoint: ${ENDPOINT}\nDeployment: ${DEPLOYMENT}\n`)
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
