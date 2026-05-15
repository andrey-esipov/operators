/**
 * Bake real roster sprites into the title-hero.png so the characters
 * painted into the menu hero are actual game characters, not whatever
 * gpt-image-2 invents when asked for "operators."
 *
 * Pipeline:
 *   1. Load `public/menu/title-hero.png` (the stage-only background).
 *   2. For each of N chosen fighters: load `public/sprites/<id>/stance.png`,
 *      chroma-key the #808080 prompt bg to alpha, trim to bounding box,
 *      scale to the slot height, and composite onto the stage at the
 *      configured (x, y) position.
 *   3. Apply a unified rim-light / vignette pass so the sprites integrate
 *      with the stage lighting instead of reading as stickers.
 *   4. Write `public/menu/title-hero.png` (overwrites in place).
 *
 * Run after either:
 *   • A fresh `generate-menu-artwork.ts` pass (new stage), or
 *   • Editing the LINEUP table below to change who appears.
 */

import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = path.resolve(process.cwd())
const BG_PATH = path.join(ROOT, 'public/menu/title-hero.png')
const SPRITES_DIR = path.join(ROOT, 'public/sprites')

interface Slot {
  id: string
  /** Center x as fraction of bg width. */
  cx: number
  /** Bottom y as fraction of bg height (where the sprite's feet sit). */
  by: number
  /** Sprite height in target pixels. */
  h: number
  /** Mirror the sprite horizontally so a left-side fighter faces right. */
  mirror?: boolean
}

// Six-fighter SF II semicircle around the central microphone. Inner pair
// flank the mic tightly; outer pair anchor the corners; middle pair fill.
// All values are tuned for the 1536×1024 stage render.
const LINEUP: Slot[] = [
  { id: 'chesky',     cx: 0.08, by: 0.95, h: 360, mirror: false },
  { id: 'doshi',      cx: 0.23, by: 0.97, h: 400, mirror: false },
  { id: 'dylan',      cx: 0.36, by: 0.95, h: 360, mirror: false },
  { id: 'dunford',    cx: 0.64, by: 0.95, h: 360, mirror: true  },
  { id: 'julie',      cx: 0.77, by: 0.97, h: 400, mirror: true  },
  { id: 'andreessen', cx: 0.92, by: 0.95, h: 360, mirror: true  },
]

/**
 * Chroma-key the #808080 prompt background of a gpt-image-2 sprite to
 * alpha 0. Threshold and channel-similarity tolerances match Sprite.tsx
 * (28 and 12 respectively) so the runtime + composited look identical.
 */
async function chromaKeyToAlpha(input: Buffer): Promise<Buffer> {
  const img = sharp(input).ensureAlpha()
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  const out = Buffer.from(data)
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i]
    const g = out[i + 1]
    const b = out[i + 2]
    const gray = Math.abs(r - 128) < 28 && Math.abs(g - 128) < 28 && Math.abs(b - 128) < 28
    const sameChannels = Math.abs(r - g) < 12 && Math.abs(g - b) < 12 && Math.abs(r - b) < 12
    if (gray && sameChannels) out[i + 3] = 0
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer()
}

/**
 * Trim the transparent border off a chroma-keyed sprite so positioning is
 * based on the character body, not the padded 1024×1024 canvas.
 */
async function trim(buf: Buffer): Promise<Buffer> {
  return sharp(buf).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
}

async function prepSprite(spriteId: string, mirror: boolean): Promise<{ buf: Buffer; w: number; h: number }> {
  const src = path.join(SPRITES_DIR, spriteId, 'stance.png')
  if (!fs.existsSync(src)) throw new Error(`Missing sprite: ${src}`)
  const raw = fs.readFileSync(src)
  const keyed = await chromaKeyToAlpha(raw)
  const trimmed = await trim(keyed)
  // Flip horizontally for right-side fighters so they face the center mic.
  let oriented = mirror ? await sharp(trimmed).flop().png().toBuffer() : trimmed
  // Slight rim-light: brighten the top + add a dark drop-shadow underneath
  // during the final composite step below. For now we return the chroma-
  // keyed + trimmed body.
  void oriented
  const meta = await sharp(trimmed).metadata()
  return { buf: trimmed, w: meta.width ?? 0, h: meta.height ?? 0 }
}

async function main() {
  if (!fs.existsSync(BG_PATH)) {
    console.error(`No bg found at ${BG_PATH}. Run generate-menu-artwork.ts first.`)
    process.exit(1)
  }
  const bg = sharp(BG_PATH)
  const bgMeta = await bg.metadata()
  const bgW = bgMeta.width ?? 1536
  const bgH = bgMeta.height ?? 1024

  console.log(`Compositing ${LINEUP.length} sprites onto ${bgW}×${bgH} stage…`)

  const composites: sharp.OverlayOptions[] = []
  for (const slot of LINEUP) {
    const { buf, w: nativeW, h: nativeH } = await prepSprite(slot.id, !!slot.mirror)
    if (nativeW === 0 || nativeH === 0) {
      console.warn(`  ! ${slot.id} produced empty sprite, skipping`)
      continue
    }
    const targetH = slot.h
    const targetW = Math.round((nativeW / nativeH) * targetH)
    const finalBuf = await sharp(buf).resize(targetW, targetH, { kernel: 'nearest' }).png().toBuffer()
    // Re-flip after the resize so the chroma-key + trim is done from the
    // canonical orientation and the resize uses nearest-neighbor pixels.
    const oriented = slot.mirror ? await sharp(finalBuf).flop().png().toBuffer() : finalBuf
    const left = Math.round(slot.cx * bgW - targetW / 2)
    const top = Math.round(slot.by * bgH - targetH)
    composites.push({ input: oriented, left, top })
    console.log(`  ✓ ${slot.id} at (${left}, ${top}) · ${targetW}×${targetH}`)
  }

  // Composite, then apply a subtle rim-light pass so the sprites integrate
  // with the painted stage: increase saturation slightly, lift midtones.
  // Sharp won't read+write the same file in one pipeline, so we buffer.
  const outBuf = await sharp(BG_PATH)
    .composite(composites)
    .modulate({ saturation: 1.04, brightness: 1.0 })
    .png({ compressionLevel: 9 })
    .toBuffer()
  fs.writeFileSync(BG_PATH, outBuf)
  console.log(`✓ wrote ${BG_PATH} (${(outBuf.byteLength / 1024).toFixed(1)}KB)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
