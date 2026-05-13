import { useMemo, useState } from 'react'
import { useGame } from '../state/game'
import { FIGHTERS, getFighter } from '../data/fighters'
import { Sfx } from '../lib/audio'

export function QuoteBank() {
  const quoteBank = useGame((s) => s.quoteBank)
  const setPhase = useGame((s) => s.setPhase)
  const [filter, setFilter] = useState<string>('all')

  // Resolve each entry into a fighter + move
  const entries = useMemo(() => {
    const resolved: Array<{
      fighterId: string
      moveId: string
      ts: number
      name: string
      shortName: string
      accent: string
      moveName: string
      quote: string
      episode: string
      timestamp: string
      type: string
    }> = []
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
        ...e,
        name: f.name,
        shortName: f.shortName,
        accent: f.accent,
        moveName: move.name,
        quote: move.quote,
        episode: move.episode,
        timestamp: move.timestamp,
        type: move.type,
      })
    }
    return filter === 'all' ? resolved : resolved.filter((e) => e.fighterId === filter)
  }, [quoteBank, filter])

  function copyToClipboard() {
    const text = entries
      .map((e) => `"${e.quote}"\n— ${e.name}, ${e.episode} (${e.timestamp})`)
      .join('\n\n')
    navigator.clipboard.writeText(text).catch(() => {})
    Sfx.menuSelect()
  }

  return (
    <div className="relative w-full h-full overflow-y-auto p-6">
      <div
        className="absolute inset-0 -z-10"
        style={{
          background: 'radial-gradient(circle at top, #3B2360 0%, #1A0F2E 60%, #0F0A1A 100%)',
        }}
      />

      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => {
            Sfx.menuMove()
            setPhase('menu')
          }}
          className="font-display text-[10px] tracking-widest text-white/70"
        >
          ← MAIN MENU
        </button>
        <h1 className="font-display text-2xl tracking-widest" style={{
          color: '#FFD60A',
          textShadow: '4px 4px 0 black',
        }}>
          QUOTE BANK
        </h1>
        <button
          onClick={copyToClipboard}
          className="font-display text-[10px] tracking-widest text-white/70"
        >
          COPY ALL ↗
        </button>
      </div>

      <p className="font-body text-xl text-white/80 mb-4 max-w-3xl">
        Every move you've played has unlocked a real quote from Lenny's Podcast. {entries.length} unique entries grounded in real episodes.
      </p>

      <div className="flex gap-2 flex-wrap mb-4">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
          ALL ({quoteBank.length})
        </Chip>
        {FIGHTERS.map((f) => (
          <Chip
            key={f.id}
            active={filter === f.id}
            color={f.accent}
            onClick={() => setFilter(f.id)}
          >
            {f.shortName}
          </Chip>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-12">
        {entries.length === 0 && (
          <div className="col-span-full text-center font-body text-2xl text-white/40 py-12">
            Play a match. Every move unlocks a quote.
          </div>
        )}
        {entries.map((e) => (
          <div
            key={`${e.fighterId}:${e.moveId}`}
            className="p-4 flex flex-col gap-2"
            style={{
              background: 'rgba(15,10,26,0.7)',
              border: `2px solid ${e.accent}`,
              boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.5), inset 2px 2px 0 rgba(255,255,255,0.1)',
            }}
          >
            <div className="flex items-baseline justify-between">
              <span className="font-display text-[10px] tracking-widest" style={{ color: e.accent }}>
                {e.shortName}
              </span>
              <span className="font-display text-[7px] tracking-widest text-white/40">
                {e.type.toUpperCase()}
              </span>
            </div>
            <div className="font-display text-base tracking-wider text-white">
              {e.moveName}
            </div>
            <div className="font-body text-xl italic text-white/90 leading-snug">
              "{e.quote}"
            </div>
            <div className="font-display text-[8px] tracking-widest text-white/50 mt-auto pt-2 border-t border-white/10">
              {e.episode} · {e.timestamp}
            </div>
          </div>
        ))}
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
  return (
    <button
      onClick={onClick}
      onMouseEnter={Sfx.menuMove}
      className="px-3 py-1 font-display text-[8px] tracking-widest"
      style={{
        background: active ? color ?? '#FFD60A' : 'transparent',
        color: active ? '#0F0A1A' : color ?? '#FFD60A',
        border: `1px solid ${color ?? '#FFD60A'}`,
        boxShadow: active ? `0 0 8px ${color ?? '#FFD60A'}` : 'none',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}
