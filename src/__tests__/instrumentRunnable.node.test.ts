import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Instrument RUNNABILITY gate — the sibling of instrumentRouting.node.test.ts.
 * Routing proves a tool observes the RIGHT game; this proves it still RUNS the way
 * its manifest card promises.
 *
 * THE DEFECT THIS EXISTS TO PREVENT. `tools/instrument-manifest.json` advertises
 * certain instruments as head-less and card-clean — "Run with `npx tsx` … no
 * browser, no renderer, no route." Nothing gated that promise, and it broke:
 * 26b86f6 moved `ATLAS_COST_BYTES` behind a Vite virtual module
 * (`virtual:atlas-costs`), and `attract-census` transitively imports it through
 * the reel director. So its documented invocation —
 *
 *     node --import tsx tools/attract-census.mjs --selftest
 *
 * — began dying with ERR_UNSUPPORTED_ESM_URL_SCHEME (protocol 'virtual:'), because
 * only Vite resolves that scheme. The entire vitest suite stayed green the whole
 * time, and THAT is the point: two existing tests import the same cost table and
 * passed, because VITEST resolves `virtual:` and a plain node/tsx loader does not.
 *
 * "Passes under vitest" was standing in for "the instrument runs", and the failure
 * mode satisfied the proxy. It is the same shape as a source-text gate standing in
 * for execution, or a reel's `phase` standing in for intent: a cheap proxy that a
 * real break can slip past. This gate refuses the proxy and asserts the promise
 * itself — it SPAWNS the tool in a child process under a plain node loader (no
 * Vite anywhere) and requires exit 0. A Vite-only import leaking back into a node
 * tool reddens here, deterministically, with the child's own stderr attached.
 *
 * SCOPE. The vulnerable set is the tools that import the shipped attract/director
 * stack and so inherit whatever resolver that stack needs; today that is exactly
 * `attract-census`. The table below is the single place to add any future
 * tsx-runnable instrument, so "the manifest says runnable" and "a test runs it
 * that way" cannot drift apart again. `--selftest` is used because every such
 * instrument ships one as its fast, deterministic, no-arg mutation guard, so exit
 * 0 proves BOTH that the module graph resolves headless AND that its own controls
 * pass.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')

/** Manifest-advertised head-less instruments, each with an invocation that must
 *  exit 0 under a plain node loader (no Vite). */
const TSX_RUNNABLE = [{ tool: 'tools/attract-census.mjs', args: ['--selftest'] }] as const

describe('manifest-advertised tsx instruments run under a plain node loader (no Vite)', () => {
  it('names at least one instrument, each present on disk (vacuity guard)', () => {
    expect(TSX_RUNNABLE.length).toBeGreaterThan(0)
    for (const { tool } of TSX_RUNNABLE) {
      expect(existsSync(resolve(REPO, tool)), `manifest tool missing on disk: ${tool}`).toBe(true)
    }
  })

  for (const { tool, args } of TSX_RUNNABLE) {
    it(`runs \`node --import tsx ${tool} ${args.join(' ')}\` to exit 0`, () => {
      const res = spawnSync(process.execPath, ['--import', 'tsx', tool, ...args], {
        cwd: REPO,
        encoding: 'utf8',
        timeout: 55_000,
      })
      const detail =
        `exit=${res.status} signal=${res.signal}\n` +
        `--- child stderr (tail) ---\n${(res.stderr || '').slice(-2000)}\n` +
        `--- child stdout (tail) ---\n${(res.stdout || '').slice(-800)}`
      expect(res.error, `failed to spawn ${tool}: ${res.error?.message}`).toBeUndefined()
      expect(
        res.status,
        `\`node --import tsx ${tool} ${args.join(' ')}\` must exit 0 — its manifest card ` +
          `promises a head-less, card-clean run. A non-zero exit means the documented ` +
          `invocation is broken, typically a Vite-only import (e.g. virtual:atlas-costs) ` +
          `leaking into a node tool.\n${detail}`,
      ).toBe(0)
    })
  }
})
