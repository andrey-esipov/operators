/**
 * Generate self-contained voice line audio via Azure OpenAI gpt-4o-mini-tts.
 *
 * gpt-4o-mini-tts supports per-call "instructions" that describe voice
 * delivery in prose — way more expressive than picking a named voice +
 * SSML pitch. We map each fighter to a (base voice + instructions) pair
 * to give them distinct character without specifying accents.
 *
 * Reads config from ~/.gstack/openai.json (reuses the existing astack
 * backend config) OR env vars:
 *   AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
 *   AZURE_OPENAI_API_KEY=...
 *   AZURE_OPENAI_TTS_DEPLOYMENT=gpt-4o-mini-tts
 *   AZURE_OPENAI_API_VERSION=2025-04-01-preview
 *
 * Output: public/audio/voices/<fighterId>/<lineKey>.mp3
 *         public/audio/voices/announcer/<key>.mp3
 *         public/audio/voices/stages/<scenarioId>.mp3
 *
 * Usage:
 *   npx tsx scripts/generate-voice-azure.ts              # everything missing
 *   npx tsx scripts/generate-voice-azure.ts --force      # re-render all
 *   npx tsx scripts/generate-voice-azure.ts chesky lenny # specific fighters
 *   npx tsx scripts/generate-voice-azure.ts --announcer  # announcer + stages only
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { FIGHTERS } from '../src/data/fighters'
import { SCENARIOS } from '../src/data/scenarios'

// ─── Config ──────────────────────────────────────────────────────────────
//
// TTS may live on a DIFFERENT Azure resource than image gen. The config
// supports both shared-resource (use the base `endpoint` / `api_key`)
// and split-resource (`tts_endpoint` / `tts_api_key`) modes. When the
// dedicated TTS fields are present they win.
//
function loadAzureConfig() {
  const gstackPath = path.join(os.homedir(), '.gstack', 'openai.json')
  type AzureFile = {
    endpoint?: string
    api_key?: string
    api_version?: string
    tts_endpoint?: string
    tts_api_key?: string
    tts_api_version?: string
    tts_deployment?: string
  }
  let file: { azure?: AzureFile } = {}
  try {
    if (fs.existsSync(gstackPath)) file = JSON.parse(fs.readFileSync(gstackPath, 'utf-8'))
  } catch {
    // ignore
  }
  const azureFile = file?.azure || {}

  // TTS resource: prefer dedicated fields, fall back to shared base.
  const endpoint = (
    process.env.AZURE_OPENAI_TTS_ENDPOINT ||
    azureFile.tts_endpoint ||
    process.env.AZURE_OPENAI_ENDPOINT ||
    azureFile.endpoint ||
    ''
  ).replace(/\/$/, '')

  const apiKey =
    process.env.AZURE_OPENAI_TTS_API_KEY ||
    azureFile.tts_api_key ||
    process.env.AZURE_OPENAI_API_KEY ||
    azureFile.api_key ||
    ''

  const deployment =
    process.env.AZURE_OPENAI_TTS_DEPLOYMENT ||
    azureFile.tts_deployment ||
    'gpt-4o-mini-tts'

  const apiVersion =
    process.env.AZURE_OPENAI_TTS_API_VERSION ||
    azureFile.tts_api_version ||
    process.env.AZURE_OPENAI_API_VERSION ||
    azureFile.api_version ||
    '2025-04-01-preview'

  return { endpoint, apiKey, deployment, apiVersion }
}

const OUT_DIR = path.resolve(process.cwd(), 'public/audio/voices')

// ─── Voice profiles (gravitas / tone via prose instructions) ─────────────
//
// gpt-4o-mini-tts has 8 base voices: alloy, ash, ballad, coral, echo,
// fable, onyx, nova, sage, shimmer. We pick the base that suits the
// fighter's energy, then steer further with the `instructions` field.
//
interface ToneProfile {
  voice: string
  instructions: string
}

const PROFILES: Record<string, ToneProfile> = {
  // ─── Boss ────────────────────────────────────────────────────────
  lenny: {
    voice: 'onyx',
    instructions: 'Slow, deep, theatrical podcast host with measured gravitas. Pauses between thoughts. A knowing smile in the voice. This is the boss, and he wants you to know it.',
  },

  // ─── Mature gravitas ─────────────────────────────────────────────
  andreessen: {
    voice: 'onyx',
    instructions: 'Confident, contrarian, slightly amused. Speaks like he is the smartest person in the room and knows it. Slower pace than average, with deliberate emphasis.',
  },
  seth: {
    voice: 'sage',
    instructions: 'Warm marketing icon with bookish confidence. Speaks slowly, deliberately, like he is sharing wisdom you should write down.',
  },

  // ─── Warm conversational ─────────────────────────────────────────
  cagan: {
    voice: 'sage',
    instructions: 'Veteran product mentor. Calm, generous, methodical. Speaks like someone who has seen it all and chosen patience over fire.',
  },
  jason: {
    voice: 'ash',
    instructions: 'Calm contrarian, dry humor. Slower than average. Sounds like he is leaning back in a chair, refusing to be rushed.',
  },

  // ─── Confident young male / charismatic founder ──────────────────
  chesky: {
    voice: 'echo',
    instructions: 'Confident young tech founder. Energetic but composed. Sounds like he believes every word he says, deeply.',
  },
  altman: {
    voice: 'echo',
    instructions: 'Calm, measured, slightly soft-spoken. Carries weight without raising volume.',
  },
  krieger: {
    voice: 'echo',
    instructions: 'Warm, friendly, slightly soft. Speaks like a thoughtful builder who never rushes to conclusions.',
  },
  tobi: {
    voice: 'echo',
    instructions: 'Programmer-CEO energy: confident, direct, slight grin in the delivery. Slightly faster than average.',
  },
  stewart: {
    voice: 'ash',
    instructions: 'Witty product polymath. Slightly bemused, generous, never aggressive. Like he is delighting in his own observations.',
  },
  taylor: {
    voice: 'ash',
    instructions: 'Polymath operator. Even, measured, signals intelligence through restraint rather than volume.',
  },

  // ─── Energetic / fast / glass cannons ────────────────────────────
  turley: {
    voice: 'echo',
    instructions: 'Young, fast, slightly breathless. Sounds like he just shipped a feature and is already onto the next one.',
  },
  lazar: {
    voice: 'echo',
    instructions: 'Vibe-coder energy. Excited, slightly chaotic, fast pace. Like he is mid-sprint and loving it.',
  },
  nikita: {
    voice: 'echo',
    instructions: 'Consumer-app savant. Energetic, slightly cocky, sells every line like a viral tweet.',
  },
  boris: {
    voice: 'echo',
    instructions: 'Young AI engineer, fast and confident, delivers each line like he is showing you a demo that just shipped.',
  },
  drew: {
    voice: 'echo',
    instructions: 'Engineer-CEO. Clear, direct, slightly grounded. Believes in his product without needing to prove it.',
  },
  dylan: {
    voice: 'echo',
    instructions: 'Designer-founder. Warm, slightly enthusiastic, friendly. Sounds like he genuinely cares about the craft.',
  },
  amjad: {
    voice: 'echo',
    instructions: 'Builder-CEO. Calm but conviction-laden. Delivers each line like he is laying down a manifesto.',
  },

  // ─── Measured professional ───────────────────────────────────────
  doshi: {
    voice: 'ash',
    instructions: 'Strategy thinker. Slower than average, precise, slightly didactic. Each phrase delivered like a forcing function.',
  },
  simon: {
    voice: 'ash',
    instructions: 'Open-source AI hacker. Curious, slightly amused, thoughtful pauses. Like he is mid-blog-post.',
  },
  madhavan: {
    voice: 'ash',
    instructions: 'Pricing strategist. Measured, professional, slight emphasis on numbers and frameworks.',
  },
  gokul: {
    voice: 'ash',
    instructions: 'Operating veteran. Steady, slightly weary in a good way — the calm of someone who has built and rebuilt many orgs.',
  },
  spiegel: {
    voice: 'ash',
    instructions: 'Distribution-obsessed founder. Slow, deliberate, slightly cold. Believes in long-term moats over short-term wins.',
  },

  // ─── Warm female ─────────────────────────────────────────────────
  catwu: {
    voice: 'nova',
    instructions: 'Young AI product builder. Bright, friendly, slightly fast. Speaks like she ships every week.',
  },
  julie: {
    voice: 'nova',
    instructions: 'Thoughtful design VP. Warm, considered, occasionally pauses to choose the right word.',
  },

  // ─── Authoritative female ────────────────────────────────────────
  annie: {
    voice: 'shimmer',
    instructions: 'World-class poker player turned cognitive scientist. Sharp, slightly clipped, dispassionate about luck and outcome. Sounds like someone who has already considered three counter-arguments to whatever you might say.',
  },
  dunford: {
    voice: 'shimmer',
    instructions: 'Positioning consultant. Direct, professional, slight smile in the delivery. Like someone who refuses to let your strategy stay muddy.',
  },

  // ─── Wave 3 — May 2026 final cut ──────────────────────────────────
  benioff: {
    voice: 'onyx',
    instructions: 'Salesforce CEO. Warm but commanding. Hawaiian-shirt-meets-boardroom energy. Delivers every line like a keynote — confident, generous, slightly evangelical about cloud and AI.',
  },
  horowitz: {
    voice: 'onyx',
    instructions: 'Wartime CEO. Direct, weathered, slightly weary in a way that signals experience. Slower than average. Each phrase delivered like advice you should write down.',
  },
  feifei: {
    voice: 'nova',
    instructions: 'Stanford AI researcher. Calm, articulate, slight scholarly cadence with warmth. Pauses thoughtfully. Each phrase carries the weight of a career spent building computer vision.',
  },
  dharmesh: {
    voice: 'echo',
    instructions: 'HubSpot CTO and builder. Friendly, thoughtful, slightly playful. Talks about marketing and AI like a tinkerer who genuinely loves the craft.',
  },
  melanie: {
    voice: 'nova',
    instructions: 'Canva CEO. Bright, optimistic, deeply purposeful. Sounds like someone who genuinely believes in empowering the world to design. Australian-friendly without forced accent.',
  },
  ries: {
    voice: 'ash',
    instructions: 'Lean Startup author. Methodical, precise, slightly didactic. Each phrase structured like a hypothesis statement. Patient and a little nerdy in the best way.',
  },
  boz: {
    voice: 'onyx',
    instructions: 'Meta CTO. Direct, confident, slightly clipped. Sounds like someone running thousands of engineers on decade-long bets. No-nonsense.',
  },
  tavel: {
    voice: 'shimmer',
    instructions: 'Benchmark partner. Sharp, considered, slightly skeptical in the best way. Speaks like someone who has heard 10,000 pitches and seen every pattern.',
  },
  rahul: {
    voice: 'echo',
    instructions: 'Superhuman CEO. Precise, intelligent, slightly enthusiastic about craft. Delivers each line like he is showing you a perfectly designed keystroke.',
  },
  aparna: {
    voice: 'nova',
    instructions: 'Microsoft CPO. Warm, polished, deeply experienced. Speaks like a senior consumer-product executive who has shipped at planet-scale and stayed kind about it.',
  },
  maples: {
    voice: 'sage',
    instructions: 'Floodgate co-founder. Patient, thoughtful, slightly contrarian. Talks about inflections and pattern-breakers like someone who has spent twenty years studying them.',
  },
  jessica: {
    voice: 'shimmer',
    instructions: 'YC co-founder. Warm, friendly, generous with founders. Each phrase delivered with the patience of someone who has read 10,000 startup pitches and seen them all start the same way.',
  },
  elena: {
    voice: 'nova',
    instructions: 'Growth executive. Sharp, fast-paced, slightly cocky in a likable way. Speaks like someone running PLG at 100x scale, dropping framework names with confidence.',
  },
}

const DEFAULT_PROFILE: ToneProfile = {
  voice: 'echo',
  instructions: 'Confident operator. Even, professional pacing.',
}

// Announcer — the booming SF II-style game-shouter
const ANNOUNCER: ToneProfile = {
  voice: 'onyx',
  instructions: 'BOOMING fight-game announcer. Theatrical, loud, dramatic, extremely punchy delivery. Hold the final syllable. Energy of a 90s arcade.',
}

// Stage names — slightly less theatrical, more presenter-like
const STAGE_ANNOUNCER: ToneProfile = {
  voice: 'onyx',
  instructions: 'Game announcer presenting the stage. Cinematic, slightly slower than the fight shouts, with weight on the stage name.',
}

// ─── Announcer + stage lines ─────────────────────────────────────────────
const ANNOUNCER_LINES: Record<string, string> = {
  fight: 'Fight!',
  ko: 'K. O.!',
  combo: 'Combo!',
  crit: 'Critical hit!',
  ultimate: 'Ultimate!',
  perfect: 'Perfect!',
  timeup: 'Time up!',
  round1: 'Round one!',
  round2: 'Round two!',
  round3: 'Final round!',
  reading: 'They read you!',
}

// ─── REST call to Azure OpenAI gpt-4o-mini-tts ───────────────────────────
async function synthesizeOnce(
  profile: ToneProfile,
  text: string,
  cfg: ReturnType<typeof loadAzureConfig>,
): Promise<Buffer> {
  const url = `${cfg.endpoint}/openai/deployments/${cfg.deployment}/audio/speech?api-version=${cfg.apiVersion}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'api-key': cfg.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.deployment,
        input: text,
        voice: profile.voice,
        instructions: profile.instructions,
        response_format: 'mp3',
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Azure ${res.status}: ${errText.slice(0, 300)}`)
    }
    return Buffer.from(await res.arrayBuffer())
  } finally {
    clearTimeout(timeout)
  }
}

async function synthesize(
  profile: ToneProfile,
  text: string,
  cfg: ReturnType<typeof loadAzureConfig>,
): Promise<Buffer> {
  const maxAttempts = 6
  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await synthesizeOnce(profile, text, cfg)
    } catch (e) {
      lastErr = e as Error
      const msg = lastErr.message
      const retryable =
        msg.includes('429') || msg.includes('500') || msg.includes('502') ||
        msg.includes('503') || msg.includes('504') || msg.includes('fetch failed') ||
        msg.includes('aborted') || msg.includes('EngineOverloaded')
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

  const cfg = loadAzureConfig()
  if (!cfg.endpoint || !cfg.apiKey) {
    console.error('Missing Azure OpenAI config. Set AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_API_KEY (or ~/.gstack/openai.json).')
    process.exit(1)
  }
  console.log(`Azure OpenAI endpoint: ${cfg.endpoint}`)
  console.log(`TTS deployment: ${cfg.deployment}\n`)

  fs.mkdirSync(OUT_DIR, { recursive: true })

  let made = 0, skipped = 0, failed = 0

  // Announcer
  const annDir = path.join(OUT_DIR, 'announcer')
  fs.mkdirSync(annDir, { recursive: true })
  for (const [key, text] of Object.entries(ANNOUNCER_LINES)) {
    const out = path.join(annDir, `${key}.mp3`)
    if (fs.existsSync(out) && !force) { skipped++; continue }
    console.log(`  → announcer/${key}.mp3 …`)
    try {
      const buf = await synthesize(ANNOUNCER, text, cfg)
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
      const buf = await synthesize(STAGE_ANNOUNCER, s.name, cfg)
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
      console.log(`  → ${fighter.id}/${keyName}.mp3 (voice=${profile.voice}) …`)
      try {
        const buf = await synthesize(profile, text, cfg)
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
    console.log('\nAudio files are auto-played by src/lib/voice.ts (fighter lines)')
    console.log('and src/lib/announcer.ts (game shouts) when present.')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
