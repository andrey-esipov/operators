import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // allowedHosts: true required on dev server too so Replit's proxy
  // domain (*.repl.co / *.replit.dev) can reach Vite without hitting
  // "Blocked request. This host is not allowed."
  server: { port: 5173, host: true, allowedHosts: true, strictPort: false },
  preview: { port: 5000, host: true, allowedHosts: true, strictPort: false },
})
