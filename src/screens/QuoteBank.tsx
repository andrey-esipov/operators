import { useMemo, useState } from 'react'
import { useGame } from '../state/game'
import { FIGHTERS, getFighter } from '../data/fighters'
import { Sfx } from '../lib/audio'
import { THEMES, classifyQuote, type ThemeId } from '../lib/quoteThemes'
import { youtubeDeepLink } from '../lib/youtube'

interface Entry {
  fighterId: string
  moveId: string
  ts: number
  name: string
  shortName: string
  accent: string
  episode: string
  moveName: string
  quote: string
  timestamp: string
  type: string
  themes: ThemeId[]
}

export function QuoteBank() {
  const quoteBank = useGame((s) => s.quoteBank)
  const setPhase = useGame((s) => s.setPhase)
  const [fighterFilter, setFighterFilter] = useState<string>('all')
  const [themeFilter, setThemeFilter] = useState<ThemeId | 'all'>('all')
  const [query, setQuery] = useState('')

  // Resolve quoteBank into rich entries. De-dupe by (fighter, move).
  const allEntries: Entry[] = useMemo(() => {
    const resolved: Entry[] = []
    const seen = new Set<string>()
    for (const e of quoteBank) {
      const key = `${e.fighterId}:${e.moveId}`
      if (seen.has(key)) continue
      seen.add(key)
      const f = getFighter(e.fighterId)
      if (!f) continue
      const move = [...f.moves, f.ult].find((m) => m.id === e.moveId)
      if (!move) continue
      resolved.push({
        fighterId: e.fighterId,
        moveId: e.moveId,
        ts: e.ts,
        name: f.name,
        shortName: f.shortName,
        accent: f.accent,
        episode: move.episode,
        moveName: move.name,
        quote: move.quote,
        timestamp: move.timestamp,
        type: move.type,
        themes: classifyQuote(move.quote + ' ' + move.name),
      })
    }
    return resolved
  }, [quoteBank])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allEntries.filter((e) => {
      if (fighterFilter !== 'all' && e.fighterId !== fighterFilter) return false
      if (themeFilter !== 'all' && !e.themes.includes(themeFilter)) return false
      if (q && !e.quote.toLowerCase().includes(q) && !e.moveName.toLowerCase().includes(q) && !e.name.toLowerCase().includes(q)) {
        return false
      }
      return true
    })
  }, [allEntries, fighterFilter, themeFilter, query])

  // Per-theme counts for chip badges
  const themeCounts = useMemo(() => {
    const out: Partial<Record<ThemeId, number>> = {}
    for (const e of allEntries) {
      for (const t of e.themes) out[t] = (out[t] ?? 0) + 1
    }
    return out
  }, [allEntries])

  function copyToClipboard() {
    const text = filtered
      .map((e) => `"${e.quote}"\n— ${e.name}, ${e.episode} (${e.timestamp})`)
      .join('\n\n')
    navigator.clipboard.writeText(text).catch(() => {})
    Sfx.menuSelect()
  }

  function copyMarkdown() {
    const md = filtered
      .map((e) => {
        const link = youtubeDeepLink(e.fighterId, e.timestamp)
        const cite = link
          ? `[${e.name}, ${e.episode} (${e.timestamp})](${link})`
          : `${e.name}, ${e.episode} (${e.timestamp})`
        return `> "${e.quote}"\n> — ${cite}`
      })
      .join('\n\n')
    navigator.clipboard.writeText(md).catch(() => {})
    Sfx.menuSelect()
  }

  const totalCount = allEntries.length

  return (
    <div className="relative w-full h-full overflow-y-auto">
      <div
        className="absolute inset-0 -z-10 fixed pointer-events-none"
        style={{
          background: 'radial-gradient(circle at top, #3B2360 0%, #1A0F2E 60%, #0F0A1A 100%)',
        }}
      />

      <div className="sticky top-0 z-20 px-6 py-4 backdrop-blur-md" style={{ background: 'rgba(15,10,26,0.85)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => {
              Sfx.menuMove()
              setPhase('menu')
            }}
            className="font-display text-[10px] tracking-widest text-white/70"
          >
            ← MAIN MENU
          </button>
          <h1
            className="font-display text-2xl tracking-widest"
            style={{
              color: '#FFD60A',
              textShadow: '4px 4px 0 black',
            }}
          >
            QUOTE BANK
          </h1>
          <div className="flex gap-2">
            <button
              onClick={copyToClipboard}
              className="font-display text-[9px] tracking-widest px-3 py-1.5"
              style={{ border: '1px solid #FFD60A', color: '#FFD60A', cursor: 'pointer' }}
            >
              COPY TXT
            </button>
            <button
              onClick={copyMarkdown}
              className="font-display text-[9px] tracking-widest px-3 py-1.5"
              style={{ border: '1px solid #00B4D8', color: '#00B4D8', cursor: 'pointer' }}
            >
              COPY MD
            </button>
          </div>
        </div>

        {/* Description */}
        <p className="font-body text-lg text-white/70 max-w-3xl">
          {totalCount === 0
            ? 'Play a match — every move unlocks a real quote from Lenny\'s Podcast.'
            : `${totalCount} verbatim quotes unlocked. ${filtered.length} matching filters. Click any quote to open the real podcast at the real timestamp.`}
        </p>

        {/* SEARCH */}
        <div className="mt-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search quotes, frameworks, names…"
            className="w-full px-3 py-2 font-body text-base text-white placeholder:text-white/30"
            style={{
              background: 'rgba(0,0,0,0.4)',
              border: '1px solid rgba(255,255,255,0.2)',
              outline: 'none',
            }}
          />
        </div>

        {/* THEME CHIPS */}
        <div className="flex gap-1.5 flex-wrap mt-3">
          <Chip
            active={themeFilter === 'all'}
            color="#FFD60A"
            onClick={() => setThemeFilter('all')}
          >
            ALL THEMES
          </Chip>
          {THEMES.map((t) => {
            const count = themeCounts[t.id] ?? 0
            if (count === 0 && totalCount > 0) return null
            return (
              <Chip
                key={t.id}
                active={themeFilter === t.id}
                color={t.accent}
                onClick={() => setThemeFilter(t.id)}
              >
                <span>{t.icon}</span> <span>{t.label}</span> {count > 0 && <span className="opacity-60">({count})</span>}
              </Chip>
            )
          })}
        </div>

        {/* FIGHTER CHIPS — only if we have a lot of entries */}
        {totalCount > 0 && (
          <div className="flex gap-1.5 flex-wrap mt-2">
            <Chip
              active={fighterFilter === 'all'}
              color="#FFFFFF"
              onClick={() => setFighterFilter('all')}
            >
              ALL FIGHTERS
            </Chip>
            {FIGHTERS.filter((f) => allEntries.some((e) => e.fighterId === f.id)).map((f) => (
              <Chip
                key={f.id}
                active={fighterFilter === f.id}
                color={f.accent}
                onClick={() => setFighterFilter(f.id)}
              >
                {f.shortName}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {/* QUOTE GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6 pb-16">
        {filtered.length === 0 && totalCount === 0 && (
          <div className="col-span-full text-center font-body text-2xl text-white/40 py-12">
            Play a match. Every move unlocks a quote.
          </div>
        )}
        {filtered.length === 0 && totalCount > 0 && (
          <div className="col-span-full text-center font-body text-xl text-white/40 py-12">
            No quotes match those filters.
          </div>
        )}
        {filtered.map((e) => (
          <QuoteCard key={`${e.fighterId}:${e.moveId}`} entry={e} query={query} />
        ))}
      </div>
    </div>
  )
}

function QuoteCard({ entry: e, query }: { entry: Entry; query: string }) {
  const ytLink = youtubeDeepLink(e.fighterId, e.timestamp)

  return (
    <div
      className="p-4 flex flex-col gap-2 transition-transform hover:translate-y-[-2px]"
      style={{
        background: 'rgba(15,10,26,0.7)',
        border: `2px solid ${e.accent}`,
        boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.5), inset 2px 2px 0 rgba(255,255,255,0.1)',
      }}
    >
      <div className="flex items-baseline justify-between">
        <span className="font-display text-[10px] tracking-widest" style={{ color: e.accent }}>
          {highlight(e.shortName, query)}
        </span>
        <span className="font-display text-[7px] tracking-widest text-white/40">
          {e.type.toUpperCase()}
        </span>
      </div>
      <div className="font-display text-base tracking-wider text-white">{highlight(e.moveName, query)}</div>
      <div className="font-body text-xl italic text-white/90 leading-snug">"{highlight(e.quote, query)}"</div>

      <div className="flex items-center justify-between mt-auto pt-2 border-t border-white/10">
        <div className="font-display text-[8px] tracking-widest text-white/50">
          {e.episode} · {e.timestamp}
        </div>
        {ytLink && (
          <a
            href={ytLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => Sfx.menuSelect()}
            className="font-display text-[8px] tracking-widest px-2 py-0.5"
            style={{
              border: `1px solid ${e.accent}`,
              color: e.accent,
              textDecoration: 'none',
            }}
          >
            ▶ EPISODE
          </a>
        )}
      </div>

      {e.themes.length > 0 && e.themes[0] !== 'misc' && (
        <div className="flex gap-1 flex-wrap">
          {e.themes.slice(0, 3).map((t) => {
            const def = THEMES.find((x) => x.id === t)
            if (!def) return null
            return (
              <span
                key={t}
                className="font-display text-[7px] tracking-widest px-1.5 py-0.5"
                style={{ background: def.accent + '22', color: def.accent, border: `1px solid ${def.accent}55` }}
              >
                {def.icon} {def.label.split(' ')[0]}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Wrap any case-insensitive matches of `query` inside the given string in
 * a yellow <mark> so the user can see why a quote came up. Empty query =
 * pass-through. Splits on the literal match boundary (no regex injection
 * worries — we escape special chars).
 */
function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim()
  if (!q) return text
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(${escaped})`, 'ig')
  const parts = text.split(re)
  return parts.map((part, i) =>
    i % 2 === 1
      ? <mark key={i} style={{ background: '#FFD60A', color: '#0F0A1A', padding: '0 2px' }}>{part}</mark>
      : part
  )
}

function Chip({
  children,
  active,
  color,
  onClick,
}: {
  children: React.ReactNode
  active: boolean
  color?: string
  onClick: () => void
}) {
  const c = color ?? '#FFD60A'
  return (
    <button
      onClick={onClick}
      onMouseEnter={Sfx.menuMove}
      className="px-2.5 py-1 font-display text-[8px] tracking-widest inline-flex items-center gap-1"
      style={{
        background: active ? c : 'transparent',
        color: active ? '#0F0A1A' : c,
        border: `1px solid ${c}`,
        boxShadow: active ? `0 0 8px ${c}` : 'none',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}
