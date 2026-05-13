/**
 * Extract a pool of short verbatim quotes from each fighter's podcast transcripts.
 * No LLM needed — pure regex over the markdown transcripts.
 *
 * Reads: dataset/03-podcasts/*.md
 * Writes: src/data/quote-pool.json
 */

import fs from 'node:fs'
import path from 'node:path'

const DATASET_DIR = path.resolve(process.cwd(), 'dataset/03-podcasts')

const FIGHTER_TRANSCRIPTS: Record<string, string[]> = {
  chesky: ['brian-chesky'],
  doshi: ['shreyas-doshi'],
  catwu: ['cat-wu'],
  madhavan: ['madhavan-ramanujam'],
  spiegel: ['evan-spiegel'],
  turley: ['nick-turley'],
  cagan: ['marty-cagan'],
  lenny: [], // host — extract from every episode
}

interface SpeakerTurn {
  speaker: string
  timestamp: string
  text: string
}

function parseTranscript(content: string, guestNameLower: string): SpeakerTurn[] {
  // Pattern: **Name** (HH:MM:SS):\n<text up to next **>
  const pattern = /\*\*([^*]+?)\*\*\s*\(([\d:]+)\):\s*\n([\s\S]*?)(?=\n\*\*[^*]+?\*\*\s*\(|\Z|$)/g
  const turns: SpeakerTurn[] = []
  let m
  while ((m = pattern.exec(content)) !== null) {
    const speakerName = m[1].trim().toLowerCase()
    if (!speakerName.includes(guestNameLower) && !guestNameLower.split('-').every((p) => speakerName.includes(p))) continue
    turns.push({
      speaker: m[1].trim(),
      timestamp: m[2],
      text: m[3].trim(),
    })
  }
  return turns
}

function extractShortQuotes(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 50 && s.length <= 140)
    // Complete sentence: starts with cap, ends with punctuation, not a quote-fragment
    .filter((s) => /^[A-Z]/.test(s))
    .filter((s) => /[.!?]$/.test(s))
    .filter((s) => !/^["'`]/.test(s))
    .filter((s) => !s.includes('"'))
    .filter((s) => !s.includes("'"))
    // Skip conversational filler openers
    .filter((s) => !/^(So|And|But|Yeah|Right|I mean|Like|You know|That's|It's|Well|Yes|No|Now|Oh|Hmm|Okay|OK|Maybe|Or|Then|Actually|Basically|Honestly|Frankly|Anyway|Anyways|Yeah,|Right,)\b/i.test(s.split(' ').slice(0, 2).join(' ').replace(/[.!?]$/, '')))
    // Skip filler words
    .filter((s) => !/\b(uh|um|y'know|gonna|wanna|sort of|kind of)\b/i.test(s))
    // Must contain at least one substantive word (verb or noun)
    .filter((s) => s.split(' ').length >= 8)
    .filter((s) => s.split(' ').length <= 24)
    // No incomplete questions / cut-offs
    .filter((s) => !s.endsWith('...'))
    .filter((s) => !s.includes('--'))
    // No backticks or markdown
    .filter((s) => !s.includes('`'))
    .filter((s) => !s.includes('*'))
    // No question-as-answer artifacts
    .filter((s) => !/\bso what's up\b/i.test(s))
  return sentences
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

async function main() {
  const files = fs.readdirSync(DATASET_DIR)
  const out: Record<string, Array<{ quote: string; timestamp: string }>> = {}

  for (const [fighterId, slugs] of Object.entries(FIGHTER_TRANSCRIPTS)) {
    const quotes: Array<{ quote: string; timestamp: string }> = []

    if (fighterId === 'lenny') {
      // Lenny: extract HIS turns from every episode he hosts (he's Lenny Rachitsky)
      const sampled = shuffle(files).slice(0, 30)
      for (const f of sampled) {
        const content = fs.readFileSync(path.join(DATASET_DIR, f), 'utf-8')
        const turns = parseTranscript(content, 'lenny')
        for (const t of turns) {
          for (const q of extractShortQuotes(t.text)) {
            quotes.push({ quote: q, timestamp: t.timestamp })
          }
        }
      }
    } else {
      const matches = files.filter((f) => slugs.some((s) => f.toLowerCase().includes(s)))
      for (const f of matches) {
        const content = fs.readFileSync(path.join(DATASET_DIR, f), 'utf-8')
        const turns = parseTranscript(content, slugs[0].split('-').pop()!)
        for (const t of turns) {
          for (const q of extractShortQuotes(t.text)) {
            quotes.push({ quote: q, timestamp: t.timestamp })
          }
        }
      }
    }

    // Dedupe + shuffle + take top 20
    const seen = new Set<string>()
    const unique = quotes.filter((q) => {
      const key = q.quote.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    out[fighterId] = shuffle(unique).slice(0, 20)
    console.log(`${fighterId}: ${out[fighterId].length} quotes (of ${quotes.length} total)`)
  }

  const outPath = path.resolve(process.cwd(), 'src/data/quote-pool.json')
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
  console.log(`\nWrote ${outPath}`)
}

main().catch(console.error)
