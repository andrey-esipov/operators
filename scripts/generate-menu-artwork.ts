/**
 * Generate bespoke title-screen artwork via Azure gpt-image-2.
 *
 * Produces 1 hero image: a Street Fighter II-style title screen background
 * featuring a podcast-themed arcade composition.
 */

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function loadAzureConfig() {
  const gstackPath = path.join(os.homedir(), '.gstack', 'openai.json')
  let file: any = {}
  try {
    if (fs.existsSync(gstackPath)) {
      file = JSON.parse(fs.readFileSync(gstackPath, 'utf-8'))
    }
  } catch {/* ignore */}
  const azureFile = file?.azure || {}
  return {
    endpoint: (process.env.AZURE_OPENAI_ENDPOINT || azureFile.endpoint || '').replace(/\/$/, ''),
    apiKey: process.env.AZURE_OPENAI_API_KEY || azureFile.api_key || '',
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT || azureFile.image_deployment || 'gpt-image-2',
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || azureFile.api_version || '2025-04-01-preview',
  }
}

const cfg = loadAzureConfig()

const PROMPTS: Array<{ id: string; size: string; prompt: string }> = [
  {
    id: 'title-hero',
    size: '1536x1024',
    prompt: `A Street Fighter II / King of Fighters '98 arcade title screen.

CENTRAL FOCUS: a large stylized retro podcast microphone (chrome and gold, with vintage windscreen) at the dead center of the composition. Behind the mic, golden headphones glow with neon energy. The mic and headphones are the iconic motif — like Ryu's headband in SF II.

BACKGROUND: a sweeping pixel-art arcade cityscape at sunset. Neon signs in the distance. A glowing horizon with bold orange-to-purple gradient sky. Geometric pixel-art accents — diamonds, dot patterns, arcade-style pillars on either side framing the composition.

FOREGROUND: 8 stylized pixel-art fighter silhouettes — diverse business operators in fighting stances, arranged in a dramatic semicircle around the microphone. Their poses face outward like the SF II character lineup. Each silhouette glints with rim-light from the central mic.

STYLE:
- 16-bit pixel art in the iconic Street Fighter II / King of Fighters '98 / Capcom arcade tradition
- HARD crisp pixel boundaries — NO anti-aliasing, NO blur
- Vibrant saturated arcade palette: red, gold, orange, electric purple, neon pink, deep navy
- Dramatic stage lighting with rim-light highlights on every silhouette
- Painterly pixel-art background reminiscent of Eastward and Octopath Traveler
- High contrast, dramatic composition

LEAVE EMPTY SPACE: leave a clear horizontal band across the upper third of the image where a TITLE WORDMARK will be overlaid by the game later. The middle and lower thirds should be the visual showpiece.

NEGATIVE: no text, no logos, no words, no watermarks, no modern flat illustration, no Disney style, no 3D rendering, no photorealism.

OUTPUT: 1536x1024 pixel-art title screen background, no text.`,
  },
]

async function generate(prompt: string, size: string): Promise<Buffer> {
  const url = `${cfg.endpoint}/openai/deployments/${cfg.deployment}/images/generations?api-version=${cfg.apiVersion}`
  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), 360_000)
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'api-key': cfg.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt, size, quality: 'high', n: 1, output_format: 'png',
          }),
          signal: ctl.signal,
        })
        if (!res.ok) throw new Error(`Azure ${res.status}: ${(await res.text()).slice(0, 300)}`)
        const data = (await res.json()) as { data: Array<{ b64_json?: string; url?: string }> }
        const first = data.data[0]
        if (first.b64_json) return Buffer.from(first.b64_json, 'base64')
        if (first.url) {
          const r = await fetch(first.url)
          return Buffer.from(await r.arrayBuffer())
        }
        throw new Error('no image')
      } finally {
        clearTimeout(t)
      }
    } catch (e) {
      lastErr = e as Error
      const retryable = /fetch failed|429|5\d\d|aborted|ECONNRESET/i.test(lastErr.message)
      if (!retryable || attempt === 4) throw lastErr
      const wait = Math.pow(3, attempt) * 1000 + Math.random() * 1500
      console.log(`  ↻ retry ${attempt}/3 after ${(wait/1000).toFixed(1)}s — ${lastErr.message.slice(0, 80)}`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw lastErr ?? new Error('unknown')
}

async function main() {
  if (!cfg.endpoint || !cfg.apiKey) {
    console.error('Azure config missing')
    process.exit(1)
  }
  const OUT = path.resolve(process.cwd(), 'public/menu')
  fs.mkdirSync(OUT, { recursive: true })

  for (const spec of PROMPTS) {
    const outPath = path.join(OUT, `${spec.id}.png`)
    console.log(`→ ${spec.id} (${spec.size}) ...`)
    try {
      const buf = await generate(spec.prompt, spec.size)
      fs.writeFileSync(outPath, buf)
      console.log(`  ✓ wrote ${outPath} (${(buf.byteLength / 1024).toFixed(1)}KB)`)
    } catch (e) {
      console.warn(`  ✗ failed: ${(e as Error).message}`)
    }
  }
}

main().catch(console.error)
