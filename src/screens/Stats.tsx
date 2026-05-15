import { useEffect, useState } from 'react'
import { useGame } from '../state/game'
import { Sfx } from '../lib/audio'
import { ACHIEVEMENTS, loadStats, loadUnlocked, type PlayerStats } from '../data/achievements'
import { FIGHTERS, getFighter } from '../data/fighters'

/**
 * Player stats + achievements screen.
 * Loads from localStorage on mount. Stats accumulate as you play any mode.
 */
export function Stats() {
  const setPhase = useGame((s) => s.setPhase)
  const [stats, setStats] = useState<PlayerStats | null>(null)
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set())

  useEffect(() => {
    setStats(loadStats())
    setUnlocked(loadUnlocked())
  }, [])

  if (!stats) return null

  const winRate = stats.totalMatches > 0 ? Math.round((stats.totalWins / stats.totalMatches) * 100) : 0

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
        style={{ background: 'rgba(15,10,26,0.88)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-center justify-between">
          <button
            onClick={() => { Sfx.menuMove(); setPhase('menu') }}
            className="font-display text-[10px] tracking-widest text-white/70"
          >
            ← MAIN MENU
          </button>
          <h1
            className="font-display text-2xl tracking-widest"
            style={{ color: '#FFD60A', textShadow: '4px 4px 0 black' }}
          >
            STATS · ACHIEVEMENTS
          </h1>
          <div className="font-display text-[9px] tracking-widest text-white/60">
            {unlocked.size} / {ACHIEVEMENTS.length} UNLOCKED
          </div>
        </div>
      </div>

      <div className="p-6 pb-16 space-y-8">
        {/* TOP STATS GRID */}
        <section>
          <h2 className="font-display text-sm tracking-widest text-white/70 mb-3">▌ CAREER</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile label="MATCHES" value={stats.totalMatches} accent="#FFD60A" />
            <StatTile label="WINS"    value={stats.totalWins}    accent="#06D6A0" />
            <StatTile label="WIN RATE" value={`${winRate}%`}     accent="#FCBF49" />
            <StatTile label="K.O.s"   value={stats.totalKOs}     accent="#EF233C" />
            <StatTile label="COMBOS"  value={stats.totalCombos}  accent="#F72585" />
            <StatTile label="CRITS"   value={stats.totalCrits}   accent="#FFFFFF" />
            <StatTile label="ULTS"    value={stats.totalUlts}    accent="#7209B7" />
            <StatTile label="QUOTES"  value={stats.totalQuotes}  accent="#00B4D8" />
          </div>
        </section>

        {/* ROSTER PROGRESS */}
        <section>
          <h2 className="font-display text-sm tracking-widest text-white/70 mb-3">
            ▌ ROSTER · USED {stats.fightersUsed.length} / {FIGHTERS.length} · BEATEN {stats.fightersBeaten.length} / {FIGHTERS.length}
          </h2>
          <div className="grid grid-cols-6 md:grid-cols-9 gap-2">
            {FIGHTERS.map((f) => {
              const used = stats.fightersUsed.includes(f.id)
              const beaten = stats.fightersBeaten.includes(f.id)
              return (
                <div
                  key={f.id}
                  className="p-2 text-center"
                  style={{
                    background: used || beaten ? `${f.accent}33` : 'rgba(0,0,0,0.3)',
                    border: `1px solid ${used || beaten ? f.accent : 'rgba(255,255,255,0.1)'}`,
                    opacity: used || beaten ? 1 : 0.4,
                  }}
                  title={f.name}
                >
                  <div className="font-display text-[8px] tracking-widest" style={{ color: f.accent }}>
                    {f.shortName}
                  </div>
                  <div className="text-[8px] font-display mt-1 text-white/70">
                    {used && '★'} {beaten && '⚔'}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="font-body text-xs text-white/40 mt-2">★ won as · ⚔ defeated</p>
        </section>

        {/* ACHIEVEMENTS */}
        <section>
          <h2 className="font-display text-sm tracking-widest text-white/70 mb-3">▌ ACHIEVEMENTS</h2>
          {unlocked.size === 0 && (
            <p className="font-body text-base text-white/60 mb-3 italic">
              Play any mode to earn badges. <span style={{ color: '#CD7F32' }}>Bronze</span> tier
              unlocks fast; <span style={{ color: '#C0C0C0' }}>silver</span> rewards mastery;
              <span style={{ color: '#FFD60A' }}> gold</span> requires defeating Lenny on hard.
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {ACHIEVEMENTS.map((a) => {
              const got = unlocked.has(a.id)
              const tierColor =
                a.tier === 'gold' ? '#FFD60A' : a.tier === 'silver' ? '#C0C0C0' : '#CD7F32'
              return (
                <div
                  key={a.id}
                  className="p-3 flex items-start gap-3"
                  style={{
                    background: got ? `${tierColor}1A` : 'rgba(0,0,0,0.45)',
                    border: `2px solid ${got ? tierColor : 'rgba(255,255,255,0.1)'}`,
                    opacity: got ? 1 : 0.55,
                    boxShadow: got ? `inset -2px -2px 0 rgba(0,0,0,0.4), 0 0 14px ${tierColor}55` : 'inset -2px -2px 0 rgba(0,0,0,0.4)',
                  }}
                >
                  <div className="text-3xl" style={{ filter: got ? `drop-shadow(0 0 4px ${tierColor})` : 'grayscale(1) opacity(0.4)' }}>
                    {a.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className="font-display text-[10px] tracking-widest"
                      style={{ color: got ? tierColor : 'rgba(255,255,255,0.5)' }}
                    >
                      {a.name} {got ? '· ✓' : '· ?'}
                    </div>
                    <p className="font-body text-base text-white/80 mt-1 leading-snug">
                      {a.description}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* SCENARIO TILES */}
        <section>
          <h2 className="font-display text-sm tracking-widest text-white/70 mb-3">▌ ARCADE / DAILY / SCENARIO</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile label="ARCADE RUNS" value={stats.arcadeRunsCompleted} accent="#E63946" />
            <StatTile label="LENNY DEFEATS" value={stats.lennyDefeats} accent="#FFD60A" />
            <StatTile label="DAILY STREAK" value={stats.dailyStreak} accent="#06D6A0" />
            <StatTile label="HARD WINS" value={stats.hardModeWins} accent="#F72585" />
          </div>
        </section>
      </div>
    </div>
  )
}

function StatTile({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <div
      className="p-3 text-center"
      style={{
        background: `${accent}1A`,
        border: `2px solid ${accent}55`,
        boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.4)',
      }}
    >
      <div
        className="font-num tabular-nums"
        style={{ color: accent, fontSize: 32, textShadow: '2px 2px 0 black', lineHeight: 1 }}
      >
        {value}
      </div>
      <div className="font-display text-[8px] tracking-widest text-white/60 mt-1">
        {label}
      </div>
    </div>
  )
}

// Suppress unused-import warning
void getFighter
