/**
 * Generate 16-bit fighter sprites via Azure OpenAI gpt-image-2.
 *
 * Usage:
 *   npx tsx scripts/generate-fighter-sprites.ts              # all fighters
 *   npx tsx scripts/generate-fighter-sprites.ts chesky lenny # specific ones
 *
 * Reads fighter specs from src/data/fighters.ts (bio + accent).
 * Writes 4 sprites per fighter (stance, attack, win, lose) to public/sprites/<id>/<state>.png
 */

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { FIGHTERS } from '../src/data/fighters'

const ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT!.replace(/\/$/, '')
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-image-2'
const API_KEY = process.env.AZURE_OPENAI_API_KEY!
const API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview'

const OUTPUT_DIR = path.resolve(process.cwd(), 'public/sprites')

interface PoseSpec {
  state: 'stance' | 'attack' | 'win' | 'lose'
  description: string
}

const POSES: PoseSpec[] = [
  { state: 'stance',  description: 'fighting stance, side view, feet apart shoulder width, weight slightly forward, fists raised at chest level' },
  { state: 'attack',  description: 'mid-strike attack pose, forward lunging straight punch with right fist extended, other hand at hip, side view' },
  { state: 'win',     description: 'triumphant victory pose, both fists raised above head, smile, looking up' },
  { state: 'lose',    description: 'defeated knockdown, lying on side on the ground with one knee bent, side view' },
]

const MASTER_PROMPT = `16-bit pixel-art character sprite of {BIO} in {POSE_DESC}.

STYLE:
- Pixel art in the style of Street Fighter II / King of Fighters '98 / SF III Third Strike
- Hard crisp pixel boundaries, NO anti-aliasing, NO blur, NO soft edges
- Limited 24-color palette with cel-shaded hard shadows
- Vibrant saturated arcade colors
- Hi-contrast outlines around the character

FRAMING:
- Full body character sprite
- Side view, character faces RIGHT
- Pure flat background — solid mid-gray (#808080) so background can be removed cleanly
- The character takes up ~80% of the frame, centered

NEGATIVE:
- No anti-aliasing
- No soft edges or photorealistic shading
- No modern flat-illustration / Disney / Pixar style
- No 3D rendered look
- No watermark, no text, no logos

OUTPUT: 1024×1024 pixel art PNG, character sprite ready for game.`

async function generateSprite(fighterId: string, bio: string, pose: PoseSpec) {
  const prompt = MASTER_PROMPT
    .replace('{BIO}', bio)
    .replace('{POSE_DESC}', pose.description)

  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/images/generations?api-version=${API_VERSION}`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'api-key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'high',
      output_format: 'png',
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Azure gpt-image-2 ${res.status}: ${text}`)
  }

  const data = (await res.json()) as {
    data: Array<{ b64_json?: string; url?: string }>
  }
  const first = data.data[0]
  if (first.b64_json) {
    return Buffer.from(first.b64_json, 'base64')
  }
  if (first.url) {
    const imgRes = await fetch(first.url)
    return Buffer.from(await imgRes.arrayBuffer())
  }
  throw new Error('No image returned from Azure gpt-image-2')
}

async function main() {
  if (!ENDPOINT || !API_KEY) {
    console.error('Set AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY in your .env')
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const targets = args.length > 0
    ? FIGHTERS.filter((f) => args.includes(f.id))
    : FIGHTERS

  console.log(`Generating sprites for ${targets.length} fighters × ${POSES.length} poses = ${targets.length * POSES.length} images.`)
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  for (const fighter of targets) {
    const dir = path.join(OUTPUT_DIR, fighter.id)
    fs.mkdirSync(dir, { recursive: true })

    for (const pose of POSES) {
      const outPath = path.join(dir, `${pose.state}.png`)
      if (fs.existsSync(outPath) && !process.argv.includes('--force')) {
        console.log(`  · ${fighter.id}/${pose.state}.png exists — skipping (use --force to regenerate)`)
        continue
      }
      console.log(`  → ${fighter.id}/${pose.state}.png …`)
      try {
        const buf = await generateSprite(fighter.id, fighter.bio, pose)
        fs.writeFileSync(outPath, buf)
        console.log(`    ✓ wrote ${outPath}`)
      } catch (e) {
        console.warn(`    ✗ failed: ${(e as Error).message}`)
      }
      // Polite rate limit
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  console.log('Done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
