/**
 * Manifest-only clip rebuild.
 *
 * Re-derives every fighter's derived-attack `clips` from the current frame-spec
 * (the timing-derived attack ladder — every dedicated-clip strike, see frame-spec
 * `deriveAttackClip`) and rewrites ONLY those keys in each playable skin's
 * assets.json. It never reads or writes atlas.png and never re-runs sprite
 * generation, so the packed atlas image is byte-for-byte untouched — the fix is a
 * pure timing/data change over cels that already exist in the atlas.
 *
 * This is the reviewable regeneration path for the fix: the full pipeline
 * (generate-animation-set) would re-run the non-deterministic AI art step and
 * rewrite the PNG, which is exactly what must NOT happen here. Both paths build
 * clips through the same `buildClips`, so they cannot diverge.
 *
 *   npx tsx scripts/rebuild-manifest-clips.ts          # rewrite changed manifests
 *   npx tsx scripts/rebuild-manifest-clips.ts --check  # report, exit 1 if any drift
 */
import fs from 'node:fs'
import path from 'node:path'
import { attackTimingForSkin } from './lib/fighter-timing'
import { CLIPS, DERIVED_ATTACKS, FALLBACK_CLIPS, deriveAttackClip, resolveClip } from './lib/frame-spec'
import { ROSTER } from '../src/fighthud/select/roster'
import type { FighterAssets } from '../src/fight/types'

const check = process.argv.includes('--check')
const publicDir = path.resolve(process.cwd(), 'public/fighters')

// The choosable roster can list a skin twice only if authored so; de-dupe.
const skins = [...new Set(ROSTER.map((r) => r.skin))]

let changed = 0
let drift = 0

for (const skin of skins) {
  const file = path.join(publicDir, skin, 'assets.json')
  if (!fs.existsSync(file)) {
    console.error(`  ${skin}: MISSING ${file}`)
    process.exitCode = 1
    continue
  }
  const raw = fs.readFileSync(file, 'utf8')
  const assets = JSON.parse(raw) as FighterAssets

  const timing = attackTimingForSkin(skin)
  if (!timing) {
    console.log(`  ${skin}: no moveset (unplayable art) — skipped`)
    continue
  }
  const nameToIdx = new Map(assets.frames.map((f, i) => [f.name, i]))

  // SURGICAL: only the derived attack move-ids are recomputed and overwritten in
  // place. Every other clip (idle, walks, reactions, and any orphan clip a
  // partial fighter carries from an older pipeline) is left exactly as shipped —
  // a full rebuild would wrongly drop or alter those. Key order is preserved
  // because existing values are replaced, none added or removed. A skin that
  // never generated a move's contact cel is left on its existing clip (the derive
  // call bails), and missing startup/recovery tweens degrade to the neutral pose
  // rather than dropping the clip.
  const diffs: string[] = []
  for (const moveId of Object.keys(DERIVED_ATTACKS)) {
    const existing = assets.clips[moveId]
    if (!existing) continue // this fighter has no clip for that move
    const t = timing.get(moveId)
    if (!t) continue // move-id not in this archetype's set
    const spec = deriveAttackClip(moveId, t, (n) => nameToIdx.has(n))
    // Mirror the GENERATOR's resolution exactly (scripts/lib/atlas.ts): when
    // deriveAttackClip bails, the pipeline bakes the static CLIPS entry, then
    // FALLBACK_CLIPS. Skipping the null case here (`if (!spec) continue`) made
    // this checker blind to the single most consequential drift there is — a
    // move falling OUT of the derived ladder and back onto a hand-tuned static
    // whose fixed durations misalign with the real active window. That is the
    // "kick ladder freezes on the standing idle pose" defect, and it went
    // undetected on cr.LK/cr.MK/cr.HK/j.MK for every skin without the Tier C
    // crouch cels. The header's claim that the two paths "cannot diverge" was
    // false precisely here, because this line forked the resolution and dropped
    // a case the generator handles.
    const resolved =
      resolveClip(spec ?? CLIPS[moveId], nameToIdx) ?? resolveClip(FALLBACK_CLIPS[moveId], nameToIdx)
    if (!resolved) {
      console.error(`  ${skin}: derived clip ${moveId} references a cel this skin lacks — not overwriting`)
      process.exitCode = 1
      continue
    }
    const bs = `${JSON.stringify(existing.frames)} d${JSON.stringify(existing.durations)}`
    const as = `${JSON.stringify(resolved.frames)} d${JSON.stringify(resolved.durations)}`
    if (bs !== as) {
      diffs.push(`      ${moveId.padEnd(9)} ${bs}  ->  ${as}`)
      assets.clips[moveId] = resolved
    }
  }

  if (diffs.length === 0) {
    console.log(`  ${skin}: attack clips already aligned`)
    continue
  }
  drift++
  console.log(`  ${skin}: ${diffs.length} attack clip(s) change`)
  for (const d of diffs) console.log(d)

  if (!check) {
    fs.writeFileSync(file, JSON.stringify(assets, null, 2))
    changed++
  }
}

if (check && drift > 0) {
  console.error(`\n${drift} manifest(s) drift from frame-spec. Run without --check to rewrite.`)
  process.exitCode = 1
} else if (!check) {
  console.log(`\nrewrote ${changed} manifest(s)`)
}
