/**
 * Generate 16-bit pixel-art fighter sprites via Azure gpt-image-2.
 *
 * Config resolution (highest priority wins):
 *   1. Env vars (AZURE_OPENAI_ENDPOINT/API_KEY/DEPLOYMENT/API_VERSION)
 *   2. ~/.gstack/openai.json (astack's design backend config)
 *
 * Usage:
 *   npx tsx scripts/generate-fighter-sprites.ts              # all fighters
 *   npx tsx scripts/generate-fighter-sprites.ts chesky       # one fighter
 *   npx tsx scripts/generate-fighter-sprites.ts --force      # regen all
 *
 * Writes to public/sprites/<fighter-id>/<state>.png
 */

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { FIGHTERS } from '../src/data/fighters'

// ── Config: env → ~/.gstack/openai.json
function loadAzureConfig() {
  const gstackPath = path.join(os.homedir(), '.gstack', 'openai.json')
  let file: any = {}
  try {
    if (fs.existsSync(gstackPath)) {
      file = JSON.parse(fs.readFileSync(gstackPath, 'utf-8'))
    }
  } catch {
    // ignore
  }
  const azureFile = file?.azure || {}
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || azureFile.endpoint || '').replace(/\/$/, '')
  const apiKey = process.env.AZURE_OPENAI_API_KEY || azureFile.api_key || ''
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT
    || process.env.AZURE_OPENAI_IMAGE_DEPLOYMENT
    || azureFile.image_deployment
    || 'gpt-image-2'
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || azureFile.api_version || '2025-04-01-preview'
  return { endpoint, apiKey, deployment, apiVersion }
}

const OUTPUT_DIR = path.resolve(process.cwd(), 'public/sprites')

interface PoseSpec {
  state: 'stance' | 'attack' | 'win' | 'lose'
  description: string
}

const POSES: PoseSpec[] = [
  { state: 'stance',  description: 'side-view fighting stance, feet apart shoulder-width, weight forward, both fists raised at chest level, character facing right' },
  { state: 'attack',  description: 'mid-strike forward straight punch, right fist extended forward, body lunging forward, side view, character facing right' },
  { state: 'win',     description: 'triumphant victory pose, both fists raised high above head, smile, looking up' },
  { state: 'lose',    description: 'defeated knockdown, lying on side on the ground, one knee bent, side view' },
]

// Initial stance prompt — full character generation from scratch.
const STANCE_PROMPT = `A 16-bit pixel art character sprite of {BIO} in {POSE_DESC}.

STYLE:
- Pixel art in the unmistakable style of Street Fighter II, King of Fighters '98, and Street Fighter III: Third Strike
- HARD CRISP pixel boundaries — every pixel sharp, NO anti-aliasing, NO blur, NO soft edges, NO gradients
- Limited 16-24 color palette with hard cel-shaded shadows (NOT smooth shading)
- Vibrant saturated arcade colors with strong dark outlines around the character
- Stylized cartoonish proportions, NOT photorealistic

FRAMING:
- Full body character sprite
- Side view, character facing RIGHT
- Pure flat solid mid-gray (#808080) background (no shadows, no texture — just flat gray)
- Character takes ~80% of the frame, centered

NEGATIVE:
- No anti-aliasing or smooth edges
- No modern flat illustration style
- No Disney/Pixar/Dreamworks aesthetic
- No 3D rendered look
- No photographic realism
- No watermarks, no text, no logos
- No top-down JRPG view — this is a side-scrolling fighter

OUTPUT: 1024x1024 PNG, sharp pixel art sprite ready for a 2D fighting game.`

// Edit prompt — used when a stance.png exists. The model is given the
// stance as a reference image so it preserves the character identity
// (face, hair, build, outfit, accessories) and ONLY changes the body pose.
const EDIT_PROMPT = `Redraw the EXACT SAME CHARACTER from the reference image in a new body pose.

CHARACTER REFERENCE (must match the reference image perfectly):
- Same face, eyes, hair color, hair style, skin tone
- Same exact outfit: same shirt, same pants, same jacket, same shoes, same colors
- Same accessories (glasses, watches, hats, lanyards, props they hold)
- Same body build, height, proportions
- Same character description: {BIO}

ONLY CHANGE: The body pose to {POSE_DESC}

STYLE (matches the reference):
- 16-bit pixel art in the style of Street Fighter II / King of Fighters '98
- HARD CRISP pixel boundaries, NO anti-aliasing, NO blur
- Same limited color palette as the reference
- Same flat mid-gray (#808080) background
- Same framing: full body, ~80% of frame, centered
- Same canvas size: 1024x1024 PNG

STRICT: This must look like the same person in a different pose. Do not change the outfit, hair, or face.`

/** Stance pose: full character generation from scratch. */
async function generateStanceOnce(bio: string, pose: PoseSpec): Promise<Buffer> {
  const cfg = loadAzureConfig()
  if (!cfg.endpoint || !cfg.apiKey) {
    throw new Error('Azure config not found. Set AZURE_OPENAI_* env vars or ~/.gstack/openai.json')
  }
  const prompt = STANCE_PROMPT
    .replace('{BIO}', bio)
    .replace('{POSE_DESC}', pose.description)

  const url = `${cfg.endpoint}/openai/deployments/${cfg.deployment}/images/generations?api-version=${cfg.apiVersion}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 300_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'api-key': cfg.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        size: '1024x1024',
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

/**
 * Edit pose: takes the fighter's stance.png as a reference and asks the
 * model to redraw the same character in a new pose. This is the key
 * mechanism for character consistency across the 4-pose set — without
 * it, Azure's gpt-image-2 reinvents the character every call.
 */
async function editPoseOnce(stanceBuf: Buffer, bio: string, pose: PoseSpec): Promise<Buffer> {
  const cfg = loadAzureConfig()
  if (!cfg.endpoint || !cfg.apiKey) {
    throw new Error('Azure config not found.')
  }
  const prompt = EDIT_PROMPT
    .replace('{BIO}', bio)
    .replace('{POSE_DESC}', pose.description)

  const url = `${cfg.endpoint}/openai/deployments/${cfg.deployment}/images/edits?api-version=${cfg.apiVersion}`

  const form = new FormData()
  // Pass the stance as the reference image. `image` (singular) is the
  // standard edits-endpoint param; multi-image refs use `image[]` but
  // gpt-image-2 accepts both. Stick with `image` for the single-ref case.
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

/** Dispatcher: stance → generation, others → edit-with-stance-ref. */
async function generateSpriteOnce(
  bio: string,
  pose: PoseSpec,
  stanceBuf: Buffer | null,
): Promise<Buffer> {
  if (pose.state === 'stance' || !stanceBuf) {
    return generateStanceOnce(bio, pose)
  }
  return editPoseOnce(stanceBuf, bio, pose)
}

async function generateSprite(
  bio: string,
  pose: PoseSpec,
  stanceBuf: Buffer | null,
): Promise<Buffer> {
  // Azure's gpt-image-2 deployment hits EngineOverloaded waves; we need to
  // be very patient. 10 attempts with backoff capped at 90s gives ~6-8 minutes
  // of retry budget per sprite — enough to outlast typical overload windows.
  const maxAttempts = 10
  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await generateSpriteOnce(bio, pose, stanceBuf)
    } catch (e) {
      lastErr = e as Error
      const msg = lastErr.message
      const isRetryable =
        msg.includes('fetch failed') ||
        msg.includes('429') ||
        msg.includes('500') ||
        msg.includes('502') ||
        msg.includes('503') ||
        msg.includes('504') ||
        msg.includes('aborted') ||
        msg.includes('ECONNRESET') ||
        msg.includes('EngineOverloaded')
      if (!isRetryable || attempt === maxAttempts) throw lastErr
      // Exponential backoff capped at 90s + jitter: 5s, 15s, 45s, 90s, 90s, ...
      const base = Math.min(90_000, Math.pow(3, attempt) * 1000)
      const wait = base + Math.random() * 3000
      console.log(`    ↻ retry ${attempt}/${maxAttempts - 1} after ${(wait / 1000).toFixed(1)}s — ${msg.slice(0, 80)}`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw lastErr ?? new Error('unknown')
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const force = process.argv.includes('--force')
  const targets = args.length > 0
    ? FIGHTERS.filter((f) => args.includes(f.id))
    : FIGHTERS

  const cfg = loadAzureConfig()
  console.log(`Using Azure endpoint: ${cfg.endpoint || '(MISSING!)'}`)
  console.log(`Deployment: ${cfg.deployment}`)
  console.log(`Generating ${targets.length} fighters × ${POSES.length} poses = ${targets.length * POSES.length} sprites.\n`)

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  // CLI flag: --force-edits regenerates non-stance poses using the new
  // edit-based pipeline even if those PNGs already exist. Useful for
  // upgrading fighters that have visually-drifted poses.
  const forceEdits = process.argv.includes('--force-edits')

  for (const fighter of targets) {
    const dir = path.join(OUTPUT_DIR, fighter.id)
    fs.mkdirSync(dir, { recursive: true })

    // STEP 1: stance (the character anchor). Generate from scratch.
    const stancePath = path.join(dir, 'stance.png')
    let stanceBuf: Buffer | null = null
    if (fs.existsSync(stancePath) && !force) {
      console.log(`  · ${fighter.id}/stance.png exists — using as reference`)
      stanceBuf = fs.readFileSync(stancePath)
    } else {
      console.log(`  → ${fighter.id}/stance.png …`)
      try {
        stanceBuf = await generateSprite(fighter.bio, POSES[0], null)
        fs.writeFileSync(stancePath, stanceBuf)
        console.log(`    ✓ wrote ${stancePath} (${(stanceBuf.byteLength / 1024).toFixed(1)}KB)`)
      } catch (e) {
        console.warn(`    ✗ stance failed: ${(e as Error).message} — skipping rest of ${fighter.id}`)
        continue
      }
      await new Promise((r) => setTimeout(r, 15_000 + Math.random() * 5000))
    }

    // STEP 2: attack/win/lose — edit from stance reference so the character
    // identity stays locked.
    for (const pose of POSES.slice(1)) {
      const outPath = path.join(dir, `${pose.state}.png`)
      if (fs.existsSync(outPath) && !force && !forceEdits) {
        console.log(`  · ${fighter.id}/${pose.state}.png exists — skipping`)
        continue
      }
      console.log(`  → ${fighter.id}/${pose.state}.png (edit from stance) …`)
      try {
        const buf = await generateSprite(fighter.bio, pose, stanceBuf)
        fs.writeFileSync(outPath, buf)
        console.log(`    ✓ wrote ${outPath} (${(buf.byteLength / 1024).toFixed(1)}KB)`)
      } catch (e) {
        console.warn(`    ✗ failed: ${(e as Error).message}`)
      }
      // Polite rate limit
      await new Promise((r) => setTimeout(r, 15_000 + Math.random() * 5000))
    }
  }
  console.log('\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
