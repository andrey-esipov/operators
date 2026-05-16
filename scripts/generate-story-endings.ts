/**
 * Story Mode career-ending splash generator — bespoke full-canvas
 * artwork for the marquee 8's StoryEnding screen.
 *
 * Each splash is a cinematic full-bleed image that captures the
 * operator's iconic moment (Chesky on a TED stage, Spiegel at a
 * Snap launch, Reid hosting Masters of Scale, etc.). Used as the
 * background for the career-ending screen.
 *
 * Usage:
 *   npx tsx scripts/generate-story-endings.ts          # all marquee
 *   npx tsx scripts/generate-story-endings.ts chesky   # one fighter
 *   npx tsx scripts/generate-story-endings.ts --force  # regen
 *
 * Writes to public/story/endings/<fighter-id>.png
 *
 * Cost: 8 × $0.04 = $0.32 total.
 */

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { getFighter } from '../src/data/fighters'

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

const OUTPUT_DIR = path.resolve(process.cwd(), 'public/story/endings')

/**
 * Per-fighter bespoke scene description. The marquee 8 each get a
 * specific "their iconic moment" prompt. Non-marquee fighters can use
 * a procedural fallback (not generated here — StoryEnding handles it).
 */
const ENDING_SCENES: Record<string, string> = {
  chesky:
    "Brian Chesky standing alone on a massive TED-style conference stage, arms slightly raised in victory, microphone clipped to his blazer, Airbnb city skyline projected behind him, warm golden spotlight, audience silhouettes in the dark front row.",
  amjad:
    "Amjad Masad at a developer keynote, holding a glowing laptop showing the Replit logo, a holographic projection of code agents shipping PRs floating around him, packed amphitheater of builders in the background, deep blue accent lighting.",
  boris:
    "Boris Cherny at a terminal with multiple agents running in parallel — split-screen monitors showing 'CLAUDE CODE' commits flying by, dim warm light, cup of coffee on the desk, expression of quiet focus.",
  altman:
    "Sam Altman at a podium at OpenAI DevDay, simple white backdrop with a small OpenAI logo, hands clasped, calm and measured, soft spotlight, suggestion of an enormous audience in shadow.",
  benioff:
    "Marc Benioff in his signature Hawaiian-print blazer on a massive Dreamforce stage, both arms raised, Salesforce cloud logo as a giant glowing pixel-art icon behind him, balloons and confetti in the foreground.",
  feifei:
    "Fei-Fei Li in a Stanford research lab at dusk, standing in front of an enormous ImageNet visualization on screens, holographic point cloud of a 3D world floating beside her, blue and white research-lab lighting, books and a laptop on a desk.",
  elena:
    "Elena Verna in front of a wall-sized growth dashboard with a hockey-stick aha-moment curve glowing, marker in hand, energetic mid-explanation, a small startup conference audience visible in soft focus, magenta-and-yellow growth deck accent palette.",
  reid:
    "Reid Hoffman at a Greylock boardroom table, leather-bound notebook open, a microphone in front of him (Masters of Scale studio), framed LinkedIn early sketches on the wall, deep navy and Greylock-blue lighting, contemplative.",
  lenny:
    "Lenny Rachitsky alone in his podcast studio at night, hand-thrown ceramic mug in hand, three-microphone setup glowing, framed episode posters of operators on the wall behind him (Chesky, Doshi, Altman silhouettes), deep purple and gold accent lighting, quiet focus.",
}

const ENDING_PROMPT = `A cinematic 16-bit pixel art career-ending splash for the fighting game OPERATORS.

SUBJECT: {NAME}, the operator at the climax of their career arc.

SCENE: {SCENE}

STYLE:
- Pixel art in the style of Street Fighter II / King of Fighters '98 / Castlevania title screens
- HARD CRISP pixel boundaries — every pixel sharp, NO anti-aliasing, NO blur
- Limited 32-color palette, hard cel-shaded shadows
- Vibrant saturated arcade colors with strong dark outlines around the subject
- Wide cinematic framing — the subject takes the center, environment fills the rest
- Strong rim-light on the subject so they read against the background

COMPOSITION:
- The operator is THE focal point — recognizable face/build/outfit
- Environment supports the story moment, not just decoration
- A negative space band along the bottom 25% for a tagline to overlay legibly
- Accent color: {ACCENT}

NEGATIVE:
- No text, watermarks, logos, captions, UI elements, or banners in the image
- No modern flat-illustration aesthetic
- No 3D rendered look or photorealism
- No multiple character compositions — one operator only

OUTPUT: 1536x1024 PNG, cinematic pixel-art career-ending splash.`

async function generateEnding(fighterId: string): Promise<Buffer> {
  const cfg = loadAzureConfig()
  if (!cfg.endpoint || !cfg.apiKey) {
    throw new Error('Azure config not found. Set AZURE_OPENAI_* env vars or ~/.gstack/openai.json')
  }
  const fighter = getFighter(fighterId)
  if (!fighter) throw new Error(`Unknown fighter: ${fighterId}`)
  const scene = ENDING_SCENES[fighterId]
  if (!scene) throw new Error(`No bespoke ending scene for ${fighterId} — add one to ENDING_SCENES`)

  const prompt = ENDING_PROMPT
    .replace('{NAME}', fighter.name)
    .replace('{SCENE}', scene)
    .replace('{ACCENT}', fighter.accent ?? '#FFD60A')

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

  const allIds = Object.keys(ENDING_SCENES)
  const targets = filterId ? allIds.filter((id) => id === filterId) : allIds

  if (filterId && targets.length === 0) {
    console.error(`No ending scene for "${filterId}". Available: ${allIds.join(', ')}`)
    process.exit(1)
  }

  console.log(`Generating ${targets.length} career ending(s). Output: ${OUTPUT_DIR}`)

  for (const fighterId of targets) {
    const outPath = path.join(OUTPUT_DIR, `${fighterId}.png`)
    if (!force && fs.existsSync(outPath)) {
      console.log(`  ${fighterId}: exists, skipping (--force to regen)`)
      continue
    }
    process.stdout.write(`  ${fighterId} ... `)
    try {
      const buf = await generateEnding(fighterId)
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
