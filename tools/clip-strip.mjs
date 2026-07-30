/**
 * clip-strip — lay a SHIPPED clip out cel-by-cel so motion quality can be judged.
 *
 * WHY THIS READS THE ATLAS AND NOT THE GENERATOR'S RegMap:
 * scripts/lib/preview.ts already emits filmstrips, but it does so from the
 * buffers the generator happens to hold in memory during a run. That answers
 * "what did the generator make", which is a different question from "what does
 * a buyer see". This walks public/fighters/<id>/{assets.json,atlas.webp} — the
 * exact bytes the game loads — so a packing, trimming or manifest defect that
 * appeared AFTER registration is visible here and invisible there.
 *
 * WHY IT EXISTS AT ALL: most of this roster's locomotion cels are synthesised
 * in-betweens (scripts/lib/inbetween.ts morphs two neighbouring keys by optical
 * flow). A morph between poses that are too far apart double-images — it reads
 * as a ghost or a smear rather than a drawing. That failure is invisible in a
 * cel COUNT, which is the only thing our gates measure, and it is invisible in
 * a single still. It is obvious the moment the cels sit side by side, because a
 * ghosted tween looks nothing like the two hand-drawn keys bracketing it.
 *
 * Each cel is labelled with its manifest index and name, so `tw-*` (tween)
 * cels can be told from keys without trusting this tool's own ordering.
 *
 * Output is downscaled JPEG by default: a vision agent that is handed raw PNGs
 * wedges its own context (see tools/critic-prep.mjs for the full post-mortem).
 *
 *   node tools/clip-strip.mjs --id turley --clips idle,crouch,walk-fwd --out /tmp/strips
 *   node tools/clip-strip.mjs --id turley --clips idle --blind A
 */
import { readFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const arg = (k, d = null) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d
}

const id = arg('id')
const clips = (arg('clips') || 'idle').split(',').map((s) => s.trim()).filter(Boolean)
const outDir = arg('out', '/tmp/clip-strips')
const blind = arg('blind')
const cell = Number(arg('cell', 200))
const variant = arg('variant', 'full')

if (!id) {
  console.error('usage: node tools/clip-strip.mjs --id <fighter> --clips a,b [--out dir] [--blind A]')
  process.exit(2)
}

const base = join('public', 'fighters', id)
const manifestName = variant === 'hero' ? 'assets.hero.json' : 'assets.json'
const manifest = JSON.parse(readFileSync(join(base, manifestName), 'utf8'))
// manifest.atlas is a PUBLIC-ROOT-relative URL ("/fighters/<id>/atlas.webp"),
// which is what the browser loads. Resolve it against public/ rather than
// against the fighter dir, or the path silently doubles up.
const atlasField = manifest.atlas || (variant === 'hero' ? 'atlas.hero.webp' : 'atlas.webp')
const atlasPath = atlasField.startsWith('/')
  ? join('public', atlasField.slice(1))
  : join(base, atlasField)
if (!existsSync(atlasPath)) {
  console.error(`no atlas at ${atlasPath}`)
  process.exit(2)
}
mkdirSync(outDir, { recursive: true })

const atlas = sharp(atlasPath)
const meta = await atlas.metadata()
const raw = await atlas.ensureAlpha().raw().toBuffer()
const AW = meta.width
const AH = meta.height

/** Cut one frame's rect out of the decoded atlas. */
function cutFrame(frame) {
  const r = frame.rect
  const out = Buffer.alloc(r.w * r.h * 4)
  for (let y = 0; y < r.h; y++) {
    const sy = r.y + y
    if (sy < 0 || sy >= AH) continue
    for (let x = 0; x < r.w; x++) {
      const sx = r.x + x
      if (sx < 0 || sx >= AW) continue
      const si = (sy * AW + sx) * 4
      const di = (y * r.w + x) * 4
      out[di] = raw[si]
      out[di + 1] = raw[si + 1]
      out[di + 2] = raw[si + 2]
      out[di + 3] = raw[si + 3]
    }
  }
  return sharp(out, { raw: { width: r.w, height: r.h, channels: 4 } })
}

async function labelStrip(text, w, h) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${w}" height="${h}" fill="#12141a"/>
    <text x="6" y="${Math.round(h * 0.7)}" font-family="monospace" font-size="${Math.round(h * 0.62)}" fill="#8fa3c8">${esc}</text>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

const summary = []

for (const clipName of clips) {
  const clip = manifest.clips?.[clipName]
  if (!clip) {
    console.error(`${id}: no clip '${clipName}'`)
    continue
  }
  // clips[c].frames are INDICES into frames[]; each entry there carries .name.
  const idxs = clip.frames
  const labelH = 26
  const width = idxs.length * cell
  const layers = []

  for (let i = 0; i < idxs.length; i++) {
    const frame = manifest.frames[idxs[i]]
    const scaled = await cutFrame(frame)
      .resize(cell, cell, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
    layers.push({ input: scaled, left: i * cell, top: 0 })
    const dur = Array.isArray(clip.durations) ? clip.durations[i] : '?'
    layers.push({
      input: await labelStrip(`${i} ${frame.name} ${dur}f`, cell, labelH),
      left: i * cell,
      top: cell,
    })
    if (i > 0) {
      layers.push({
        input: { create: { width: 1, height: cell, channels: 4, background: { r: 70, g: 80, b: 100, alpha: 1 } } },
        left: i * cell,
        top: 0,
      })
    }
  }

  const tag = blind ? `${blind}-${clipName}` : `${id}-${clipName}`
  const file = join(outDir, `${tag}.jpg`)
  // Two stages deliberately: sharp applies resize BEFORE composite within one
  // pipeline, so chaining them would shrink the canvas and then paste cels
  // beyond its right edge. Composite to a buffer, then downscale that.
  const composed = await sharp({
    create: { width, height: cell + labelH, channels: 4, background: { r: 18, g: 20, b: 26, alpha: 1 } },
  })
    .composite(layers)
    .png()
    .toBuffer()

  await sharp(composed)
    .flatten({ background: { r: 18, g: 20, b: 26 } })
    .resize({ width: Math.min(width, 1280), withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(file)

  const names = idxs.map((n) => manifest.frames[n].name)
  const tweens = names.filter((n) => n.startsWith('tw-')).length
  summary.push({ clip: clipName, cels: idxs.length, tweens, file, names })
  console.log(`${tag.padEnd(24)} cels=${String(idxs.length).padStart(2)} tweens=${tweens}  ${file}`)
}

console.log(JSON.stringify({ id: blind ? '(blind)' : id, variant, strips: summary }, null, 2))
