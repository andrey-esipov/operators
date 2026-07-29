import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { atlasCostsPlugin } from './scripts/atlasCostsPlugin.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), atlasCostsPlugin()],
  // allowedHosts: true required on dev server too so Replit's proxy
  // domain (*.repl.co / *.replit.dev) can reach Vite without hitting
  // "Blocked request. This host is not allowed."
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    strictPort: false,
    watch: {
      // A capture run writes hundreds of megabytes of PNGs while the page it
      // is photographing is still open. Vite watches the project root, sees
      // those writes, and reloads the page MID-CAPTURE — so the frames land
      // on a fighter that has been reset to idle. That reads as an animation
      // bug and has cost real debugging time. None of these paths are ever
      // imported by the app, so nothing here can invalidate a module.
      ignored: [
        '**/tools/**',
        '**/.shots/**',
        '**/shots/**',
        '**/shots-cam/**',
        '**/vfx-shots/**',
        '**/critique/**',
        '**/dist-measure/**',
        '**/*-shots/**',
      ],
    },
  },
  preview: { port: 5000, host: true, allowedHosts: true, strictPort: false },
  test: {
    // Two carve-outs, both about keeping the shared gate honest.
    //
    // 1. `_*.probe.test.ts` — one-shot measurement dumps, some of which throw
    //    deliberately to print their numbers. Scratch must never be able to
    //    redden the suite for everyone else. (Mirrored in tsconfig.app.json.)
    //
    // 2. Nested git worktrees. Agents create detached worktrees INSIDE the repo
    //    (`.sprite-probe/wt`, `_critic-<sha>`, `_calib-<sha>`, `_r2-tip-<sha>`)
    //    to capture against a pinned SHA. Each holds a FULL COPY of src/, so
    //    vitest's default `**/*.test.ts` collected every copy: the suite
    //    reported 2905 tests when the real number is 450 — inflated ~6.5x by
    //    the same assertions counted over and over.
    //
    //    That is not just a cosmetic miscount. It made the headline pass number
    //    meaningless as a quality signal, ran the suite ~6x slower than needed,
    //    and — worst — meant a STALE copy pinned to an old SHA could redden the
    //    gate over code that no longer exists, or stay green over code that was
    //    since broken. A gate that reports on a different revision than the one
    //    you are about to ship is a lying harness by construction.
    //
    //    That hazard then materialised in a form the list above did not cover.
    //    `.sprite-gen/_scratch/` (the sprite generator's working dir, NOT the
    //    already-excluded `.sprite-probe/`) held two stale snapshots of
    //    contactCel.test.ts — 452 and 415 lines against the real file's 533 —
    //    left behind by an agent's mutation run. vitest collected both, they
    //    failed to resolve their relative imports, and a clean tree reported
    //    "2 failed | 102 passed (104)" with zero failing assertions. Being
    //    gitignored does not help: vitest's include globs do not read
    //    .gitignore, so ignored scratch is exactly the scratch that goes
    //    unnoticed. `_scratch` is excluded by name anywhere in the tree so the
    //    next generator that invents its own directory is covered by default.
    // 3. Timeouts are a LIVENESS backstop, not a performance threshold.
    //
    //    This block previously set no timeout at all, so the whole suite ran on
    //    vitest's 5s default while several gates do real work: `sharp` image
    //    decoding against on-disk PNGs, the atlas VRAM budget reading IHDR
    //    headers, and the AI moveset census stepping thousands of sim frames.
    //
    //    The result was a gate whose verdict depended on how busy the machine
    //    was. The same SHA returned `3 failed | 565 passed` and then
    //    `0 failed | 568 passed` on consecutive runs, with no test touching
    //    wall-clock, `Date.now`, or timers. A 5s default is a performance gate
    //    cosplaying as a hang-guard.
    //
    //    That is not a flake, it is a teaching failure: it trains everyone to
    //    re-run until green, which is precisely how a real regression gets
    //    waved through. Note the asymmetry — green under load is conclusive
    //    (if it passes busy it passes idle), but RED under load is only a
    //    bound, and the gate was hard-failing on it either way.
    //
    //    60s is chosen so that crossing it can only mean "hung", never "slow
    //    box". Timeouts cost nothing when tests pass, so there is no reason to
    //    keep the budget tight enough to race a co-tenant.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    exclude: [
      ...configDefaults.exclude,
      '**/_*.probe.test.ts',
      '**/.sprite-probe/**',
      '**/.sprite-gen/**',
      '**/_scratch/**',
      '**/_critic-*/**',
      '**/_calib-*/**',
      '**/_r2-*/**',
      '**/_stageart-*/**',
      '**/_vfx-*/**',
      '**/dist-*/**',
    ],
  },
})
