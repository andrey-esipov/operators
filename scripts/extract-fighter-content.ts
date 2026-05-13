/**
 * Extract per-fighter content (moves, quotes, voice lines) from podcast transcripts.
 *
 * Usage:
 *   npx tsx scripts/extract-fighter-content.ts                # all fighters
 *   npx tsx scripts/extract-fighter-content.ts chesky doshi   # specific ones
 *
 * Reads from ./dataset/03-podcasts/*.md
 * Writes to  ./data/fighters/<id>.json
 *
 * The output JSON is an enrichment overlay over src/data/fighters.ts.
 * The game can prefer overlay values when available.
 */

import 'dotenv/config'
import Anthropic from '@anthropic-ai/sdk'
import fs from 'node:fs'
import path from 'node:path'

const DATASET_DIR = path.resolve(process.cwd(), 'dataset/03-podcasts')
const OUTPUT_DIR = path.resolve(process.cwd(), 'data/fighters')

/** Mapping fighter id -> guest match substrings (used for filename match) */
const FIGHTER_MAP: Record<string, { name: string; transcripts: string[] }> = {
  chesky: { name: 'Brian Chesky', transcripts: ['brian-chesky', 'chesky'] },
  doshi: { name: 'Shreyas Doshi', transcripts: ['shreyas-doshi', 'doshi'] },
  catwu: { name: 'Cat Wu', transcripts: ['cat-wu'] },
  madhavan: { name: 'Madhavan Ramanujam', transcripts: ['madhavan'] },
  spiegel: { name: 'Evan Spiegel', transcripts: ['evan-spiegel', 'spiegel'] },
  turley: { name: 'Nick Turley', transcripts: ['nick-turley', 'turley'] },
  cagan: { name: 'Marty Cagan', transcripts: ['marty-cagan', 'cagan'] },
  lenny: { name: 'Lenny Rachitsky', transcripts: [] }, // host - pulled from all
}

const SYSTEM_PROMPT = `You are extracting fighter content for a 16-bit pixel-art tactical fighting game called OPERATORS.

Each fighter is a real guest from Lenny's Podcast. You will receive their podcast transcripts and you must extract:
- 5 signature MOVES (light, heavy, setup, combo, ultimate)
- Voice lines (match start, win, lose, KO, crit, ult, 3 trash talks)
- Scenario bonuses (when their philosophy applies most)

CRITICAL RULES:
1. Every quote MUST be VERBATIM from the transcript. Never paraphrase.
2. Every quote MUST include episode + timestamp from the transcript (format: "**Speaker** (HH:MM:SS):").
3. Move NAMES should be the operator's actual frameworks (e.g. "FOUNDER MODE", "LNO FRAMEWORK", "CRITICAL FEW").
4. Combo finisher must "combo from" the setup move (specify slot 3 → slot 4 chain).
5. Ultimate must be the operator's most iconic moment.

Return STRICT JSON only. No prose.`

const TASK_PROMPT_TEMPLATE = `Fighter: {NAME}

Transcripts (concatenated):
"""
{CORPUS}
"""

Return JSON with this exact shape:
{
  "moves": [
    { "slot": "light",    "name": "...", "quote": "...", "episode": "...", "timestamp": "...", "framework_summary": "..." },
    { "slot": "heavy",    "name": "...", "quote": "...", "episode": "...", "timestamp": "...", "framework_summary": "..." },
    { "slot": "setup",    "name": "...", "quote": "...", "episode": "...", "timestamp": "...", "framework_summary": "..." },
    { "slot": "combo",    "name": "...", "quote": "...", "episode": "...", "timestamp": "...", "framework_summary": "...", "combos_from": "setup" }
  ],
  "ultimate": {
    "name": "...", "quote": "...", "episode": "...", "timestamp": "...", "iconic_moment": "..."
  },
  "voice_lines": {
    "match_start": "verbatim quote from transcript that fits a fighting game match-start line",
    "win": "verbatim",
    "lose": "verbatim",
    "ko": "verbatim",
    "crit": "verbatim",
    "ult": "verbatim — should match the ult moment quote",
    "trash": ["verbatim 1", "verbatim 2", "verbatim 3"]
  },
  "scenario_bonus_tags": ["pre-pmf" | "hypergrowth" | "plateau" | "ai-native" | "monetization" | "crisis" | "ipo-prep" | "distribution"]
}

If you cannot find a verbatim quote for a slot, set the field to null. Never invent.`

async function main() {
  const args = process.argv.slice(2)
  const targets = args.length > 0 ? args : Object.keys(FIGHTER_MAP)
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Set ANTHROPIC_API_KEY in your .env')
    process.exit(1)
  }
  if (!fs.existsSync(DATASET_DIR)) {
    console.error(`Dataset not found at ${DATASET_DIR}.`)
    process.exit(1)
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const anthropic = new Anthropic()
  const files = fs.readdirSync(DATASET_DIR)

  for (const fighterId of targets) {
    const map = FIGHTER_MAP[fighterId]
    if (!map) {
      console.warn(`Unknown fighter id: ${fighterId}`)
      continue
    }
    const matches = files.filter((f) =>
      fighterId === 'lenny'
        ? false // for Lenny, do something different (cross-episode)
        : map.transcripts.some((t) => f.toLowerCase().includes(t))
    )

    if (fighterId === 'lenny') {
      // For Lenny, sample 5 random episodes — pull his question patterns
      const sample = files.sort(() => 0.5 - Math.random()).slice(0, 5)
      matches.push(...sample)
    }

    if (matches.length === 0) {
      console.warn(`No transcripts found for ${fighterId} (${map.name})`)
      continue
    }

    console.log(`\n→ ${fighterId} (${map.name}) · ${matches.length} transcripts`)
    let corpus = ''
    for (const f of matches) {
      corpus += fs.readFileSync(path.join(DATASET_DIR, f), 'utf-8') + '\n\n'
    }
    // Cap corpus at ~120k chars (~30k tokens) to stay under context limits
    const capped = corpus.length > 120_000 ? corpus.slice(0, 120_000) : corpus

    const prompt = TASK_PROMPT_TEMPLATE.replace('{NAME}', map.name).replace('{CORPUS}', capped)

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { text: string }).text)
      .join('\n')

    // Extract JSON block (Claude sometimes wraps in ```)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    const raw = jsonMatch ? jsonMatch[0] : text
    try {
      const parsed = JSON.parse(raw)
      const out = path.join(OUTPUT_DIR, `${fighterId}.json`)
      fs.writeFileSync(out, JSON.stringify(parsed, null, 2))
      console.log(`  ✓ wrote ${out}`)
    } catch (e) {
      const out = path.join(OUTPUT_DIR, `${fighterId}.raw.txt`)
      fs.writeFileSync(out, text)
      console.warn(`  ⚠ failed to parse JSON — raw saved to ${out}`)
    }
  }
  console.log('\nDone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
