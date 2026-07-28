// montage.mjs — tile a directory of numbered frames into a single contact sheet.
//
// The critic keeps needing "show me these N frames as one grid" for filmstrips
// (super-strip, ceremony, ko). Doing it inline with sharp every time invites the
// exact mistake this project keeps filing: a downscale that hides a defect. So
// this is one honest, labelled tool. It DOES downscale for the grid — that is
// its whole job — so it prints the native tile resolution loudly and is for
// composition/timing reads ONLY, never sprite-craft (that stays native 1:1).
//
//   node tools/montage.mjs <dir> --out sheet.png [--cols 6] [--tile 500] [--every 1] [--label]
import sharp from 'sharp'
import { readdirSync } from 'node:fs'

const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d)
const DIR = process.argv[2]
const OUT = arg('out', 'montage.png')
const COLS = Number(arg('cols', '6'))
const TILE = Number(arg('tile', '500')) // tile width in px
const EVERY = Number(arg('every', '1'))
const LABEL = process.argv.includes('--label')

if (!DIR) { console.log('usage: montage.mjs <dir> --out sheet.png [--cols 6] [--tile 500] [--every 1] [--label]'); process.exit(2) }

const files = readdirSync(DIR).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().filter((_, i) => i % EVERY === 0)
if (!files.length) { console.log(`no images in ${DIR}`); process.exit(2) }

const meta0 = await sharp(`${DIR}/${files[0]}`).metadata()
const scale = TILE / meta0.width
const tileH = Math.round(meta0.height * scale)
const rows = Math.ceil(files.length / COLS)
console.log(`montage ${files.length} frames  native ${meta0.width}x${meta0.height} -> tile ${TILE}x${tileH}  grid ${COLS}x${rows}`)
console.log(`  (downscaled ${(1 / scale).toFixed(2)}x — composition/timing only, NOT sprite craft)`)

const tiles = await Promise.all(
  files.map(async (f, i) => {
    let img = sharp(`${DIR}/${f}`).resize(TILE, tileH)
    if (LABEL) {
      const svg = Buffer.from(
        `<svg width="${TILE}" height="${tileH}"><text x="8" y="26" font-family="monospace" font-size="24" fill="#0f0" stroke="#000" stroke-width="1">${f.replace(/\.(png|jpe?g)$/i, '')}</text></svg>`,
      )
      img = img.composite([{ input: svg, top: 0, left: 0 }])
    }
    return { buf: await img.png().toBuffer(), i }
  }),
)

const canvas = sharp({
  create: { width: TILE * COLS, height: tileH * rows, channels: 3, background: { r: 15, g: 15, b: 20 } },
})
await canvas
  .composite(tiles.map(({ buf, i }) => ({ input: buf, top: Math.floor(i / COLS) * tileH, left: (i % COLS) * TILE })))
  .png()
  .toFile(OUT)
console.log(`  -> ${OUT}`)
