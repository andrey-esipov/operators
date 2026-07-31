/**
 * Temporal-coherence validation for an animation clip.
 *
 * Every other validator in this pipeline answers "is this ONE frame good?" —
 * on-model, segmented cleanly, feet on the anchor. None of them answer "does
 * this SEQUENCE move smoothly?", and that is exactly the axis the motion
 * critique scored 4.5/10 on: individually plausible frames that stutter when
 * played. Adding inbetweens without this check would be generating the very
 * problem it is meant to fix — a frame can be perfectly on-model and still be
 * a jarring jump from its neighbours.
 *
 * The measure: reduce each frame to a coarse silhouette-coverage grid, take the
 * frame-to-frame delta (fraction of the silhouette that changed), and look at
 * that delta *series*. Smooth motion is a roughly even series; a stutter is a
 * value wildly out of line with its neighbours — a spike (a teleport or a
 * blank frame) or a dip (a held/duplicated frame sitting still while the rest
 * of the clip moves). We flag both, because both read as broken motion.
 *
 * Run `npx tsx scripts/lib/temporal.ts --prove` to see it reject injected
 * stutters (duplicate, teleport, blank) and pass a smooth pan — the falsifiability
 * proof this repo demands of every validator before it is trusted.
 */
import sharp from 'sharp'

/** Coarse silhouette-coverage grid: alpha averaged into `cells`×`cells` bins, 0..1. */
export async function silhouetteGrid(buf: Buffer, cells = 48): Promise<Float32Array> {
  const { data, info } = await sharp(buf)
    .resize(cells, cells, { fit: 'fill', kernel: 'cubic' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const n = cells * cells
  const g = new Float32Array(n)
  const stride = info.channels
  for (let i = 0; i < n; i++) g[i] = data[i * stride + (stride - 1)] / 255
  return g
}

/** Mean absolute difference of two coverage grids: the fraction of silhouette that changed, 0..1. */
export function gridDelta(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i])
  return s / a.length
}

export interface TemporalReport {
  deltas: number[]
  /** Index i in `deltas` (the transition frame i→i+1) that is out of line, with why. */
  flags: { at: number; delta: number; local: number; kind: 'spike' | 'dip' }[]
  ok: boolean
  maxRatio: number
}

/**
 * Flag any transition whose delta is wildly out of line with its local
 * neighbours. `spikeMult`/`dipFrac` are relative to the local median of the
 * surrounding deltas, so a fast clip and a slow clip are judged on their own
 * scale rather than one global threshold.
 */
export function analyzeDeltas(
  deltas: number[],
  opts: { spikeMult?: number; dipFrac?: number; absFloor?: number; window?: number } = {},
): TemporalReport {
  const spikeMult = opts.spikeMult ?? 2.6
  const dipFrac = opts.dipFrac ?? 0.25
  const absFloor = opts.absFloor ?? 0.012 // ignore micro-motion clips where every delta is tiny
  const window = opts.window ?? 2
  const flags: TemporalReport['flags'] = []
  let maxRatio = 1

  for (let i = 0; i < deltas.length; i++) {
    const neigh: number[] = []
    for (let j = Math.max(0, i - window); j <= Math.min(deltas.length - 1, i + window); j++) {
      if (j !== i) neigh.push(deltas[j])
    }
    if (!neigh.length) continue
    const local = median(neigh)
    if (local < absFloor && deltas[i] < absFloor) continue // whole neighbourhood is still; nothing to judge
    const ratio = deltas[i] / Math.max(local, 1e-6)
    if (ratio > maxRatio) maxRatio = ratio
    if (deltas[i] > absFloor && ratio >= spikeMult) {
      flags.push({ at: i, delta: deltas[i], local, kind: 'spike' })
    } else if (local > absFloor && deltas[i] <= local * dipFrac) {
      flags.push({ at: i, delta: deltas[i], local, kind: 'dip' })
    }
  }
  return { deltas, flags, ok: flags.length === 0, maxRatio }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Full pipeline: grids → delta series → report, for a played-out list of frame buffers. */
export async function analyzeClip(
  frameBufs: Buffer[],
  opts?: Parameters<typeof analyzeDeltas>[1] & { cells?: number },
): Promise<TemporalReport> {
  const grids = await Promise.all(frameBufs.map((b) => silhouetteGrid(b, opts?.cells ?? 48)))
  const deltas: number[] = []
  for (let i = 0; i < grids.length - 1; i++) deltas.push(gridDelta(grids[i], grids[i + 1]))
  return analyzeDeltas(deltas, opts)
}

// ── Falsifiability proof ────────────────────────────────────────────────────
// A validator nobody has watched fail is worthless in this repo. Build a smooth
// synthetic sequence, confirm it passes, then inject each failure mode the
// validator claims to catch and confirm it goes red.
function makeGrid(cells: number, cx: number, cy: number, r: number): Float32Array {
  const g = new Float32Array(cells * cells)
  for (let y = 0; y < cells; y++)
    for (let x = 0; x < cells; x++) {
      const d = Math.hypot(x - cx, y - cy)
      g[y * cells + x] = d < r ? 1 : d < r + 2 ? (r + 2 - d) / 2 : 0
    }
  return g
}

function seriesFromGrids(grids: Float32Array[]): number[] {
  const d: number[] = []
  for (let i = 0; i < grids.length - 1; i++) d.push(gridDelta(grids[i], grids[i + 1]))
  return d
}

function prove(): void {
  const C = 48
  // A body panning steadily across frame: even deltas, smooth motion.
  const smooth = Array.from({ length: 10 }, (_, i) => makeGrid(C, 12 + i * 2.4, 24, 7))
  const base = analyzeDeltas(seriesFromGrids(smooth))
  console.log(`smooth pan:        flags=${base.flags.length} maxRatio=${base.maxRatio.toFixed(2)} -> ${base.ok ? 'PASS' : 'FAIL'}`)

  let redCount = 0
  const check = (label: string, grids: Float32Array[], expect: 'PASS' | 'FAIL') => {
    const r = analyzeDeltas(seriesFromGrids(grids))
    const got = r.ok ? 'PASS' : 'FAIL'
    const kinds = r.flags.map((f) => `${f.kind}@${f.at}`).join(',')
    const good = got === expect
    if (expect === 'FAIL' && !r.ok) redCount++
    console.log(`${label.padEnd(19)}flags=${r.flags.length}${kinds ? ` (${kinds})` : ''} maxRatio=${r.maxRatio.toFixed(2)} -> ${got} ${good ? 'OK' : '*** WRONG, expected ' + expect + ' ***'}`)
    return good
  }

  // (a) Duplicated/held frame in the middle of motion → a dip in the series.
  const dup = smooth.map((g) => g.slice())
  dup[5] = dup[4].slice() // frame 5 == frame 4: transition 4→5 is ~0 amid steady motion
  // (b) Teleport: one frame jumps far off the path → a spike.
  const teleport = smooth.map((g) => g.slice())
  teleport[5] = makeGrid(C, 40, 8, 7)
  // (c) Blank frame → two huge adjacent spikes.
  const blank = smooth.map((g) => g.slice())
  blank[5] = new Float32Array(C * C)

  const results = [
    check('smooth pan:', smooth, 'PASS'),
    check('duplicate frame:', dup, 'FAIL'),
    check('teleport frame:', teleport, 'FAIL'),
    check('blank frame:', blank, 'FAIL'),
  ]

  const allInjectedFailed = redCount === 3
  const smoothPassed = base.ok
  console.log(
    `\n${results.every(Boolean) && allInjectedFailed && smoothPassed ? '✅' : '❌'} temporal validator: smooth PASS, all 3 injected stutters FAIL`,
  )
  if (!(results.every(Boolean) && allInjectedFailed && smoothPassed)) process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--prove')) prove()
  else console.log('usage: tsx scripts/lib/temporal.ts --prove')
}
