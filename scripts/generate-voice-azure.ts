/**
 * Generate self-contained voice line audio via Azure Speech (Neural TTS).
 *
 * Reads config from ~/.gstack/azure-speech.json OR env vars:
 *   AZURE_SPEECH_KEY=...
 *   AZURE_SPEECH_REGION=eastus
 *
 * Output: public/audio/voices/<fighterId>/<lineKey>.mp3
 *         public/audio/voices/announcer/<key>.mp3   (FIGHT, KO, etc.)
 *         public/audio/voices/stages/<scenarioId>.mp3
 *
 * Usage:
 *   npx tsx scripts/generate-voice-azure.ts                 # everything missing
 *   npx tsx scripts/generate-voice-azure.ts --force         # re-render all
 *   npx tsx scripts/generate-voice-azure.ts chesky lenny    # specific fighters
 *   npx tsx scripts/generate-voice-azure.ts --announcer     # just announcer + stages
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { FIGHTERS } from '../src/data/fighters'
import { SCENARIOS } from '../src/data/scenarios'

// ─── Config ──────────────────────────────────────────────────────────────
function loadAzureConfig() {
  const gstackPath = path.join(os.homedir(), '.gstack', 'azure-speech.json')
  let file: { key?: string; region?: string } = {}
  try {
    if (fs.existsSync(gstackPath)) file = JSON.parse(fs.readFileSync(gstackPath, 'utf-8'))
  } catch {
    // ignore
  }
  const key = process.env.AZURE_SPEECH_KEY || file.key || ''
  const region = process.env.AZURE_SPEECH_REGION || file.region || 'eastus'
  return { key, region }
}

const OUT_DIR = path.resolve(process.cwd(), 'public/audio/voices')

// ─── Voice profiles (gravitas/tone over accents) ──────────────────────────
interface ToneProfile {
  voice: string         // Azure Neural voice short name
  pitchPct: number      // -50..+50 — applied via SSML prosody
  ratePct: number       // -50..+50 — applied via SSML prosody
  style?: string        // optional Azure expressive style
}

const PROFILES: Record<string, ToneProfile> = {
  // Boss
  lenny:      { voice: 'en-US-DavisNeural',     pitchPct: -8, ratePct: -15 },

  // Mature gravitas
  andreessen: { voice: 'en-US-RogerNeural',     pitchPct: -5, ratePct: -10 },
  seth:       { voice: 'en-US-RogerNeural',     pitchPct: -3, ratePct: -8 },

  // Warm conversational
  cagan:      { voice: 'en-US-DavisNeural',     pitchPct: -2, ratePct: -5 },
  jason:      { voice: 'en-US-DavisNeural',     pitchPct: 0,  ratePct: -6 },

  // Confident young male
  chesky:     { voice: 'en-US-AndrewNeural',    pitchPct: 0,  ratePct: 0 },
  altman:     { voice: 'en-US-AndrewNeural',    pitchPct: -2, ratePct: -2 },
  krieger:    { voice: 'en-US-AndrewNeural',    pitchPct: 2,  ratePct: 0 },
  tobi:       { voice: 'en-US-AndrewNeural',    pitchPct: -2, ratePct: 2 },
  stewart:    { voice: 'en-US-AndrewNeural',    pitchPct: 1,  ratePct: -2 },
  taylor:     { voice: 'en-US-AndrewNeural',    pitchPct: 0,  ratePct: 1 },

  // Energetic / fast
  turley:     { voice: 'en-US-SteffanNeural',   pitchPct: 4,  ratePct: 8 },
  lazar:      { voice: 'en-US-SteffanNeural',   pitchPct: 2,  ratePct: 12 },
  nikita:     { voice: 'en-US-SteffanNeural',   pitchPct: 5,  ratePct: 10 },
  boris:      { voice: 'en-US-SteffanNeural',   pitchPct: 3,  ratePct: 6 },
  drew:       { voice: 'en-US-SteffanNeural',   pitchPct: 0,  ratePct: 4 },
  dylan:      { voice: 'en-US-SteffanNeural',   pitchPct: 4,  ratePct: 5 },
  amjad:      { voice: 'en-US-SteffanNeural',   pitchPct: 1,  ratePct: 3 },

  // Measured professional male
  doshi:      { voice: 'en-US-JasonNeural',     pitchPct: 0,  ratePct: -3 },
  simon:      { voice: 'en-US-JasonNeural',     pitchPct: 2,  ratePct: -2 },
  madhavan:   { voice: 'en-US-JasonNeural',     pitchPct: -2, ratePct: -3 },
  gokul:      { voice: 'en-US-JasonNeural',     pitchPct: -1, ratePct: -4 },
  spiegel:    { voice: 'en-US-JasonNeural',     pitchPct: -3, ratePct: -5 },

  // Warm female
  catwu:      { voice: 'en-US-AriaNeural',      pitchPct: 4,  ratePct: 3 },
  julie:      { voice: 'en-US-AriaNeural',      pitchPct: 2,  ratePct: 0 },

  // Authoritative female
  annie:      { voice: 'en-US-NancyNeural',     pitchPct: -2, ratePct: -3 },
  dunford:    { voice: 'en-US-NancyNeural',     pitchPct: 0,  ratePct: -2 },
}

const DEFAULT_PROFILE: ToneProfile = { voice: 'en-US-AndrewNeural', pitchPct: 0, ratePct: 0 }
const ANNOUNCER: ToneProfile = { voice: 'en-US-GuyNeural', pitchPct: 0, ratePct: 5 }

// ─── Announcer + stage lines ─────────────────────────────────────────────
const ANNOUNCER_LINES: Record<string, string> = {
  fight: 'Fight!',
  ko: 'K. O.',
  combo: 'Combo!',
  crit: 'Critical!',
  ultimate: 'Ultimate!',
  perfect: 'Perfect!',
  timeup: 'Time up!',
  round1: 'Round one!',
  round2: 'Round two!',
  round3: 'Final round!',
  reading: 'They read you!',
}

// ─── SSML builder ────────────────────────────────────────────────────────
function buildSSML(profile: ToneProfile, text: string): string {
  // Escape XML special chars in body
  const safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  const pitch = profile.pitchPct >= 0 ? `+${profile.pitchPct}%` : `${profile.pitchPct}%`
  const rate  = profile.ratePct  >= 0 ? `+${profile.ratePct}%`  : `${profile.ratePct}%`
  const styleOpen  = profile.style ? `<mstts:express-as style="${profile.style}">` : ''
  const styleClose = profile.style ? `</mstts:express-as>` : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"
       xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
  <voice name="${profile.voice}">
    ${styleOpen}
    <prosody pitch="${pitch}" rate="${rate}">${safe}</prosody>
    ${styleClose}
  </voice>
</speak>`
}

// ─── REST call ────────────────────────────────────────────────────────────
async function synthesizeOnce(
  ssml: string,
  key: string,
  region: string,
): Promise<Buffer> {
  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'operators-voicegen',
      },
      body: ssml,
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Azure ${res.status}: ${text.slice(0, 300)}`)
    }
    return Buffer.from(await res.arrayBuffer())
  } finally {
    clearTimeout(timeout)
  }
}

async function synthesize(profile: ToneProfile, text: string, key: string, region: string): Promise<Buffer> {
  const maxAttempts = 6
  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await synthesizeOnce(buildSSML(profile, text), key, region)
    } catch (e) {
      lastErr = e as Error
      const msg = lastErr.message
      const retryable =
        msg.includes('429') || msg.includes('500') || msg.includes('502') ||
        msg.includes('503') || msg.includes('504') || msg.includes('fetch failed') ||
        msg.includes('aborted')
      if (!retryable || attempt === maxAttempts) throw lastErr
      const wait = Math.min(20_000, Math.pow(2, attempt) * 1000) + Math.random() * 1000
      console.log(`    ↻ retry ${attempt}/${maxAttempts - 1} after ${(wait / 1000).toFixed(1)}s — ${msg.slice(0, 60)}`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw lastErr ?? new Error('synthesis failed')
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const force = process.argv.includes('--force')
  const announcerOnly = process.argv.includes('--announcer')

  const { key, region } = loadAzureConfig()
  if (!key) {
    console.error('Missing AZURE_SPEECH_KEY (or ~/.gstack/azure-speech.json).')
    process.exit(1)
  }
  console.log(`Azure Speech: region=${region}\n`)

  fs.mkdirSync(OUT_DIR, { recursive: true })

  let made = 0, skipped = 0, failed = 0

  // Announcer
  const annDir = path.join(OUT_DIR, 'announcer')
  fs.mkdirSync(annDir, { recursive: true })
  for (const [key2, text] of Object.entries(ANNOUNCER_LINES)) {
    const out = path.join(annDir, `${key2}.mp3`)
    if (fs.existsSync(out) && !force) { skipped++; continue }
    console.log(`  → announcer/${key2}.mp3 …`)
    try {
      const buf = await synthesize(ANNOUNCER, text, key, region)
      fs.writeFileSync(out, buf)
      console.log(`    ✓ wrote (${(buf.byteLength / 1024).toFixed(1)}KB)`)
      made++
    } catch (e) {
      console.warn(`    ✗ ${(e as Error).message.slice(0, 100)}`)
      failed++
    }
    await new Promise((r) => setTimeout(r, 400))
  }

  // Stages
  const stagesDir = path.join(OUT_DIR, 'stages')
  fs.mkdirSync(stagesDir, { recursive: true })
  for (const [id, s] of Object.entries(SCENARIOS)) {
    const out = path.join(stagesDir, `${id}.mp3`)
    if (fs.existsSync(out) && !force) { skipped++; continue }
    console.log(`  → stages/${id}.mp3 …`)
    try {
      const buf = await synthesize(ANNOUNCER, s.name, key, region)
      fs.writeFileSync(out, buf)
      console.log(`    ✓ wrote (${(buf.byteLength / 1024).toFixed(1)}KB)`)
      made++
    } catch (e) {
      console.warn(`    ✗ ${(e as Error).message.slice(0, 100)}`)
      failed++
    }
    await new Promise((r) => setTimeout(r, 400))
  }

  if (announcerOnly) {
    console.log(`\nDone (announcer/stages only). made=${made} skipped=${skipped} failed=${failed}`)
    return
  }

  // Fighters
  const targets = args.length > 0 ? FIGHTERS.filter((f) => args.includes(f.id)) : FIGHTERS
  for (const fighter of targets) {
    const profile = PROFILES[fighter.id] ?? DEFAULT_PROFILE
    const dir = path.join(OUT_DIR, fighter.id)
    fs.mkdirSync(dir, { recursive: true })

    const lines: Array<[string, string]> = [
      ['matchStart', fighter.voiceLines.matchStart],
      ['win',        fighter.voiceLines.win],
      ['lose',       fighter.voiceLines.lose],
      ['ko',         fighter.voiceLines.ko],
      ['crit',       fighter.voiceLines.crit],
      ['ult',        fighter.voiceLines.ult],
      ...fighter.voiceLines.trash.map((t, i): [string, string] => [`trash${i + 1}`, t]),
    ]

    for (const [keyName, text] of lines) {
      const out = path.join(dir, `${keyName}.mp3`)
      if (fs.existsSync(out) && !force) { skipped++; continue }
      console.log(`  → ${fighter.id}/${keyName}.mp3 (${profile.voice}) …`)
      try {
        const buf = await synthesize(profile, text, key, region)
        fs.writeFileSync(out, buf)
        console.log(`    ✓ wrote (${(buf.byteLength / 1024).toFixed(1)}KB)`)
        made++
      } catch (e) {
        console.warn(`    ✗ ${(e as Error).message.slice(0, 100)}`)
        failed++
      }
      // Polite rate limit
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  console.log(`\nDone. made=${made} skipped=${skipped} failed=${failed}`)
  if (made > 0) {
    console.log('\nAudio files are auto-played by src/lib/voice.ts when present.')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
