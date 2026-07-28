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
    // Same scratch-probe carve-out as tsconfig.app.json: `_*.probe.test.ts`
    // files are one-shot measurement dumps, and some throw deliberately to
    // print their numbers. They must not be able to redden the shared suite.
    exclude: [...configDefaults.exclude, '**/_*.probe.test.ts'],
  },
})
