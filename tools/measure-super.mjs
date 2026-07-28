// measure-super.mjs — objectively characterise a super filmstrip.
//
// Answers two questions the downscaled eye cannot be trusted on:
//   1. WORLD-DIM: does the stage actually darken/desaturate during the freeze?
//      Measured on a FIXED background patch chosen to exclude the fighters and
//      the flare (upper-right rafters). If a darken-plus-desaturate treatment is
//      live, mean luma + mean saturation drop during the super and recover after.
//   2. BEAM PRESENCE: is an indigo super-beam actually launched and travelling?
//      The charge flare is golden/white (R,G dominant); the beam is blue-violet
//      (B dominant, pushed past 1.0). We count "beam-blue" pixels — B is the max
//      channel AND B is high — in a mid-field arena band per frame, and report
//      the frame where that count peaks and how far right it reaches.
//
// Usage: node tools/measure-super.mjs <dir> [--w 1600 --h 900]
// Reads f000.png.. in order. Pure measurement, writes no product code.
import sharp from 'sharp'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) { console.log('usage: measure-super.mjs <dir>'); process.exit(1) }
const files = readdirSync(dir).filter(f => /^f\d+\.png$/.test(f)).sort()
if (!files.length) { console.log('no f*.png in', dir); process.exit(1) }

// Read frame 0 to learn dims.
const meta0 = await sharp(join(dir, files[0])).metadata()
const W = meta0.width, H = meta0.height
// Background patch: upper-right, above the fighters, away from left-side flare.
const bg = { x0: Math.round(W * 0.66), x1: Math.round(W * 0.97), y0: Math.round(H * 0.07), y1: Math.round(H * 0.30) }
// Arena mid-band for beam detection: full width, vertical centre.
const band = { y0: Math.round(H * 0.38), y1: Math.round(H * 0.72) }

function lumaSat(r, g, b) {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  const s = mx === 0 ? 0 : (mx - mn) / mx
  return [y, s]
}

const rows = []
for (const f of files) {
  const { data, info } = await sharp(join(dir, f)).raw().toBuffer({ resolveWithObject: true })
  const ch = info.channels
  // background luma/sat
  let yl = 0, ss = 0, n = 0
  for (let y = bg.y0; y < bg.y1; y++) {
    for (let x = bg.x0; x < bg.x1; x++) {
      const i = (y * info.width + x) * ch
      const [Y, S] = lumaSat(data[i], data[i + 1], data[i + 2])
      yl += Y; ss += S; n++
    }
  }
  yl /= n; ss /= n
  // beam-blue: B is max channel and B high; track rightmost column reached
  let blue = 0, maxX = 0, minX = info.width
  for (let y = band.y0; y < band.y1; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * ch
      const r = data[i], g = data[i + 1], b = data[i + 2]
      if (b > 150 && b > r + 12 && b >= g) {
        blue++
        if (x > maxX) maxX = x
        if (x < minX) minX = x
      }
    }
  }
  rows.push({ f, bgLuma: +yl.toFixed(1), bgSat: +ss.toFixed(3), blue, spanX: blue ? `${minX}-${maxX}` : '-' })
}

// Baseline = median of first 3 and last 3 frames' bg luma (the non-freeze ends).
const ends = [...rows.slice(0, 3), ...rows.slice(-3)].map(r => r.bgLuma).sort((a, b) => a - b)
const baseLuma = ends[Math.floor(ends.length / 2)]
const minLuma = Math.min(...rows.map(r => r.bgLuma))
const baseSatArr = [...rows.slice(0, 3), ...rows.slice(-3)].map(r => r.bgSat).sort((a, b) => a - b)
const baseSat = baseSatArr[Math.floor(baseSatArr.length / 2)]
const minSat = Math.min(...rows.map(r => r.bgSat))
const peakBlue = rows.reduce((a, r) => r.blue > a.blue ? r : a, rows[0])

console.log(`frames=${rows.length} dims=${W}x${H}`)
console.log(`bg patch x[${bg.x0}-${bg.x1}] y[${bg.y0}-${bg.y1}]   beam band y[${band.y0}-${band.y1}] full width`)
console.log('')
console.log('WORLD-DIM (background rafters patch):')
console.log(`  baseline luma ${baseLuma}  ->  min ${minLuma}   (drop ${(100 * (baseLuma - minLuma) / baseLuma).toFixed(1)}%)`)
console.log(`  baseline sat  ${baseSat.toFixed(3)}  ->  min ${minSat.toFixed(3)}   (drop ${(100 * (baseSat - minSat) / baseSat).toFixed(1)}%)`)
console.log('')
console.log('BEAM-BLUE (indigo lance, B-dominant bright pixels in arena band):')
console.log(`  peak ${peakBlue.blue}px at ${peakBlue.f}  span x=${peakBlue.spanX}`)
const anyBeam = rows.filter(r => r.blue > 200)
console.log(`  frames with >200 beam-blue px: ${anyBeam.length}  (${anyBeam.map(r => r.f.replace('.png', '')).join(',') || 'NONE'})`)
console.log('')
// Per-frame table (compact)
console.log('f#     bgLuma bgSat  blue  spanX')
for (const r of rows) console.log(`${r.f.replace('.png', '').padEnd(6)} ${String(r.bgLuma).padStart(5)} ${r.bgSat.toFixed(3)} ${String(r.blue).padStart(6)}  ${r.spanX}`)
