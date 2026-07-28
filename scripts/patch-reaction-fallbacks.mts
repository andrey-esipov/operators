/**
 * Apply core-pose reaction fallbacks to already-packed fighters.
 *
 * The rich hurt/juggle/knockdown/wakeup clips in CLIPS reference deep reaction
 * poses (hit-reel, juggle-*, knockdown-impact, wakeup-rise) that a partially
 * generated fighter never got, so atlas.ts drops those clips and the fighter
 * silently falls back to `idle` when hit — "the body registers nothing". This
 * fills the gap WITHOUT regenerating art or repacking the atlas: it reuses the
 * fighter's own already-registered atlas cells (hit-high, hit-low, knockdown,
 * ko, wakeup, idle), so there is no new pose and no foot-anchor drift to add.
 *
 * It resolves the exact same FALLBACK_CLIPS through the exact same resolveClip
 * the atlas builder now uses, so a future full regen produces byte-identical
 * clips (the patch cannot diverge from the pipeline). Idempotent: it only fills
 * a reaction that is absent or clamped to a single frame, and never overwrites a
 * fighter that already has a real (>=2 key) authored reaction.
 *
 * Run: npx tsx scripts/patch-reaction-fallbacks.mts
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FALLBACK_CLIPS, resolveClip } from './lib/frame-spec'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fightersDir = path.join(root, 'public', 'fighters')

interface Frame { name: string }
interface Clip { frames: number[]; durations: number[]; loop: boolean }
interface Assets { frames: Frame[]; clips: Record<string, Clip> }

const ids = fs
  .readdirSync(fightersDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(fightersDir, d.name, 'assets.json')))
  .map((d) => d.name)
  .sort()

let changed = 0
for (const id of ids) {
  const file = path.join(fightersDir, id, 'assets.json')
  const assets = JSON.parse(fs.readFileSync(file, 'utf8')) as Assets
  const nameToIndex = new Map<string, number>(assets.frames.map((f, i) => [f.name, i]))

  const applied: string[] = []
  for (const clipName of Object.keys(FALLBACK_CLIPS)) {
    const existing = assets.clips[clipName]
    // Only fill a genuinely shallow reaction: missing, or clamped to one frame.
    if (existing && existing.frames.length >= 2) continue
    const built = resolveClip(FALLBACK_CLIPS[clipName], nameToIndex)
    if (!built) continue // fighter lacks even the core poses; leave it untouched
    assets.clips[clipName] = built
    applied.push(`${clipName} ${existing ? existing.frames.length : 0}->${built.frames.length}`)
  }

  // juggle has no core-pose fallback (see FALLBACK_CLIPS): the roster has no
  // airborne-hit art, and clipCandidates('juggle') is ['juggle','hurt','idle'],
  // so juggle is meant to degrade to the hurt reel we just filled. A *frozen*
  // single-frame juggle clip blocks that degrade and holds the body on one pose
  // mid-launch — strictly worse than the 3-key hurt read. Remove it so the
  // driver degrades as designed. (This matches what a fresh atlas regen emits:
  // atlas.ts finds no deep juggle poses and no FALLBACK_CLIPS.juggle, so it emits
  // no juggle clip at all.)
  const frozenJuggle = assets.clips.juggle
  if (frozenJuggle && frozenJuggle.frames.length < 2) {
    delete assets.clips.juggle
    applied.push(`juggle ${frozenJuggle.frames.length}->degrade(hurt)`)
  }

  if (applied.length) {
    fs.writeFileSync(file, JSON.stringify(assets, null, 2))
    changed++
    console.log(`${id.padEnd(10)} ${applied.join(', ')}`)
  } else {
    console.log(`${id.padEnd(10)} (rich reactions intact — no change)`)
  }
}
console.log(`\n${changed} fighter file(s) patched`)
