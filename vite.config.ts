import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    exclude: [
      ...configDefaults.exclude,
      '**/_*.probe.test.ts',
      '**/.sprite-probe/**',
      '**/_critic-*/**',
      '**/_calib-*/**',
      '**/_r2-*/**',
      '**/_stageart-*/**',
      '**/_vfx-*/**',
      '**/dist-*/**',
    ],
  },
})
