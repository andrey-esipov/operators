/**
 * Batch driver for the animation pipeline.
 *
 * Runs `generateFighter` across many fighters with the same resumability the
 * per-fighter script has: a fighter whose cached frames all pass is skipped on
 * a rerun, so a batch that dies partway through costs nothing to restart. Prints
 * an up-front cost/time estimate, per-fighter progress, and a projection for
 * the full 64-fighter roster once a few are done and the real per-frame time
 * is known.
 *
 *   npx tsx scripts/batch-animations.ts chesky altman doshi reid
 *   npx tsx scripts/batch-animations.ts --all          # every roster fighter
 *   npx tsx scripts/batch-animations.ts chesky --force  # regenerate cached
 */
import fs from 'node:fs'
import path from 'node:path'
import { FRAMES } from './lib/frame-spec'
import { generateFighter, type FighterSummary } from './generate-animation-set'

const ROSTER_SIZE = 64
const GEN_FRAMES = FRAMES.length // stance frame is free
// Rough, and clearly flagged as such: gpt-image-2 high-quality 1024² edits bill
// on the order of ~$0.17 each. Treat the dollar figure as an order-of-magnitude
// guide, not an invoice.
const COST_PER_IMAGE_USD = 0.17

function allRosterIds(): string[] {
  const dir = path.resolve(process.cwd(), 'public/sprites')
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'stance.png')))
    .map((d) => d.name)
    .sort()
}

/** Frames already cached for a fighter — what a rerun won't pay to generate. */
function cachedCount(id: string): number {
  const rawDir = path.resolve(process.cwd(), '.sprite-gen', id, 'raw')
  if (!fs.existsSync(rawDir)) return 0
  return fs.readdirSync(rawDir).filter((f) => f.endsWith('.png')).length
}

function fmtDuration(s: number): string {
  if (s < 90) return `${s.toFixed(0)}s`
  const m = s / 60
  if (m < 90) return `${m.toFixed(0)}m`
  return `${(m / 60).toFixed(1)}h`
}

function estimate(ids: string[], force: boolean, secPerFrame: number): void {
  let toGen = 0
  for (const id of ids) toGen += force ? GEN_FRAMES : Math.max(0, GEN_FRAMES - cachedCount(id))
  console.log('─'.repeat(64))
  console.log(`Batch of ${ids.length} fighter(s), ${GEN_FRAMES} generated frames each.`)
  console.log(`  frames to generate now: ${toGen}${force ? ' (forced)' : ' (cache-aware)'}`)
  console.log(`  est. cost:  ~$${(toGen * COST_PER_IMAGE_USD).toFixed(2)} (approx; ~$${COST_PER_IMAGE_USD}/image)`)
  console.log(`  est. time:  ~${fmtDuration(toGen * secPerFrame)} at ~${secPerFrame.toFixed(0)}s/frame wall (concurrency 2)`)
  console.log('─'.repeat(64))
}

function rosterProjection(secPerFrame: number): void {
  const total = ROSTER_SIZE * GEN_FRAMES
  console.log('\n── full-roster (64) projection ' + '─'.repeat(33))
  console.log(`  frames: ${total}`)
  console.log(`  cost:   ~$${(total * COST_PER_IMAGE_USD).toFixed(0)} (approx)`)
  console.log(`  time:   ~${fmtDuration(total * secPerFrame)} of wall clock at the observed ${secPerFrame.toFixed(0)}s/frame`)
  console.log('  (resumable — safe to run in chunks; cached frames are never re-billed)')
  console.log('─'.repeat(64))
}

async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const offline = args.includes('--offline')
  const all = args.includes('--all')
  const ids = all ? allRosterIds() : args.filter((a) => !a.startsWith('--'))
  if (!ids.length) throw new Error('usage: batch-animations.ts <id...> | --all [--force] [--offline]')

  // Start from a conservative wall-time guess, refine it from measured runs.
  let secPerFrame = 30
  estimate(ids, force, secPerFrame)

  const summaries: FighterSummary[] = []
  let totalFramesGenerated = 0
  let totalMs = 0

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    console.log(`\n[${i + 1}/${ids.length}] ${id} …`)
    try {
      const s = await generateFighter(id, { force, offline, log: (m) => console.log(m) })
      summaries.push(s)
      if (s.generated + s.regenerations > 0) {
        totalFramesGenerated += s.generated + s.regenerations
        totalMs += s.ms
        // Refine the wall-time estimate from what actually happened.
        secPerFrame = (totalMs / 1000) / totalFramesGenerated
      }
      console.log(
        `  done: ${s.frames.length} frames · gen ${s.generated} · reused ${s.reused} · regen ${s.regenerations}` +
        ` · atlas ${s.atlasSize.width}x${s.atlasSize.height} · ${(s.ms / 1000).toFixed(0)}s` +
        (s.failedFrames.length ? ` · FAILED: ${s.failedFrames.join(',')}` : ''),
      )
    } catch (e) {
      console.error(`  ERROR ${id}: ${(e as Error).message}`)
    }
  }

  // Aggregate report.
  console.log('\n' + '═'.repeat(64))
  console.log('BATCH REPORT')
  const totalFrames = summaries.reduce((n, s) => n + s.frames.length, 0)
  const totalFailed = summaries.reduce((n, s) => n + s.failedFrames.length, 0)
  const totalMissing = summaries.reduce((n, s) => n + s.missingFrames.length, 0)
  const totalWarned = summaries.reduce((n, s) => n + s.warnedFrames.length, 0)
  const totalRegen = summaries.reduce((n, s) => n + s.regenerations, 0)
  console.log(`  fighters ok:     ${summaries.length}/${ids.length}`)
  console.log(`  frames total:    ${totalFrames}`)
  console.log(`  hard failures:   ${totalFailed} (${totalFrames ? ((totalFailed / totalFrames) * 100).toFixed(1) : '0'}%) — frames kept as best-of-3`)
  console.log(`  missing frames:  ${totalMissing} (dropped from atlas — safety blocks / offline gaps)`)
  console.log(`  regenerations:   ${totalRegen} (frames that needed at least one retry)`)
  console.log(`  aspect warnings: ${totalWarned} (flagged for review, not auto-rejected)`)
  for (const s of summaries) {
    if (s.failedFrames.length || s.missingFrames.length || s.warnedFrames.length || !s.anchorsOk) {
      console.log(`   · ${s.id}: ${s.failedFrames.length ? 'fail[' + s.failedFrames.join(',') + '] ' : ''}${s.missingFrames.length ? 'missing[' + s.missingFrames.join(',') + '] ' : ''}${s.warnedFrames.length ? 'warn[' + s.warnedFrames.join(',') + '] ' : ''}${s.anchorsOk ? '' : 'ANCHOR-DRIFT'}`)
    }
  }
  if (totalFramesGenerated > 0) rosterProjection(secPerFrame)
}

main().catch((e) => { console.error(e); process.exit(1) })
