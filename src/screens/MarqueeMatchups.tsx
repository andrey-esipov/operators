import { useGame } from '../state/game'
import { MARQUEE_MATCHUPS } from '../data/marquee-matchups'
import { getFighter } from '../data/fighters'
import { SCENARIOS } from '../data/scenarios'
import { Sprite } from '../components/Sprite'
import { Sfx } from '../lib/audio'

/**
 * Marquee Matchups — hand-curated dream fights.
 *
 * Click a card → both fighters pre-picked, scenario set, straight to pre-fight.
 * Designed so non-fans can pick a fight without knowing every guest.
 */
export function MarqueeMatchups() {
  const setPhase = useGame((s) => s.setPhase)
  const startMatch = useGame((s) => s.startMatch)
  const setMode = useGame((s) => s.setMode)

  function fight(m: typeof MARQUEE_MATCHUPS[number]) {
    Sfx.menuSelect()
    // Force single-player semantics — the player picks the matchup, but
    // they aren't hot-seating both sides. 'daily' is the right mode tag:
    // it engages the bot AI for side B without dragging the player into
    // arcade-mode progression (no next-stage advance, no boss anchor).
    // Without this set, mode stays at whatever was previously selected
    // (default 'vs'), so the bot useEffect's `if (mode === 'vs') return`
    // gate skips bot turns entirely — the player ends up controlling
    // both fighters.
    setMode('daily')
    startMatch(m.fighterA, m.fighterB, m.scenarioId)
  }

  return (
    <div className="relative w-full h-full overflow-y-auto">
      <div
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{
          background: 'radial-gradient(circle at 50% 20%, #7209B722 0%, #1A0F2E 50%, #0F0A1A 100%)',
        }}
      />

      {/* Header */}
      <div
        className="sticky top-0 z-20 px-6 py-4 backdrop-blur-md flex items-center justify-between"
        style={{ background: 'rgba(15,10,26,0.9)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}
      >
        <button
          onClick={() => { Sfx.menuMove(); setPhase('menu') }}
          className="font-display text-[10px] tracking-widest text-white/70"
        >
          ← MAIN MENU
        </button>
        <h1
          className="font-display text-2xl tracking-widest"
          style={{
            color: '#FFD60A',
            textShadow: '4px 4px 0 black, 0 0 24px #F77F00',
          }}
        >
          ★ MARQUEE MATCHUPS ★
        </h1>
        <div className="font-display text-[9px] tracking-widest text-white/60">
          {MARQUEE_MATCHUPS.length} DREAM FIGHTS
        </div>
      </div>

      <p className="font-body text-base text-white/70 max-w-4xl px-6 pt-4 leading-snug">
        Hand-curated fights between operators whose philosophies clash. Click any to drop
        straight into pre-fight — both fighters and the scenario are pre-picked for maximum tension.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6 pb-16">
        {MARQUEE_MATCHUPS.map((m) => (
          <MatchupCard key={m.id} matchup={m} onFight={() => fight(m)} />
        ))}
      </div>
    </div>
  )
}

function MatchupCard({
  matchup,
  onFight,
}: {
  matchup: typeof MARQUEE_MATCHUPS[number]
  onFight: () => void
}) {
  const a = getFighter(matchup.fighterA)
  const b = getFighter(matchup.fighterB)
  const stage = SCENARIOS[matchup.scenarioId]
  if (!a || !b) return null

  return (
    <button
      onClick={onFight}
      onMouseEnter={Sfx.menuMove}
      className="relative text-left transition-transform hover:scale-[1.02] hover:translate-y-[-2px]"
      style={{
        background: `linear-gradient(135deg, ${a.accent}22 0%, rgba(15,10,26,0.92) 50%, ${b.accent}22 100%)`,
        border: `2px solid ${matchup.accent}`,
        boxShadow: `0 0 18px ${matchup.accent}55, inset -2px -2px 0 rgba(0,0,0,0.5)`,
        cursor: 'pointer',
      }}
    >
      {/* Title bar */}
      <div
        className="px-3 py-2 font-display text-[10px] tracking-widest text-center"
        style={{
          background: `${matchup.accent}33`,
          color: matchup.accent,
          borderBottom: `1px solid ${matchup.accent}66`,
          textShadow: '2px 2px 0 black',
        }}
      >
        {matchup.title}
      </div>

      {/* Sprites */}
      <div className="flex items-end justify-between px-2 pt-2" style={{ minHeight: 140 }}>
        <div className="flex-1 flex flex-col items-center">
          <div style={{ width: 100, height: 120 }} className="idle-bob">
            <Sprite fighter={a} side="a" state="stance" />
          </div>
          <div
            className="font-display text-[8px] tracking-widest mt-1"
            style={{ color: a.accent, textShadow: '2px 2px 0 black' }}
          >
            {a.shortName}
          </div>
        </div>
        <div
          className="font-display text-2xl"
          style={{ color: '#FFD60A', textShadow: '3px 3px 0 black, 0 0 12px #F77F00', alignSelf: 'center', paddingBottom: 20 }}
        >
          VS
        </div>
        <div className="flex-1 flex flex-col items-center">
          <div style={{ width: 100, height: 120 }} className="idle-bob">
            <Sprite fighter={b} side="b" state="stance" />
          </div>
          <div
            className="font-display text-[8px] tracking-widest mt-1"
            style={{ color: b.accent, textShadow: '2px 2px 0 black' }}
          >
            {b.shortName}
          </div>
        </div>
      </div>

      {/* Stage tag */}
      <div className="flex items-center justify-center gap-1 mt-2">
        <span style={{ fontSize: 12 }}>{stage.icon}</span>
        <span
          className="font-display text-[8px] tracking-widest"
          style={{ color: stage.accent }}
        >
          {stage.name}
        </span>
      </div>

      {/* Flavor */}
      <p className="font-body italic text-base text-white/85 px-3 pt-2 pb-3 leading-snug">
        &ldquo;{matchup.flavor}&rdquo;
      </p>

      {/* CTA hint */}
      <div
        className="px-3 py-1.5 font-display text-[8px] tracking-widest text-center"
        style={{
          background: 'rgba(0,0,0,0.45)',
          color: '#FFD60A',
          borderTop: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        ▶ FIGHT
      </div>
    </button>
  )
}
