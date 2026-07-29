// measure-hud-weight.mjs — does the HEALTH BAR read weight, or one drain scaled?
//
// The audio work proved weight is a TIMBRE, not just a level. This is the visual
// mirror on the single most-watched element in a fighting game. Before this, the
// bar drained a 10-damage chip and a 120-damage super on the IDENTICAL 55ms ease:
// the most-watched readout gave a poke and a match-ending super the same physical
// response. This tool asks whether OUR six weight classes now move the bar as
// genuinely different BEHAVIOURS — and, crucially, whether that difference is a
// function of the WEIGHT CLASS and not merely of how much damage the hit did.
//
// It drives the ACTUAL shipped model (src/fighthud/healthBarModel.ts — the exact
// applyHit + stepHealthBar the HUD runs), frame-by-frame at 60fps, and measures
// four MAGNITUDE-INVARIANT shape descriptors of the realized trajectory:
//
//   recoilPeak       the one-shot contact jolt, 0..1        → CONTACT WEIGHT
//   mainHalfFrames   frames for the front fill to close     → FRONT SNAP
//                    half the gap to the new value
//   holdFrames       frames the lost chunk hangs before      → CHUNK LINGER
//                    it starts to bleed
//   bleedHalfFrames  frames to then bleed half the chunk      → DRAIN LAZINESS
//
// All four are shape features (ratios / timers), independent of how big the hit
// was: closing HALF a gap takes tau·ln2 whatever the gap; a hold timer counts ms
// whatever the damage. So comparing them across classes at MATCHED damage IS
// asking "at matched magnitude, do the classes still behave differently?".
//
// THREE GUARDS, the shape the audio + stage-identity instruments established:
//   • DET FLOOR (non-vacuity) — fingerprint a class against ITSELF ⇒ distance 0.
//     A dead ruler could not hit 0 on demand; this proves the metric reads the
//     model, not noise.
//   • POSITIVE CONTROL — d(light, crumple) is large by construction, so the
//     metric demonstrably RESPONDS (a "everything is identical" bug also fails).
//   • THE SIZE / WEIGHT SPLIT (the crux) — take ONE class at three damages and
//     watch two numbers: the SIZE axis (settled fill) moves a lot (so the
//     instrument is NOT blind to damage — a positive control), while the SHAPE
//     fingerprint barely moves (so the BEHAVIOUR is a function of WEIGHT CLASS,
//     not of how big the hit was). That is the refutation of "one behaviour
//     scaled": a bar that was one drain scaled by damage would put all six
//     classes on ONE point at matched damage — instead they separate (see the
//     cross-class gap), and THE PROXY THIS ASSERTS ON is the realized trajectory
//     of the shipped model functions. A bar that ignored `level` (all classes →
//     one response) collapses every cross-class gap to ~0 and fails the
//     separation guard (see barWeight.test.ts, which mutates exactly that).
//
// Run (pure node, NO browser — freeze-safe):
//   npx tsx tools/measure-hud-weight.mjs            # table
//   npx tsx tools/measure-hud-weight.mjs --assert   # gate; echo $?
//   npx tsx tools/measure-hud-weight.mjs --json     # machine-readable
import { freshBar, applyHit, stepHealthBar, barResponse } from '../src/fighthud/healthBarModel.ts'

const LEVELS = ['light', 'medium', 'heavy', 'launcher', 'sweep', 'crumple']
const DT = 1000 / 60
const FRAMES = 420 // ~7s: past the longest hold (crumple 1150ms) + full bleed

// Fixed physical scales so the fingerprint distance is STABLE across runs and
// cannot drift with the set (not z-scored) — same discipline as the audio tool.
// Each ≈ the spread of its axis, so no single axis dominates the Euclidean norm.
const SCALE = { recoilPeak: 0.5, mainHalfFrames: 6, holdFrames: 24, bleedHalfFrames: 14 }

/** Drive the shipped model through one hit of `level` that removes `dmg` (0..1)
 *  of the bar, and return the four shape descriptors of the realized trajectory,
 *  plus `endValue` — the raw settled fill, which by design tracks the DAMAGE
 *  (the size axis), NOT the weight class. */
function fingerprint(level, dmg) {
  const bar = freshBar()
  const target = 1 - dmg
  applyHit(bar, level)
  const recoil = [bar.recoil ?? 0] // authored peak, before any decay
  const main = [bar.main]
  const trail = [bar.trail]
  for (let i = 0; i < FRAMES; i++) {
    stepHealthBar(bar, target, DT)
    main.push(bar.main)
    trail.push(bar.trail)
    recoil.push(bar.recoil ?? 0)
  }
  const half = target + 0.5 * (1 - target) // value at half the lost chunk
  const firstAtOrBelow = (arr, v) => {
    for (let i = 0; i < arr.length; i++) if (arr[i] <= v) return i
    return arr.length
  }
  const firstBelow = (arr, v) => {
    for (let i = 0; i < arr.length; i++) if (arr[i] < v) return i
    return arr.length
  }
  const holdFrames = firstBelow(trail, 1 - 1e-6)
  const halfFrames = firstAtOrBelow(trail, half)
  return {
    recoilPeak: Math.max(...recoil),
    mainHalfFrames: firstAtOrBelow(main, half),
    holdFrames,
    bleedHalfFrames: Math.max(0, halfFrames - holdFrames),
    endValue: main[main.length - 1],
  }
}

// The four SHAPE axes that carry weight identity (endValue is the size axis and
// is deliberately excluded from the fingerprint distance).
function fpDist(a, b) {
  let s = 0
  for (const k of Object.keys(SCALE)) {
    const d = (a[k] - b[k]) / SCALE[k]
    s += d * d
  }
  return Math.sqrt(s)
}

const MATCH_DMG = 0.4 // the "matched magnitude" all classes are compared at
const DMGS = [0.15, 0.4, 0.7] // three sizes of the SAME class, for the size/weight split

function analyze() {
  const fp = Object.fromEntries(LEVELS.map((l) => [l, fingerprint(l, MATCH_DMG)]))

  // Cross-class separation at matched damage — the core claim.
  let minGap = Infinity
  let minPair = null
  const pairs = []
  for (let i = 0; i < LEVELS.length; i++) {
    for (let j = i + 1; j < LEVELS.length; j++) {
      const d = fpDist(fp[LEVELS[i]], fp[LEVELS[j]])
      pairs.push([LEVELS[i], LEVELS[j], d])
      if (d < minGap) {
        minGap = d
        minPair = [LEVELS[i], LEVELS[j]]
      }
    }
  }

  // The size/weight split, on ONE class (heavy) across three damages:
  //   - endSpread: how far the SIZE axis (settled value) moves → must be LARGE,
  //     proving the instrument is NOT blind to damage (a positive control).
  //   - shapeWobble: how far the SHAPE fingerprint moves → must be ~0, proving
  //     the BEHAVIOUR is a function of weight class, not of how big the hit was.
  //     (This is a regression guard: if a future edit coupled damage into the
  //     ease/hold — reintroducing "one behaviour scaled" — shapeWobble rises.)
  const sized = DMGS.map((d) => fingerprint('heavy', d))
  const endSpread = Math.max(...sized.map((f) => f.endValue)) - Math.min(...sized.map((f) => f.endValue))
  let shapeWobble = 0
  for (let i = 0; i < sized.length; i++)
    for (let j = i + 1; j < sized.length; j++) shapeWobble = Math.max(shapeWobble, fpDist(sized[i], sized[j]))

  // Non-vacuity + positive control.
  const detFloor = fpDist(fp.heavy, fingerprint('heavy', MATCH_DMG))
  const posControl = fpDist(fp.light, fp.crumple)

  return { fp, pairs, minGap, minPair, endSpread, shapeWobble, detFloor, posControl }
}

function fmt(n, w = 7) {
  return String(typeof n === 'number' ? (Number.isInteger(n) ? n : n.toFixed(3)) : n).padStart(w)
}

const r = analyze()
const args = new Set(process.argv.slice(2))

if (args.has('--json')) {
  console.log(JSON.stringify(r, null, 2))
  process.exit(0)
}

console.log('\nHUD health-bar weight fingerprint — shipped healthBarModel, matched damage =', MATCH_DMG)
console.log('  (recoilPeak / mainHalfFrames / holdFrames / bleedHalfFrames = the four shape axes)\n')
console.log('  level     recoil  mainHalf  hold  bleedHalf   authored(response)')
for (const l of LEVELS) {
  const f = r.fp[l]
  const b = barResponse(l)
  console.log(
    `  ${l.padEnd(9)} ${fmt(f.recoilPeak)} ${fmt(f.mainHalfFrames, 8)} ${fmt(f.holdFrames, 5)} ${fmt(
      f.bleedHalfFrames,
      9,
    )}   {mainTau:${b.mainTau} hold:${b.holdMs} trailTau:${b.trailTau} recoil:${b.recoil}}`,
  )
}
console.log('\n  DET FLOOR (heavy vs heavy, must be 0):        ', r.detFloor.toFixed(6))
console.log('  POSITIVE CONTROL (light vs crumple):          ', r.posControl.toFixed(3))
console.log(`  MIN cross-class gap @ matched dmg (${r.minPair.join(' / ')}):`.padEnd(48), r.minGap.toFixed(3))
console.log('\n  SIZE vs WEIGHT (heavy at dmg', DMGS.join('/') + '):')
console.log('    endSpread   (size axis moves — must be large):', r.endSpread.toFixed(3))
console.log('    shapeWobble (behaviour moves — must be ~0):   ', r.shapeWobble.toFixed(3))

if (args.has('--assert')) {
  const MIN_SEP = 0.45 // every distinct pair must clear this at matched damage
  const fails = []
  if (r.detFloor > 1e-9) fails.push(`DET FLOOR non-zero (${r.detFloor}) — metric is not deterministic`)
  if (r.posControl < 2.0) fails.push(`POSITIVE CONTROL too small (${r.posControl}) — metric not responding`)
  if (r.minGap < MIN_SEP) fails.push(`SEPARATION: ${r.minPair.join('/')} gap ${r.minGap.toFixed(3)} < ${MIN_SEP}`)
  // Size/weight split: damage must move the SIZE axis (instrument sees magnitude)
  // while leaving the BEHAVIOUR fingerprint put (weight, not size, sets the shape).
  if (r.endSpread < 0.3) fails.push(`SIZE control: endSpread ${r.endSpread.toFixed(3)} < 0.3 — blind to damage`)
  if (r.shapeWobble > 0.05)
    fails.push(`SHAPE invariance: wobble ${r.shapeWobble.toFixed(3)} > 0.05 — damage is leaking into behaviour`)
  // Design invariants — direction of difference, not just difference.
  const fp = r.fp
  const maxRecoil = Math.max(...LEVELS.map((l) => fp[l].recoilPeak))
  const minRecoil = Math.min(...LEVELS.map((l) => fp[l].recoilPeak))
  if (fp.crumple.recoilPeak !== maxRecoil) fails.push('INVARIANT: crumple is not the hardest recoil')
  if (fp.light.recoilPeak !== minRecoil) fails.push('INVARIANT: light is not the softest recoil')
  const maxBleed = Math.max(...LEVELS.map((l) => fp[l].bleedHalfFrames))
  if (fp.sweep.bleedHalfFrames !== maxBleed) fails.push('INVARIANT: sweep is not the slowest bleed')
  if (fp.launcher.bleedHalfFrames >= fp.sweep.bleedHalfFrames)
    fails.push('INVARIANT: launcher chunk does not clear faster than sweep')
  if (fp.launcher.mainHalfFrames >= fp.heavy.mainHalfFrames)
    fails.push('INVARIANT: launcher front does not snap faster than heavy')
  const maxHold = Math.max(...LEVELS.map((l) => fp[l].holdFrames))
  if (fp.crumple.holdFrames !== maxHold) fails.push('INVARIANT: crumple chunk does not linger longest')

  if (fails.length) {
    console.log('\n  ASSERT: FAIL')
    for (const f of fails) console.log('    ✗ ' + f)
    process.exit(1)
  }
  console.log('\n  ASSERT: PASS — six distinct behaviours, weight-driven not magnitude-driven')
}
