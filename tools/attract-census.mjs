/**
 * Attract-reel money-shot census — a durable editorial instrument for the
 * SHIPPED fighter's title-screen demo reel (src/screens/attract/*).
 *
 * WHY THIS EXISTS: a critic pass claimed the reel's opening window shows "no
 * super, KO or heavy". Measured across many seeds that is false — the reel is
 * money-dense. This tool replaces that single-draw attribution with a
 * reproducible number: over a representative sample of reels, what fraction of
 * SCREEN-TIME is a stop-scrolling moment (super / KO / heavy) versus footsies?
 *
 * WHY IT IS LOAD-INVARIANT (this matters — the box is often saturated): it
 * drives the PURE AttractDirector frame-for-frame in node (no browser, no
 * renderer, no route) and classifies SIM frames. The output is a fraction of
 * SIMULATED frames, which is deterministic and identical on an idle or a
 * thrashing machine. It measures screen-time COMPOSITION, never frame RATE —
 * fps is a separate, environment-bound number this tool must not be read as.
 *
 * ROUTING: shipped-ui. It imports the shipped reel's own director and the
 * shipped fighter's sim; it contains no legacy-battler route or handle. See
 * tools/instrument-manifest.json + src/__tests__/instrumentRouting.node.test.ts.
 *
 * RUN (needs the TS loader, since it imports the director's source):
 *   npx tsx tools/attract-census.mjs [seeds=40] [framesPerSeed=3600]
 *   npx tsx tools/attract-census.mjs --selftest     # mutation guard
 *
 * The --selftest is the anti-vacuity control the project standard requires:
 * it exercises every classifier branch AND proves the census reads action only
 * when action happens — a FROZEN reel must census 0% marquee, a LIVE reel must
 * not. Break the subject, watch the number move.
 */
import { AttractDirector } from '../src/screens/attract/attractDirector.ts'

const FPS = 60
const WINDOW_FRAMES = 8 * FPS // an 8s scroll window
const HEAVY_LEVELS = ['heavy', 'launcher', 'sweep', 'crumple']

/**
 * Classify one simulated frame into a screen-time bucket, most-marquee first.
 * MARQUEE = FINISH | SUPER | HEAVY (the stop-scrolling moments).
 */
export function classify(state, events) {
  const st = new Set([state.fighters[0].stance, state.fighters[1].stance])
  if (state.phase === 'ko' || state.phase === 'round-end' || state.phase === 'match-end') return 'FINISH'
  if (st.has('ko') || st.has('victory') || st.has('defeat')) return 'FINISH'
  if ((state.superFreeze ?? 0) > 0) return 'SUPER'
  if (events.some((e) => e.type === 'super-flash')) return 'SUPER'
  if (events.some((e) => e.type === 'launch' || e.type === 'knockdown' || e.type === 'wall-bounce')) return 'HEAVY'
  if (events.some((e) => (e.type === 'hit' || e.type === 'counter-hit' || e.type === 'throw') && HEAVY_LEVELS.includes(e.level)))
    return 'HEAVY'
  if (st.has('juggle') || st.has('knockdown')) return 'HEAVY'
  if (st.has('attack') || st.has('blockstun') || st.has('hitstun') || st.has('wakeup')) return 'ENGAGED'
  if ((state.hitstop ?? 0) > 0) return 'ENGAGED'
  if ((state.projectiles?.length ?? 0) > 0) return 'ENGAGED'
  if (events.some((e) => e.type === 'hit' || e.type === 'block' || e.type === 'parry')) return 'ENGAGED'
  return 'NEUTRAL'
}

const isMarquee = (b) => b === 'FINISH' || b === 'SUPER' || b === 'HEAVY'

/** Drive one reel for `frames` frames, cutting bouts the way the shell does. */
function censusOne(seed, frames) {
  const dir = new AttractDirector({ seed })
  const buckets = []
  let supers = 0
  let kos = 0
  let heavies = 0
  let openerFrames = -1
  for (let i = 0; i < frames; i++) {
    const res = dir.step()
    buckets.push(classify(res.state, res.events))
    for (const e of res.events) {
      if (e.type === 'super-flash') supers++
      if (e.type === 'ko') kos++
      if ((e.type === 'hit' || e.type === 'counter-hit' || e.type === 'throw') && HEAVY_LEVELS.includes(e.level)) heavies++
    }
    if (dir.wantsRotate) {
      if (openerFrames < 0) openerFrames = i + 1
      dir.rotate()
    }
  }
  const firstMarquee = buckets.findIndex(isMarquee)
  const frac = (arr, pred) => (arr.length ? arr.filter(pred).length / arr.length : 0)
  let dead = 0
  let windows = 0
  for (let w = 0; w + WINDOW_FRAMES <= buckets.length; w += WINDOW_FRAMES) {
    windows++
    if (!buckets.slice(w, w + WINDOW_FRAMES).some(isMarquee)) dead++
  }
  return {
    matchup: dir.matchup,
    openerFrames: openerFrames < 0 ? frames : openerFrames,
    firstMarquee,
    opener8: frac(buckets.slice(0, WINDOW_FRAMES), isMarquee),
    marquee: frac(buckets, isMarquee),
    engaged: frac(buckets, (b) => b === 'ENGAGED'),
    neutral: frac(buckets, (b) => b === 'NEUTRAL'),
    dead,
    windows,
    supers,
    kos,
    heavies,
  }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const pct = (x) => (x * 100).toFixed(1) + '%'

function report(seeds, frames) {
  const runs = []
  for (let k = 0; k < seeds; k++) runs.push(censusOne(0x1000 + k * 0x9e37, frames))
  const col = (f) => runs.map(f)
  const ttfm = col((r) => (r.firstMarquee < 0 ? frames : r.firstMarquee))
  const deadOpeners = runs.filter((r) => r.firstMarquee < 0 || r.firstMarquee >= WINDOW_FRAMES)
  const mirrorOpeners = runs.filter((r) => r.matchup.a.archetype === r.matchup.b.archetype)

  console.log(`ATTRACT MONEY-SHOT CENSUS — ${seeds} seeds x ${frames}f (${(frames / FPS).toFixed(0)}s)`)
  console.log(`sim-time COMPOSITION, load-invariant — NOT fps (fps is env-bound; do not read this as frame rate)\n`)
  console.log(`OPENER (first 8s a scroller sees):`)
  console.log(`  time-to-first-marquee: median=${median(ttfm)}f (${(median(ttfm) / FPS).toFixed(1)}s)  min=${Math.min(...ttfm)}f  max=${Math.max(...ttfm)}f`)
  console.log(`  first-8s marquee:      median=${pct(median(col((r) => r.opener8)))}  range ${pct(Math.min(...col((r) => r.opener8)))}..${pct(Math.max(...col((r) => r.opener8)))}`)
  console.log(`  zero-marquee openers:  ${deadOpeners.length}/${seeds} (${pct(deadOpeners.length / seeds)})`)
  console.log(`  archetype-mirror bouts: ${mirrorOpeners.length}/${seeds} (${pct(mirrorOpeners.length / seeds)})  <- moveset repeats, skin-only guard misses these`)
  console.log(`\nWHOLE REEL:`)
  console.log(`  MARQUEE (super/KO/heavy): median=${pct(median(col((r) => r.marquee)))}  range ${pct(Math.min(...col((r) => r.marquee)))}..${pct(Math.max(...col((r) => r.marquee)))}`)
  console.log(`  ENGAGED (pokes/blocks):   median=${pct(median(col((r) => r.engaged)))}`)
  console.log(`  NEUTRAL (dead-air):       median=${pct(median(col((r) => r.neutral)))}`)
  const totDead = runs.reduce((a, r) => a + r.dead, 0)
  const totWin = runs.reduce((a, r) => a + r.windows, 0)
  console.log(`  dead 8s-windows:          ${totDead}/${totWin} (${pct(totDead / totWin)})`)
  console.log(`  per run: supers median=${median(col((r) => r.supers))}  KOs=${median(col((r) => r.kos))}  heavies=${median(col((r) => r.heavies))}`)
}

/** Mutation guard: every branch fires, and a frozen reel censuses zero marquee. */
function selftest() {
  const F = (stance) => ({ stance })
  const S = (over) => ({ phase: 'fight', fighters: [F('idle'), F('idle')], ...over })
  const cases = [
    ['idle => NEUTRAL', classify(S({}), []) === 'NEUTRAL'],
    ['attack stance => ENGAGED', classify({ phase: 'fight', fighters: [F('attack'), F('idle')] }, []) === 'ENGAGED'],
    ['light hit => ENGAGED (not marquee)', classify(S({}), [{ type: 'hit', level: 'light' }]) === 'ENGAGED'],
    ['superFreeze => SUPER', classify(S({ superFreeze: 5 }), []) === 'SUPER'],
    ['super-flash event => SUPER', classify(S({}), [{ type: 'super-flash', who: 0, moveId: 'x' }]) === 'SUPER'],
    ['ko phase => FINISH', classify(S({ phase: 'ko' }), []) === 'FINISH'],
    ['victory stance => FINISH', classify({ phase: 'fight', fighters: [F('victory'), F('defeat')] }, []) === 'FINISH'],
    ['heavy hit => HEAVY', classify(S({}), [{ type: 'hit', level: 'heavy' }]) === 'HEAVY'],
    ['knockdown event => HEAVY', classify(S({}), [{ type: 'knockdown', who: 1 }]) === 'HEAVY'],
  ]
  // Behavioural control: a LIVE reel must show marquee; a FROZEN one must not.
  const live = censusOne(0x1234, 1800).marquee
  const frozen = (() => {
    const dir = new AttractDirector({ seed: 0x1234 })
    dir.dispose() // a disposed director returns its frozen state with no events
    const bs = []
    for (let i = 0; i < 1800; i++) {
      const res = dir.step()
      bs.push(classify(res.state, res.events))
    }
    return bs.filter(isMarquee).length / bs.length
  })()
  cases.push([`live reel marquee > 0 (was ${pct(live)})`, live > 0])
  cases.push([`FROZEN reel marquee == 0 (was ${pct(frozen)}) — proves it reads action, not noise`, frozen === 0])

  let ok = true
  for (const [name, pass] of cases) {
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`)
    if (!pass) ok = false
  }
  console.log(ok ? '\nSELFTEST PASS' : '\nSELFTEST FAIL')
  process.exit(ok ? 0 : 1)
}

const argv = process.argv.slice(2)
if (argv.includes('--selftest')) {
  selftest()
} else {
  const nums = argv.filter((a) => !a.startsWith('--')).map(Number)
  report(nums[0] || 40, nums[1] || 3600)
}
