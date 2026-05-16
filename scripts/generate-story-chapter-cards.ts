/**
 * Story Mode chapter title-card backgrounds — 8 scenario-themed
 * cinematic backdrops for the chapter-intro cutscene beats.
 *
 * Each card is a wide stylized image of the scenario (Pre-PMF garage,
 * hypergrowth office, plateau boardroom, etc.) tinted in the scenario's
 * accent color and composed for a dramatic title-card overlay.
 *
 * Usage:
 *   npx tsx scripts/generate-story-chapter-cards.ts          # all 8
 *   npx tsx scripts/generate-story-chapter-cards.ts pre-pmf  # one
 *   npx tsx scripts/generate-story-chapter-cards.ts --force  # regen
 *
 * Writes to public/story/chapters/<scenario-id>.png
 *
 * Cost: 8 × $0.04 = $0.32 total.
 */

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SCENARIOS, SCENARIO_ORDER } from '../src/data/scenarios'

function loadAzureConfig() {
  const gstackPath = path.join(os.homedir(), '.gstack', 'openai.json')
  let file: { azure?: { endpoint?: string; api_key?: string; image_deployment?: string; api_version?: string } } = {}
  try { if (fs.existsSync(gstackPath)) file = JSON.parse(fs.readFileSync(gstackPath, 'utf-8')) } catch { /* ignore */ }
  const azureFile = file.azure ?? {}
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || azureFile.endpoint || '').replace(/\/$/, '')
  const apiKey = process.env.AZURE_OPENAI_API_KEY || azureFile.api_key || ''
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT
    || process.env.AZURE_OPENAI_IMAGE_DEPLOYMENT
    || azureFile.image_deployment
    || 'gpt-image-2'
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || azureFile.api_version || '2025-04-01-preview'
  return { endpoint, apiKey, deployment, apiVersion }
}

const OUTPUT_DIR = path.resolve(process.cwd(), 'public/story/chapters')

// Per-scenario prompt scaffolding — picks up the scenario's flavor.
const SCENE_HINTS: Record<string, string> = {
  'pre-pmf':       'A dimly lit garage at dusk, whiteboard scribbled with arrows and TODOs, takeout boxes, three monitors, dawn light through a single window. Lonely but determined.',
  hypergrowth:     'Open-plan startup office at 1am, monitors everywhere, whiteboards full of charts trending up, energy drinks, headphones, hires getting onboarded.',
  plateau:         'Empty corporate boardroom at sunset, polished mahogany table, half-erased whiteboard, single chair pulled out, low warm light.',
  'ai-native':     'A futuristic GPU datacenter, racks of servers lit cyan, fiber optics in the racks, a single operator at a workstation in the middle aisle.',
  monetization:    'A high-floor cap table room overlooking a city, glass walls, contracts spread on a long table, gold and burgundy accents, expensive watches on wrists.',
  crisis:          'Office mid-layoff: empty desks, packed cardboard boxes, an all-hands video call paused on a wall monitor, fluorescent lights, somber mood.',
  'ipo-prep':      'Massive TED-style conference stage with bright lighting, a single mic on the dais, a logo wall, banker faces in the front row.',
  distribution:    'The Hollywood Sign at golden hour seen from afar, billboards in the foreground, a film crew loading equipment, late summer warmth.',
}

const CARD_PROMPT = `A cinematic title-card background for the chapter "{NAME}" of a 16-bit pixel art fighting game set on Lenny's Podcast.

SCENE: {HINT}

STYLE:
- Pixel art in the style of Street Fighter II / King of Fighters '98 / 16-bit JRPG title cards
- HARD CRISP pixel boundaries — every pixel sharp, NO anti-aliasing, NO blur
- Limited 24-32 color palette, hard cel-shaded
- Vibrant saturated arcade colors
- Strong contrast — title text will overlay this, so the center is slightly darker than the edges
- Accent color: {ACCENT}
- Wide cinematic 16:9 framing

COMPOSITION:
- The scene fills the frame; no characters in the foreground
- Cinematic depth: foreground props, midground subject, background environment
- A negative space band across the middle ~30% where chapter title can overlay legibly

NEGATIVE:
- No characters or people in the foreground
- No text, watermarks, logos, captions, or UI
- No modern flat-illustration aesthetic
- No 3D rendered look or photorealism

OUTPUT: 1536x1024 PNG, pixel-art cinematic backdrop.`

async function generateCard(scenarioId: string): Promise<Buffer> {
  const cfg = loadAzureConfig()
  if (!cfg.endpoint || !cfg.apiKey) {
    throw new Error('Azure config not found. Set AZURE_OPENAI_* env vars or ~/.gstack/openai.json')
  }
  const scenario = SCENARIOS[scenarioId as keyof typeof SCENARIOS]
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`)

  const prompt = CARD_PROMPT
    .replace('{NAME}', scenario.name)
    .replace('{HINT}', SCENE_HINTS[scenarioId] ?? scenario.description)
    .replace('{ACCENT}', scenario.accent)

  const url = `${cfg.endpoint}/openai/deployments/${cfg.deployment}/images/generations?api-version=${cfg.apiVersion}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 300_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'api-key': cfg.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        size: '1536x1024',
        quality: 'high',
        n: 1,
        output_format: 'png',
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Azure ${res.status}: ${text.slice(0, 400)}`)
    }
    const data = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }> }
    const first = data.data?.[0]
    if (!first) throw new Error('No image in response')
    if (first.b64_json) return Buffer.from(first.b64_json, 'base64')
    if (first.url) {
      const imgRes = await fetch(first.url)
      return Buffer.from(await imgRes.arrayBuffer())
    }
    throw new Error('No b64 or url in Azure response')
  } finally {
    clearTimeout(timeout)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const filterId = args.find((a) => !a.startsWith('--'))

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const targets = filterId
    ? SCENARIO_ORDER.filter((s) => s === filterId)
    : SCENARIO_ORDER

  if (filterId && targets.length === 0) {
    console.error(`No scenario found with id "${filterId}"`)
    process.exit(1)
  }

  console.log(`Generating ${targets.length} chapter card(s). Output: ${OUTPUT_DIR}`)

  for (const scenarioId of targets) {
    const outPath = path.join(OUTPUT_DIR, `${scenarioId}.png`)
    if (!force && fs.existsSync(outPath)) {
      console.log(`  ${scenarioId}: exists, skipping (--force to regen)`)
      continue
    }
    process.stdout.write(`  ${scenarioId} ... `)
    try {
      const buf = await generateCard(scenarioId)
      fs.writeFileSync(outPath, buf)
      console.log('ok')
    } catch (err) {
      console.log(`failed (${(err as Error).message.slice(0, 80)})`)
    }
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
