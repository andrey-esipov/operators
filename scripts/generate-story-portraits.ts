/**
 * Story Mode portrait generator — close-up bust shots for the 64 fighters.
 *
 * Each portrait is generated via Azure gpt-image-2's edit endpoint using
 * the fighter's `stance.png` as a reference image. Output is a head-and-
 * shoulders close-up that preserves the character's identity (same face,
 * hair, outfit accents) so dialogue cutscenes feel cohesive with combat.
 *
 * Usage:
 *   npx tsx scripts/generate-story-portraits.ts            # all fighters
 *   npx tsx scripts/generate-story-portraits.ts chesky     # one fighter
 *   npx tsx scripts/generate-story-portraits.ts --force    # regen existing
 *
 * Writes to public/story/portraits/<fighter-id>.png
 *
 * Cost: ~$0.04 per portrait, ~$2.56 for all 64. Skips fighters that have
 * an existing portrait unless --force is passed.
 */

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { FIGHTERS } from '../src/data/fighters'

function loadAzureConfig() {
  const gstackPath = path.join(os.homedir(), '.gstack', 'openai.json')
  let file: { azure?: { endpoint?: string; api_key?: string; image_deployment?: string; api_version?: string } } = {}
  try {
    if (fs.existsSync(gstackPath)) file = JSON.parse(fs.readFileSync(gstackPath, 'utf-8'))
  } catch { /* ignore */ }
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

const OUTPUT_DIR = path.resolve(process.cwd(), 'public/story/portraits')
const SPRITE_DIR = path.resolve(process.cwd(), 'public/sprites')

const PORTRAIT_PROMPT = `Redraw the EXACT SAME CHARACTER from the reference image as a head-and-shoulders close-up portrait.

CHARACTER REFERENCE (must match the reference image perfectly):
- Same face, eyes, hair color, hair style, skin tone
- Same exact outfit visible: shirt, jacket, accessories, glasses, etc.
- Same character description: {BIO}

POSE & FRAMING:
- Head-and-shoulders close-up bust shot (face fills the top half of the frame)
- Character facing slightly toward the viewer (3/4 angle, not full front, not full side)
- Confident, alert expression — like they're about to speak
- Pure flat solid mid-gray (#808080) background (no shadows, no texture)
- Character fills ~85% of the frame, centered

STYLE (matches the reference):
- 16-bit pixel art in the style of Street Fighter II / King of Fighters '98
- HARD CRISP pixel boundaries, NO anti-aliasing, NO blur
- Same limited color palette as the reference
- Hard cel-shaded shadows, vibrant arcade colors with strong dark outlines
- Stylized cartoonish proportions

STRICT: This is a CLOSE-UP PORTRAIT (head + shoulders only) of the same character from the reference, NOT a full-body sprite. Do not change the face, hair, or outfit.

OUTPUT: 1024x1024 PNG.`

async function generatePortrait(stanceBuf: Buffer, bio: string): Promise<Buffer> {
  const cfg = loadAzureConfig()
  if (!cfg.endpoint || !cfg.apiKey) {
    throw new Error('Azure config not found. Set AZURE_OPENAI_* env vars or ~/.gstack/openai.json')
  }
  const prompt = PORTRAIT_PROMPT.replace('{BIO}', bio)
  const url = `${cfg.endpoint}/openai/deployments/${cfg.deployment}/images/edits?api-version=${cfg.apiVersion}`

  const form = new FormData()
  const blob = new Blob([new Uint8Array(stanceBuf)], { type: 'image/png' })
  form.append('image', blob, 'stance.png')
  form.append('prompt', prompt)
  form.append('size', '1024x1024')
  form.append('quality', 'high')
  form.append('n', '1')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 300_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'api-key': cfg.apiKey },
      body: form,
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
    ? FIGHTERS.filter((f) => f.id === filterId)
    : FIGHTERS

  if (filterId && targets.length === 0) {
    console.error(`No fighter found with id "${filterId}"`)
    process.exit(1)
  }

  console.log(`Generating portraits for ${targets.length} fighter(s). Output: ${OUTPUT_DIR}`)
  let generated = 0
  let skipped = 0
  let failed = 0

  for (const fighter of targets) {
    const outPath = path.join(OUTPUT_DIR, `${fighter.id}.png`)
    if (!force && fs.existsSync(outPath)) {
      skipped++
      continue
    }
    const stancePath = path.join(SPRITE_DIR, fighter.id, 'stance.png')
    if (!fs.existsSync(stancePath)) {
      console.warn(`  ${fighter.id}: no stance sprite — skipping`)
      skipped++
      continue
    }
    const stanceBuf = fs.readFileSync(stancePath)
    const bio = fighter.spriteBio || fighter.bio
    process.stdout.write(`  ${fighter.id} ... `)
    try {
      const buf = await generatePortrait(stanceBuf, bio)
      fs.writeFileSync(outPath, buf)
      console.log('ok')
      generated++
    } catch (err) {
      console.log(`failed (${(err as Error).message.slice(0, 80)})`)
      failed++
    }
  }

  console.log(`Done. generated=${generated} skipped=${skipped} failed=${failed}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
