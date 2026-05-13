/**
 * Pre-generate fighter voice lines as compressed audio files using the
 * macOS `say` command. Output: public/audio/voices/<fighterId>/<lineKey>.m4a
 *
 * Why: browser SpeechSynthesis is robotic on most systems unless the user
 * has installed Premium/Enhanced voices. Pre-rendering with macOS premium
 * voices (Samantha/Daniel/Karen/Allison etc.) gives consistent high-quality
 * speech for ALL players, no matter their OS.
 *
 *   npx tsx scripts/generate-voice-lines.ts            # all fighters, all lines
 *   npx tsx scripts/generate-voice-lines.ts chesky     # one fighter
 *   npx tsx scripts/generate-voice-lines.ts --force    # re-render everything
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { FIGHTERS } from '../src/data/fighters'

const OUT_DIR = path.resolve(process.cwd(), 'public/audio/voices')

// Per-fighter macOS voice mapping. Use 'say -v ?' to list available voices.
// "Premium" voices need to be downloaded once via System Settings →
// Accessibility → Spoken Content → System Voice → click a voice.
//
// Preferred fallbacks: if Premium isn't installed, fall back to base voice.
const VOICE_MAP: Record<string, { primary: string; fallback: string; rate?: number }> = {
  chesky:    { primary: 'Daniel (Premium)',    fallback: 'Daniel',    rate: 180 },
  doshi:     { primary: 'Rishi',               fallback: 'Daniel',    rate: 175 },
  catwu:     { primary: 'Samantha (Premium)',  fallback: 'Samantha',  rate: 190 },
  madhavan:  { primary: 'Veena',               fallback: 'Daniel',    rate: 175 },
  spiegel:   { primary: 'Alex',                fallback: 'Daniel',    rate: 170 },
  turley:    { primary: 'Tom (Premium)',       fallback: 'Alex',      rate: 200 },
  cagan:     { primary: 'Daniel (Premium)',    fallback: 'Daniel',    rate: 160 },
  altman:    { primary: 'Alex',                fallback: 'Daniel',    rate: 175 },
  taylor:    { primary: 'Tom (Premium)',       fallback: 'Alex',      rate: 175 },
  lazar:     { primary: 'Aaron (Premium)',     fallback: 'Alex',      rate: 200 },
  amjad:     { primary: 'Alex',                fallback: 'Daniel',    rate: 185 },
  gokul:     { primary: 'Rishi',               fallback: 'Daniel',    rate: 175 },
  dunford:   { primary: 'Karen (Premium)',     fallback: 'Karen',     rate: 175 },
  andreessen:{ primary: 'Daniel (Premium)',    fallback: 'Daniel',    rate: 155 },
  tobi:      { primary: 'Daniel (Premium)',    fallback: 'Daniel',    rate: 180 },
  drew:      { primary: 'Alex',                fallback: 'Daniel',    rate: 180 },
  dylan:     { primary: 'Aaron (Premium)',     fallback: 'Alex',      rate: 185 },
  krieger:   { primary: 'Alex',                fallback: 'Daniel',    rate: 175 },
  stewart:   { primary: 'Daniel (Premium)',    fallback: 'Daniel',    rate: 170 },
  jason:     { primary: 'Alex',                fallback: 'Daniel',    rate: 150 },
  simon:     { primary: 'Daniel (Premium)',    fallback: 'Daniel',    rate: 175 },
  seth:      { primary: 'Tom (Premium)',       fallback: 'Alex',      rate: 165 },
  nikita:    { primary: 'Aaron (Premium)',     fallback: 'Alex',      rate: 210 },
  julie:     { primary: 'Samantha (Premium)',  fallback: 'Samantha',  rate: 180 },
  annie:     { primary: 'Karen (Premium)',     fallback: 'Karen',     rate: 180 },
  boris:     { primary: 'Aaron (Premium)',     fallback: 'Alex',      rate: 195 },
  lenny:     { primary: 'Daniel (Premium)',    fallback: 'Daniel',    rate: 155 },  // Boss = slow + deep
}

/**
 * Available `say` voice names checked once at script-start so we know what
 * to fall back to. Premium voices not yet downloaded won't appear here.
 */
function listInstalledVoices(): Set<string> {
  try {
    const out = execSync('say -v ?').toString()
    const names = new Set<string>()
    for (const line of out.split('\n')) {
      // Lines like:  Samantha (Premium) en_US     # comment
      const m = line.match(/^([^#]+?)\s+[a-z]{2}_[A-Z]{2}/)
      if (m) names.add(m[1].trim())
    }
    return names
  } catch {
    return new Set()
  }
}

function sayToFile(voice: string, rate: number, text: string, outPath: string) {
  // -o output, --file-format=m4af + --data-format=aac → compressed M4A
  // Escape double-quotes inside text
  const safeText = text.replace(/"/g, '\\"')
  const cmd = `say -v "${voice}" -r ${rate} -o "${outPath}" --file-format=m4af --data-format=aac "${safeText}"`
  execSync(cmd)
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const force = process.argv.includes('--force')
  const targets = args.length > 0 ? FIGHTERS.filter((f) => args.includes(f.id)) : FIGHTERS

  fs.mkdirSync(OUT_DIR, { recursive: true })

  const installed = listInstalledVoices()
  console.log(`Detected ${installed.size} system voices.`)

  let made = 0
  let skipped = 0
  let failed = 0

  for (const fighter of targets) {
    const mapping = VOICE_MAP[fighter.id] ?? { primary: 'Alex', fallback: 'Alex', rate: 180 }
    const useVoice = installed.has(mapping.primary) ? mapping.primary : mapping.fallback
    const rate = mapping.rate ?? 180

    const dir = path.join(OUT_DIR, fighter.id)
    fs.mkdirSync(dir, { recursive: true })

    // Voice lines we generate per fighter
    const lines: Array<[string, string]> = [
      ['matchStart', fighter.voiceLines.matchStart],
      ['win',        fighter.voiceLines.win],
      ['lose',       fighter.voiceLines.lose],
      ['ko',         fighter.voiceLines.ko],
      ['crit',       fighter.voiceLines.crit],
      ['ult',        fighter.voiceLines.ult],
      // Numbered trash lines (variable length)
      ...fighter.voiceLines.trash.map((t, i): [string, string] => [`trash${i + 1}`, t]),
    ]

    for (const [key, text] of lines) {
      const outPath = path.join(dir, `${key}.m4a`)
      if (fs.existsSync(outPath) && !force) {
        skipped++
        continue
      }
      try {
        sayToFile(useVoice, rate, text, outPath)
        const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1)
        console.log(`  ✓ ${fighter.id}/${key}.m4a (${sizeKB}KB · ${useVoice})`)
        made++
      } catch (e) {
        console.warn(`  ✗ ${fighter.id}/${key}.m4a — ${(e as Error).message.slice(0, 80)}`)
        failed++
      }
    }
  }

  console.log(`\nDone. made=${made} skipped=${skipped} failed=${failed}`)
  if (made > 0) {
    console.log(`\nTo enable in the game, see src/lib/voice.ts (audio playback will`)
    console.log(`be wired to prefer these files over SpeechSynthesis).`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
