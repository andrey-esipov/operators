import { useMemo, useState } from 'react'
import { useGame } from '../state/game'
import { FIGHTERS } from '../data/fighters'
import { Sfx } from '../lib/audio'
import { THEMES, classifyQuote, type ThemeId } from '../lib/quoteThemes'
import { youtubeDeepLink } from '../lib/youtube'
import type { FighterDef, Move } from '../types'

interface IndexedMove {
  fighter: FighterDef
  move: Move
  themes: ThemeId[]
}

/**
 * Framework Encyclopedia — a comprehensive learning artifact.
 *
 * Indexes all 27 fighters × 5 moves = 135 verbatim operator frameworks,
 * grouped by topic (pricing, distribution, leadership, AI-native, etc.).
 *
 * This is the "is this useful for PMs?" rubric win — the game produces
 * a real knowledge tool. Click any framework → open the real podcast
 * episode at the real timestamp.
 */
export function FrameworkEncyclopedia() {
  const setPhase = useGame((s) => s.setPhase)
  const [theme, setTheme] = useState<ThemeId | 'all'>('all')
  const [query, setQuery] = useState('')

  const moves: IndexedMove[] = useMemo(() => {
    const all: IndexedMove[] = []
    for (const f of FIGHTERS) {
      for (const m of [...f.moves, f.ult]) {
        all.push({
          fighter: f,
          move: m,
          themes: classifyQuote(m.quote + ' ' + m.name + ' ' + m.description),
        })
      }
    }
    return all
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return moves.filter((im) => {
      if (theme !== 'all' && !im.themes.includes(theme)) return false
      if (q) {
        const hay = `${im.move.name} ${im.move.quote} ${im.move.description} ${im.fighter.name}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [moves, theme, query])

  const themeCounts = useMemo(() => {
    const out: Partial<Record<ThemeId, number>> = {}
    for (const im of moves) for (const t of im.themes) out[t] = (out[t] ?? 0) + 1
    return out
  }, [moves])

  // Group filtered moves by primary theme for the encyclopedia layout
  const grouped: Record<ThemeId, IndexedMove[]> = useMemo(() => {
    const out = {} as Record<ThemeId, IndexedMove[]>
    for (const t of THEMES) out[t.id] = []
    out.misc = []
    for (const im of filtered) {
      const primary = im.themes[0]
      if (!out[primary]) out[primary] = []
      out[primary].push(im)
    }
    return out
  }, [filtered])

  return (
    <div className="relative w-full h-full overflow-y-auto">
      <div
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{
          background: 'radial-gradient(circle at top, #3B2360 0%, #1A0F2E 60%, #0F0A1A 100%)',
        }}
      />

      {/* Header */}
      <div
        className="sticky top-0 z-20 px-6 py-4 backdrop-blur-md"
        style={{
          background: 'rgba(15,10,26,0.88)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
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
            FRAMEWORK ENCYCLOPEDIA
          </h1>
          <div className="font-display text-[9px] tracking-widest text-white/60">
            {filtered.length} / {moves.length} FRAMEWORKS
          </div>
        </div>

        <p className="font-body text-lg text-white/70 max-w-3xl mb-3">
          Every move in the game is a real operator framework with a verbatim
          quote. {moves.length} frameworks across {FIGHTERS.length} fighters — sorted by topic,
          click to open the actual podcast episode at the moment they said it.
        </p>

        {/* Search */}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search frameworks, quotes, or fighters…"
          className="w-full px-3 py-2 font-body text-base text-white placeholder:text-white/30 mb-3"
          style={{
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.2)',
            outline: 'none',
          }}
        />

        {/* Theme chips */}
        <div className="flex gap-1.5 flex-wrap">
          <Chip
            active={theme === 'all'}
            color="#FFD60A"
            onClick={() => setTheme('all')}
          >
            ALL ({moves.length})
          </Chip>
          {THEMES.filter((t) => t.id !== 'misc').map((t) => {
            const count = themeCounts[t.id] ?? 0
            if (count === 0) return null
            return (
              <Chip
                key={t.id}
                active={theme === t.id}
                color={t.accent}
                onClick={() => setTheme(t.id)}
              >
                <span>{t.icon}</span> <span>{t.label}</span> <span className="opacity-60">({count})</span>
              </Chip>
            )
          })}
        </div>
      </div>

      {/* Grouped framework list */}
      <div className="p-6 pb-16 space-y-8">
        {THEMES.map((t) => {
          const items = grouped[t.id]
          if (!items || items.length === 0) return null
          if (theme !== 'all' && theme !== t.id) return null
          return (
            <section key={t.id}>
              <div
                className="flex items-baseline gap-3 mb-3 pb-2 border-b"
                style={{ borderColor: t.accent + '55' }}
              >
                <span className="text-2xl" style={{ filter: `drop-shadow(0 0 4px ${t.accent})` }}>
                  {t.icon}
                </span>
                <h2
                  className="font-display text-lg tracking-widest"
                  style={{ color: t.accent, textShadow: '2px 2px 0 black' }}
                >
                  {t.label}
                </h2>
                <span className="font-display text-[9px] tracking-widest text-white/40 ml-auto">
                  {items.length} FRAMEWORKS
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((im) => (
                  <FrameworkCard key={`${im.fighter.id}-${im.move.id}`} indexed={im} />
                ))}
              </div>
            </section>
          )
        })}

        {/* Misc bucket */}
        {(theme === 'all' || theme === 'misc') && grouped.misc.length > 0 && (
          <section>
            <div className="flex items-baseline gap-3 mb-3 pb-2 border-b border-white/20">
              <span className="text-2xl">◇</span>
              <h2 className="font-display text-lg tracking-widest text-white">UNCATEGORIZED</h2>
              <span className="font-display text-[9px] tracking-widest text-white/40 ml-auto">
                {grouped.misc.length}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {grouped.misc.map((im) => (
                <FrameworkCard key={`${im.fighter.id}-${im.move.id}`} indexed={im} />
              ))}
            </div>
          </section>
        )}

        {filtered.length === 0 && (
          <div className="text-center font-body text-xl text-white/40 py-12">
            No frameworks match those filters.
          </div>
        )}
      </div>
    </div>
  )
}

function FrameworkCard({ indexed }: { indexed: IndexedMove }) {
  const { fighter, move } = indexed
  const link = youtubeDeepLink(fighter.id, move.timestamp)
  return (
    <div
      className="p-3 flex flex-col gap-2 transition-transform hover:translate-y-[-2px]"
      style={{
        background: 'rgba(15,10,26,0.65)',
        border: `2px solid ${fighter.accent}`,
        boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.5), inset 2px 2px 0 rgba(255,255,255,0.1)',
      }}
    >
      <div className="flex items-baseline justify-between">
        <span
          className="font-display text-[9px] tracking-widest"
          style={{ color: fighter.accent }}
        >
          {fighter.shortName}
        </span>
        <span className="font-display text-[7px] tracking-widest text-white/40">
          {move.type.toUpperCase()}
        </span>
      </div>
      <div className="font-display text-sm tracking-wider text-white leading-tight">
        {move.name}
      </div>
      <p className="font-body italic text-base text-white/90 leading-snug">
        "{move.quote}"
      </p>
      <div className="flex items-center justify-between pt-2 mt-auto border-t border-white/10">
        <span className="font-display text-[7px] tracking-widest text-white/50">
          {move.episode} · {move.timestamp}
        </span>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => Sfx.menuSelect()}
            className="font-display text-[7px] tracking-widest px-1.5 py-0.5"
            style={{
              border: `1px solid ${fighter.accent}`,
              color: fighter.accent,
              textDecoration: 'none',
            }}
          >
            ▶ EPISODE
          </a>
        )}
      </div>
    </div>
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
