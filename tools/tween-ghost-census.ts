/**
 * tween-ghost-census — report double-exposure across every synthesised in-between
 * cel the roster ships.
 *
 * The gate (src/three/fight/__tests__/tweenGhosting.node.test.ts) answers
 * "is anything broken"; this answers "what, where, and how badly", which is what
 * you want while deciding whether a clip should be tweened at all. Both import
 * the SAME scorer from scripts/lib/ghost-score.ts — see that file for how the
 * threshold was calibrated and for the standing warning that the score is
 * validated as a detector and never as an optimisation target.
 *
 *   npx tsx tools/tween-ghost-census.ts
 *   npx tsx tools/tween-ghost-census.ts --id turley --all
 *   npx tsx tools/tween-ghost-census.ts --json
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { BROKEN_AT, byDrawing, scoreFighter, type CelScore } from '../scripts/lib/ghost-score'

const arg = (k: string, d: string | null = null): string | null => {
  const i = process.argv.indexOf(`--${k}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d
}
const asJson = process.argv.includes('--json')
const showAll = process.argv.includes('--all')

/** The six skins the select screen actually offers, for a shipping-scope summary. */
const SELECTABLE = ['chesky', 'spiegel', 'doshi', 'lenny', 'madhavan', 'turley']

const only = arg('id')
const ids = only
  ? [only]
  : readdirSync('public/fighters', { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join('public/fighters', d.name, 'assets.json')))
      .map((d) => d.name)
      .sort()

let rows: CelScore[] = []
for (const id of ids) {
  const r = await scoreFighter(id)
  if (r) rows.push(...r)
}
rows = byDrawing(rows)

if (asJson) {
  console.log(JSON.stringify(rows, null, 2))
} else {
  const tweens = rows.filter((r) => r.tween)
  const keys = rows.filter((r) => !r.tween)
  const band = (s: number): string => (s >= BROKEN_AT ? 'BROKEN' : s > 0 ? 'residue' : 'clean')

  console.log('\n=== IN-BETWEENS BY SEVERITY ===')
  if (!tweens.length) console.log('(none)')
  for (const r of tweens.slice().sort((a, b) => b.score - a.score)) {
    if (band(r.score) === 'clean' && !showAll) continue
    console.log(
      `${r.score.toFixed(1).padStart(5)}%  ${band(r.score).padEnd(8)} ${r.fighter.padEnd(10)} ${r.clip.padEnd(14)} ${r.name}`,
    )
  }

  const stat = (rs: CelScore[]): string =>
    rs.length
      ? `n=${String(rs.length).padStart(3)}  min ${Math.min(...rs.map((r) => r.score)).toFixed(1)}%  max ${Math.max(...rs.map((r) => r.score)).toFixed(1)}%  mean ${(rs.reduce((a, r) => a + r.score, 0) / rs.length).toFixed(1)}%`
      : 'n=0'

  console.log('\n=== BASELINE ===')
  console.log(`hand-drawn keys     ${stat(keys)}   <- positive control`)
  console.log(`synthesised tweens  ${stat(tweens)}`)

  const byClip = new Map<string, number[]>()
  for (const r of tweens) byClip.set(r.clip, [...(byClip.get(r.clip) ?? []), r.score])
  console.log('\n=== BY CLIP ===')
  console.log('clip            n   max    mean   broken')
  for (const [c, ss] of [...byClip.entries()].sort(
    (a, b) => b[1].reduce((x, y) => x + y, 0) / b[1].length - a[1].reduce((x, y) => x + y, 0) / a[1].length,
  )) {
    const mean = ss.reduce((a, b) => a + b, 0) / ss.length
    console.log(
      c.padEnd(14) +
        String(ss.length).padStart(3) +
        Math.max(...ss).toFixed(1).padStart(7) +
        mean.toFixed(1).padStart(8) +
        String(ss.filter((s) => s >= BROKEN_AT).length).padStart(7),
    )
  }

  const shipping = tweens.filter((r) => SELECTABLE.includes(r.fighter))
  const brokenShipping = shipping.filter((r) => r.score >= BROKEN_AT)
  console.log(
    `\nSELECTABLE ROSTER: ${brokenShipping.length} broken / ${shipping.length} in-betweens` +
      (brokenShipping.length ? '  <- SHIPPING A DOUBLE EXPOSURE' : '  <- clean'),
  )
}
