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

const MASTER_PROMPT = `A 16-bit pixel art character sprite of {BIO} in {POSE_DESC}.

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

async function generateSpriteOnce(bio: string, pose: PoseSpec): Promise<Buffer> {
  const cfg = loadAzureConfig()
  if (!cfg.endpoint || !cfg.apiKey) {
    throw new Error('Azure config not found. Set AZURE_OPENAI_* env vars or ~/.gstack/openai.json')
  }
  const prompt = MASTER_PROMPT
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

async function generateSprite(bio: string, pose: PoseSpec): Promise<Buffer> {
  const maxAttempts = 4
  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await generateSpriteOnce(bio, pose)
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
        msg.includes('ECONNRESET')
      if (!isRetryable || attempt === maxAttempts) throw lastErr
      // Exponential backoff: 3s, 9s, 27s
      const wait = Math.pow(3, attempt) * 1000 + Math.random() * 1500
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

  for (const fighter of targets) {
    const dir = path.join(OUTPUT_DIR, fighter.id)
    fs.mkdirSync(dir, { recursive: true })

    for (const pose of POSES) {
      const outPath = path.join(dir, `${pose.state}.png`)
      if (fs.existsSync(outPath) && !force) {
        console.log(`  · ${fighter.id}/${pose.state}.png exists — skipping (use --force)`)
        continue
      }
      console.log(`  → ${fighter.id}/${pose.state}.png …`)
      try {
        const buf = await generateSprite(fighter.bio, pose)
        fs.writeFileSync(outPath, buf)
        console.log(`    ✓ wrote ${outPath} (${(buf.byteLength / 1024).toFixed(1)}KB)`)
      } catch (e) {
        console.warn(`    ✗ failed: ${(e as Error).message}`)
      }
      // Polite rate limit
      await new Promise((r) => setTimeout(r, 800))
    }
  }
  console.log('\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
