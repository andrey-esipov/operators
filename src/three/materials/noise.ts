/**
 * Seeded, tileable procedural noise.
 *
 * Everything here writes into caller-provided Float32Array buffers and never
 * allocates per-pixel, because a single material bake touches several million
 * samples and the GC pressure of a naive implementation is visible as a hitch.
 *
 * All generators are *periodic* over the sample grid, so the resulting textures
 * tile seamlessly — a hard requirement for floors and walls that repeat.
 */

/** xorshift32. Deterministic, fast, good enough for texture work. */
export function rng(seed: number) {
  let s = seed | 0 || 0x9e3779b9
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 0xffffffff) / 0xffffffff
  }
}

function hash2(ix: number, iy: number, seed: number) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Periodic value noise at `freq` cells across the whole texture.
 * `freq` must be an integer for the tiling to be seamless.
 */
export function valueNoise(
  out: Float32Array, size: number, freq: number, seed: number, amp = 1, add = false,
) {
  const f = Math.max(1, Math.round(freq))
  const scale = f / size
  for (let y = 0; y < size; y++) {
    const fy = y * scale
    const iy = Math.floor(fy)
    const ty = fade(fy - iy)
    const y0 = ((iy % f) + f) % f
    const y1 = (y0 + 1) % f
    for (let x = 0; x < size; x++) {
      const fx = x * scale
      const ix = Math.floor(fx)
      const tx = fade(fx - ix)
      const x0 = ((ix % f) + f) % f
      const x1 = (x0 + 1) % f
      const v = lerp(
        lerp(hash2(x0, y0, seed), hash2(x1, y0, seed), tx),
        lerp(hash2(x0, y1, seed), hash2(x1, y1, seed), tx),
        ty,
      )
      const i = y * size + x
      out[i] = add ? out[i] + v * amp : v * amp
    }
  }
}

/** Periodic fBm. `octaves` doublings of frequency at halving amplitude. */
export function fbm(
  out: Float32Array, size: number, baseFreq: number, octaves: number, seed: number,
  gain = 0.5, amp = 1,
) {
  out.fill(0)
  let f = Math.max(1, Math.round(baseFreq))
  let a = amp
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    valueNoise(out, size, f, seed + o * 7919, a, true)
    norm += a
    a *= gain
    f *= 2
  }
  if (norm > 0) for (let i = 0; i < out.length; i++) out[i] /= norm
}

/**
 * Periodic Worley / cellular noise. Returns F1 distance normalised to ~0..1.
 * Used for concrete aggregate, cracked paint, marble veins and rust blooms.
 */
export function worley(
  out: Float32Array, size: number, cells: number, seed: number, kind: 'f1' | 'f2f1' = 'f1',
) {
  const c = Math.max(1, Math.round(cells))
  const cellSize = size / c
  // Precompute one feature point per cell.
  const px = new Float32Array(c * c)
  const py = new Float32Array(c * c)
  for (let cy = 0; cy < c; cy++) {
    for (let cx = 0; cx < c; cx++) {
      const i = cy * c + cx
      px[i] = (cx + hash2(cx, cy, seed)) * cellSize
      py[i] = (cy + hash2(cx, cy, seed + 1013)) * cellSize
    }
  }
  for (let y = 0; y < size; y++) {
    const cy0 = Math.floor(y / cellSize)
    for (let x = 0; x < size; x++) {
      const cx0 = Math.floor(x / cellSize)
      let f1 = Infinity
      let f2 = Infinity
      for (let dy = -1; dy <= 1; dy++) {
        const cy = ((cy0 + dy) % c + c) % c
        // Wrap the *distance*, not just the index, so the field is periodic.
        const oy = (cy0 + dy) < 0 ? -size : (cy0 + dy) >= c ? size : 0
        for (let dx = -1; dx <= 1; dx++) {
          const cx = ((cx0 + dx) % c + c) % c
          const ox = (cx0 + dx) < 0 ? -size : (cx0 + dx) >= c ? size : 0
          const i = cy * c + cx
          const ddx = px[i] + ox - x
          const ddy = py[i] + oy - y
          const d = ddx * ddx + ddy * ddy
          if (d < f1) { f2 = f1; f1 = d } else if (d < f2) { f2 = d }
        }
      }
      const v = kind === 'f1'
        ? Math.sqrt(f1) / cellSize
        : (Math.sqrt(f2) - Math.sqrt(f1)) / cellSize
      out[y * size + x] = Math.min(1, v)
    }
  }
}

/**
 * Anisotropic grain — brushed metal, wood grain, woven fabric, rain streaks.
 *
 * `freq` is the detail of the 1D cross-strand field (higher = finer strands).
 * The field is sampled *once* across the perpendicular axis rather than tiled,
 * which is what makes this read as continuous grain instead of repeating bands.
 */
export function streaks(
  out: Float32Array, size: number, along: 'x' | 'y', freq: number, jitter: number, seed: number,
) {
  // Multi-octave 1D field across the strand direction.
  const field = new Float32Array(size)
  {
    let f = Math.max(1, Math.round(freq))
    let amp = 1
    let norm = 0
    for (let o = 0; o < 4 && f <= size; o++) {
      const step = size / f
      for (let i = 0; i < size; i++) {
        const p = i / step
        const i0 = Math.floor(p)
        const t = fade(p - i0)
        const a = hash2(((i0 % f) + f) % f, o * 131, seed)
        const b = hash2((((i0 + 1) % f) + f) % f, o * 131, seed)
        field[i] += lerp(a, b, t) * amp
      }
      norm += amp
      amp *= 0.55
      f *= 2
    }
    if (norm > 0) for (let i = 0; i < size; i++) field[i] /= norm
  }

  // Smooth low-frequency wobble so strands are not perfectly straight.
  const wob = new Float32Array(size)
  {
    const wf = 6
    const step = size / wf
    for (let i = 0; i < size; i++) {
      const p = i / step
      const i0 = Math.floor(p)
      const t = fade(p - i0)
      const a = hash2(((i0 % wf) + wf) % wf, 777, seed + 5)
      const b = hash2((((i0 + 1) % wf) + wf) % wf, 777, seed + 5)
      wob[i] = (lerp(a, b, t) - 0.5) * jitter * size
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // `t` runs across the strands, `s` runs along them.
      const t = along === 'x' ? y : x
      const s = along === 'x' ? x : y
      const idx = ((Math.round(t + wob[s]) % size) + size) % size
      out[y * size + x] = field[idx]
    }
  }
}

/** Smoothstep remap, in place. */
export function contrast(buf: Float32Array, lo: number, hi: number) {
  const d = Math.max(1e-5, hi - lo)
  for (let i = 0; i < buf.length; i++) {
    const t = Math.min(1, Math.max(0, (buf[i] - lo) / d))
    buf[i] = t * t * (3 - 2 * t)
  }
}

/** Normalise to exactly 0..1. */
export function normalise(buf: Float32Array) {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] < lo) lo = buf[i]
    if (buf[i] > hi) hi = buf[i]
  }
  const d = hi - lo
  if (d < 1e-6) return
  for (let i = 0; i < buf.length; i++) buf[i] = (buf[i] - lo) / d
}

export function mulBuf(a: Float32Array, b: Float32Array) {
  for (let i = 0; i < a.length; i++) a[i] *= b[i]
}

export function mixBuf(a: Float32Array, b: Float32Array, t: number) {
  for (let i = 0; i < a.length; i++) a[i] += (b[i] - a[i]) * t
}
