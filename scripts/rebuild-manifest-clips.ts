/**
 * Manifest-only clip rebuild.
 *
 * Re-derives every fighter's `clips` from the current frame-spec (crucially the
 * timing-derived kick ladder, see frame-spec `deriveAttackClip`) and rewrites
 * ONLY the `clips` field of each playable skin's assets.json. It never reads or
 * writes atlas.png and never re-runs sprite generation, so the packed atlas
 * image is byte-for-byte untouched — the fix is a pure timing/data change over
 * cels that already exist in the atlas.
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
import { DERIVED_ATTACKS, deriveAttackClip, resolveClip } from './lib/frame-spec'
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

  // SURGICAL: only the derived kick move-ids are recomputed and overwritten in
  // place. Every other clip (idle, walks, punches, specials, reactions) is left
  // exactly as shipped — partial fighters carry clips built by older pipelines
  // that a full rebuild would wrongly drop or alter. Key order is preserved
  // because existing values are replaced, none added or removed.
  const diffs: string[] = []
  for (const moveId of Object.keys(DERIVED_ATTACKS)) {
    const existing = assets.clips[moveId]
    if (!existing) continue // this fighter has no clip for that move
    const t = timing.get(moveId)
    if (!t) continue // move-id not in this archetype's set
    const spec = deriveAttackClip(moveId, t)
    if (!spec) continue
    const resolved = resolveClip(spec, nameToIdx)
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
    console.log(`  ${skin}: kick clips already aligned`)
    continue
  }
  drift++
  console.log(`  ${skin}: ${diffs.length} kick clip(s) change`)
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
