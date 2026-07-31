#!/usr/bin/env node
/**
 * Critic prep — makes screenshots safe to hand to a vision agent.
 *
 * A raw 1920x1080 PNG from tools/shot.mjs is ~2 MB, which becomes ~2.8 MB once
 * base64-encoded into an LLM request. Three or four of them exceed the 5 MB
 * request ceiling and permanently wedge a conversation, because every prior
 * image stays in context for every subsequent turn.
 *
 * This downscales to a long edge of 1280 and re-encodes as JPEG, which is ~15-20x
 * smaller while preserving everything an art-director pass actually judges:
 * composition, silhouette, value structure, colour, hierarchy, readability.
 *
 * Uses macOS `sips` so there is no image dependency to install.
 *
 *   node tools/critic-prep.mjs .shots/*.png --out /tmp/critic/wave1
 *   node tools/critic-prep.mjs .hud-agent/shots --out /tmp/critic/hud --max 1280
 *
 * Prints a text-only manifest (path + byte size + est. base64 cost) and refuses
 * to emit a batch whose total would exceed the budget.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt
}

const outDir = resolve(arg('out', '/tmp/critic/batch'))
const maxEdge = Number(arg('max', 1280))
const quality = Number(arg('quality', 72))
/** Hard ceiling on the whole batch, in MB of estimated base64 payload. */
const budgetMb = Number(arg('budget', 3))

const inputs = argv.filter((a, i) => {
  if (a.startsWith('--')) return false
  const prev = argv[i - 1]
  return !(prev && prev.startsWith('--'))
})

if (inputs.length === 0) {
  console.error('usage: critic-prep.mjs <png|dir> [...] --out <dir> [--max 1280] [--quality 72] [--budget 3]')
  process.exit(2)
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])

const files = []
for (const input of inputs) {
  const p = resolve(input)
  if (!existsSync(p)) {
    console.error(`skip (missing): ${input}`)
    continue
  }
  if (statSync(p).isDirectory()) {
    for (const name of readdirSync(p).sort()) {
      if (IMAGE_EXT.has(extname(name).toLowerCase())) files.push(join(p, name))
    }
  } else if (IMAGE_EXT.has(extname(p).toLowerCase())) {
    files.push(p)
  }
}

if (files.length === 0) {
  console.error('no images matched')
  process.exit(2)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const rows = []
let totalOut = 0
let totalIn = 0

for (const src of files) {
  const dest = join(outDir, `${basename(src, extname(src))}.jpg`)
  try {
    execFileSync(
      '/usr/bin/sips',
      ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), '-Z', String(maxEdge), src, '--out', dest],
      { stdio: 'ignore' },
    )
  } catch {
    console.error(`FAILED to convert ${src}`)
    continue
  }
  const inBytes = statSync(src).size
  const outBytes = statSync(dest).size
  totalIn += inBytes
  totalOut += outBytes
  rows.push({ name: basename(dest), dest, inBytes, outBytes })
}

const kb = (b) => `${(b / 1024).toFixed(0)}kb`
const mb = (b) => `${(b / 1024 / 1024).toFixed(2)}mb`
/** base64 inflates by 4/3, plus per-image protocol overhead. */
const b64 = (b) => b * 1.37

console.log(`critic batch -> ${outDir}`)
for (const r of rows) {
  console.log(`  ${r.name.padEnd(28)} ${kb(r.inBytes).padStart(8)} -> ${kb(r.outBytes).padStart(7)}`)
}
console.log(
  `\n${rows.length} images  raw ${mb(totalIn)} -> prepped ${mb(totalOut)}  (est. ${mb(b64(totalOut))} in-context)`,
)

const estMb = b64(totalOut) / 1024 / 1024
if (estMb > budgetMb) {
  console.log(
    `\nOVER BUDGET: est. ${estMb.toFixed(2)}mb > ${budgetMb}mb.` +
      ` Split this batch across more agents, or lower --max / --quality.`,
  )
  process.exitCode = 1
} else {
  console.log(`within budget (${estMb.toFixed(2)}mb / ${budgetMb}mb)`)
}

console.log(`\nPaths for the vision agent:\n${rows.map((r) => r.dest).join('\n')}`)
