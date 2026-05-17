import { useEffect, useState, useMemo } from 'react'
import { FIGHTERS, FEATURED_ROSTER, getFighter } from '../data/fighters'
import type { FighterDef } from '../types'
import { SCENARIOS, SCENARIO_ORDER } from '../data/scenarios'
import { PULL_QUOTES } from '../data/pull-quotes'
import { Sprite } from '../components/Sprite'
import { Sfx } from '../lib/audio'
import { Announcer } from '../lib/announcer'

interface Props {
  onExit: () => void
}

type Scene =
  | { kind: 'title' }
  | { kind: 'matchup'; fighterA: string; fighterB: string; scenarioId: typeof SCENARIO_ORDER[number] }
  | { kind: 'ko'; winner: string; loser: string }
  | { kind: 'quote'; fighterId: string; quote: string; episode: string }
  | { kind: 'stats' }
  | { kind: 'roster' }

/**
 * SF II–style attract mode reel.
 *
 * Cycles through scripted scenes for ~30s. Stops on ANY user interaction
 * via the parent's onExit callback wired to a global pointer listener.
 *
 * Scenes:
 *   1. Title beat        — "OPERATORS" logo with subtitle
 *   2. Matchup            — random Fighter A vs Fighter B in a stage
 *   3. K.O. flash         — "K.O.!" banner over a winner pose
 *   4. Quote pull-card    — random curated quote
 *   5. Stats              — derived counts (fighters / frameworks / stages)
 *   6. Roster grid        — every fighter portrait at once
 *   7. (loop back to title)
 */
export function AttractMode({ onExit }: Props) {
  // Pre-compute a randomized scene sequence (8 scenes ≈ 32 seconds). The
  // matchup + KO scenes draw from FEATURED_ROSTER so the demo reel only
  // shows fighters with finished sprite art — wave-4 placeholder figures
  // shouldn't headline the marquee. RosterScene still renders all FIGHTERS.
  const scenes = useMemo<Scene[]>(() => {
    const featuredDefs = FEATURED_ROSTER
      .map((id) => getFighter(id))
      .filter((f): f is FighterDef => !!f)
    const pool = featuredDefs.length >= 5 ? featuredDefs : FIGHTERS
    const shuffled = [...pool].sort(() => Math.random() - 0.5)
    const sc = SCENARIO_ORDER
    return [
      { kind: 'title' },
      { kind: 'matchup', fighterA: shuffled[0].id, fighterB: shuffled[1].id, scenarioId: sc[Math.floor(Math.random() * sc.length)] },
      { kind: 'ko', winner: shuffled[2].id, loser: shuffled[3].id },
      (() => {
        // Single coherent pick — otherwise fighterId / quote / episode were
        // sourced from three independent random PULL_QUOTES entries and the
        // reel could attribute one guest's quote to another guest's episode.
        const pq = PULL_QUOTES[Math.floor(Math.random() * PULL_QUOTES.length)]
        return {
          kind: 'quote' as const,
          fighterId: pq.fighterId,
          quote: pq.quote,
          episode: pq.episode,
        }
      })(),
      { kind: 'matchup', fighterA: shuffled[4].id, fighterB: 'lenny', scenarioId: 'ipo-prep' },
      { kind: 'stats' },
      { kind: 'roster' },
      { kind: 'title' },
    ]
  }, [])

  const [sceneIdx, setSceneIdx] = useState(0)
  const scene = scenes[sceneIdx % scenes.length]

  // Advance scenes. Stats + quote scenes are intentionally long so the
  // viewer can actually read them — they were 4.5s before, which left
  // ~0.6s per stat after the stagger animation finished. Bumped to 8s
  // for stats and 6.5s for quotes.
  useEffect(() => {
    const duration =
      scene.kind === 'ko' ? 3000
      : scene.kind === 'title' ? 3500
      : scene.kind === 'stats' ? 8000
      : scene.kind === 'quote' ? 6500
      : 4500
    const id = setTimeout(() => setSceneIdx((i) => i + 1), duration)
    return () => clearTimeout(id)
  }, [sceneIdx, scene.kind])

  // Sound triggers per scene
  useEffect(() => {
    if (scene.kind === 'matchup') {
      Announcer.fight()
    } else if (scene.kind === 'ko') {
      Announcer.ko()
      Sfx.ko()
    } else if (scene.kind === 'quote') {
      Sfx.menuMove()
    } else if (scene.kind === 'roster') {
      Sfx.menuSelect()
    }
  }, [sceneIdx, scene.kind])

  return (
    <div
      className="relative w-full h-full overflow-hidden cursor-pointer"
      onClick={onExit}
      onKeyDown={onExit}
      tabIndex={-1}
      style={{
        background: 'radial-gradient(circle at 50% 30%, #1A0F2E 0%, #0F0A1A 100%)',
      }}
    >
      {/* CRT flicker overlay always present */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.15) 0px, transparent 2px, transparent 4px)',
          opacity: 0.4,
          mixBlendMode: 'multiply',
        }}
      />

      {scene.kind === 'title' && <TitleScene />}
      {scene.kind === 'matchup' && (
        <MatchupScene
          fighterA={scene.fighterA}
          fighterB={scene.fighterB}
          scenarioId={scene.scenarioId}
        />
      )}
      {scene.kind === 'ko' && <KOScene winner={scene.winner} loser={scene.loser} />}
      {scene.kind === 'quote' && (
        <QuoteScene fighterId={scene.fighterId} quote={scene.quote} episode={scene.episode} />
      )}
      {scene.kind === 'stats' && <StatsScene />}
      {scene.kind === 'roster' && <RosterScene />}

      {/* Constant PRESS START prompt at bottom */}
      <div
        className="absolute left-0 right-0 bottom-6 z-30 text-center font-display text-base tracking-widest pointer-events-none"
        style={{
          color: '#FFD60A',
          textShadow: '3px 3px 0 black, 0 0 18px #F77F00',
          animation: 'flash 1s linear infinite',
        }}
      >
        ◇ CLICK ANYWHERE TO PLAY ◇
      </div>
    </div>
  )
}

// ─── SCENES ─────────────────────────────────────────────────────────

function TitleScene() {
  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center">
      {/* Hero artwork if present */}
      <img
        src="/menu/title-hero.png"
        alt=""
        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
        className="absolute inset-0 w-full h-full object-cover"
        style={{
          imageRendering: 'pixelated',
          opacity: 0.7,
          mixBlendMode: 'screen',
        }}
      />
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse, transparent 30%, rgba(0,0,0,0.85) 100%)' }}
      />
      <div
        className="relative z-10 font-display tracking-widest"
        style={{
          color: '#FFD60A',
          fontSize: 110,
          letterSpacing: '0.1em',
          textShadow: '8px 8px 0 black, 0 0 32px #F77F00, 0 0 64px #E63946',
          animation: 'titlePulse 2s ease-in-out infinite',
          transform: 'skewX(-3deg)',
        }}
      >
        OPERATORS
      </div>
      <div
        className="relative z-10 font-display tracking-widest mt-3"
        style={{
          color: 'white',
          fontSize: 14,
          letterSpacing: '0.4em',
          textShadow: '2px 2px 0 black',
        }}
      >
        ★ A TACTICAL FIGHTER ON LENNY'S PODCAST ★
      </div>
      <style>{`
        @keyframes titlePulse {
          0%, 100% { transform: skewX(-3deg) scale(1) }
          50%      { transform: skewX(-3deg) scale(1.04) }
        }
      `}</style>
    </div>
  )
}

function MatchupScene({
  fighterA, fighterB, scenarioId,
}: {
  fighterA: string; fighterB: string; scenarioId: typeof SCENARIO_ORDER[number]
}) {
  const a = getFighter(fighterA)!
  const b = getFighter(fighterB)!
  const stage = SCENARIOS[scenarioId]
  return (
    <div className="relative w-full h-full">
      {/* Stage background */}
      <img
        src={`/stages/${scenarioId}.png`}
        alt=""
        onError={(e) => ((e.target as HTMLImageElement).style.opacity = '0')}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ imageRendering: 'pixelated', filter: 'brightness(0.7)' }}
      />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.7) 100%)' }} />

      {/* Stage label */}
      <div
        className="absolute top-12 left-0 right-0 text-center font-display"
        style={{
          color: stage.accent,
          fontSize: 24,
          letterSpacing: '0.3em',
          textShadow: '4px 4px 0 black',
          animation: 'banner-in 0.6s ease-out',
        }}
      >
        {stage.icon} {stage.name}
      </div>

      {/* Fighters facing off */}
      <div className="absolute inset-x-0 bottom-24 flex items-end justify-center gap-10">
        <div style={{ width: 260, height: 340 }} className="idle-bob">
          <Sprite fighter={a} side="a" state="stance" />
          <div
            className="absolute top-0 left-0 right-0 text-center font-display"
            style={{ color: a.accent, fontSize: 20, letterSpacing: '0.2em', textShadow: '2px 2px 0 black', transform: 'translateY(-40px)' }}
          >
            {a.shortName}
          </div>
        </div>
        <div
          className="font-display"
          style={{
            color: '#FFD60A',
            fontSize: 64,
            letterSpacing: '0.05em',
            textShadow: '4px 4px 0 black, 0 0 24px #F77F00',
            animation: 'titlePulse 1.4s ease-in-out infinite',
          }}
        >
          VS
        </div>
        <div style={{ width: 260, height: 340 }} className="idle-bob">
          <Sprite fighter={b} side="b" state="stance" />
          <div
            className="absolute top-0 left-0 right-0 text-center font-display"
            style={{ color: b.accent, fontSize: 20, letterSpacing: '0.2em', textShadow: '2px 2px 0 black', transform: 'translateY(-40px)' }}
          >
            {b.shortName}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes titlePulse {
          0%, 100% { transform: scale(1) }
          50%      { transform: scale(1.08) }
        }
      `}</style>
    </div>
  )
}

function KOScene({ winner, loser }: { winner: string; loser: string }) {
  const w = getFighter(winner)!
  const l = getFighter(loser)!
  return (
    <div
      className="relative w-full h-full"
      style={{ background: 'radial-gradient(ellipse, #1A0F2E 0%, #0F0A1A 100%)' }}
    >
      {/* Defeated fighter on the side */}
      <div className="absolute left-8 bottom-12 opacity-50" style={{ width: 240, height: 320 }}>
        <Sprite fighter={l} side="b" state="lose" />
      </div>

      {/* Winner pose */}
      <div className="absolute right-12 bottom-8" style={{ width: 280, height: 380 }}>
        <Sprite fighter={w} side="a" state="win" />
      </div>

      {/* "K.O." text */}
      <div
        className="absolute left-0 right-0 text-center font-display"
        style={{
          top: '24%',
          color: '#FFD60A',
          fontSize: 140,
          letterSpacing: '0.18em',
          textShadow: '8px 8px 0 black, 0 0 32px #F77F00, 0 0 64px #E63946',
          transform: 'skewX(-6deg)',
          animation: 'koBannerCrash 0.6s cubic-bezier(0.2, 0.9, 0.3, 1)',
        }}
      >
        K.O.!
      </div>

      <div
        className="absolute left-0 right-0 text-center font-display"
        style={{
          top: '46%',
          color: w.accent,
          fontSize: 28,
          letterSpacing: '0.35em',
          textShadow: '4px 4px 0 black',
        }}
      >
        {w.shortName} WINS
      </div>

      {/* Particle burst */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 100 100">
        {Array.from({ length: 40 }).map((_, i) => {
          const angle = (i / 40) * Math.PI * 2
          const speed = 25 + (i % 18)
          const dx = Math.cos(angle) * speed
          const dy = Math.sin(angle) * speed - 12
          const hue = ['#FFD60A', '#F77F00', '#E63946', '#FFFFFF'][i % 4]
          return (
            <rect
              key={i}
              x={50}
              y={36}
              width={(i % 3) + 1}
              height={(i % 3) + 1}
              fill={hue}
              style={{
                animation: 'koParticle 1.3s linear forwards',
                animationDelay: `${(i * 8) % 60}ms`,
                ['--dx' as unknown as string]: `${dx}`,
                ['--dy' as unknown as string]: `${dy}`,
              }}
            />
          )
        })}
      </svg>
    </div>
  )
}

function QuoteScene({ fighterId, quote, episode }: { fighterId: string; quote: string; episode: string }) {
  const f = getFighter(fighterId)
  if (!f) return null
  return (
    <div className="relative w-full h-full flex items-center justify-center px-12">
      {/* Background fighter silhouette */}
      <div
        className="absolute left-0 right-0 flex items-center justify-center pointer-events-none"
        style={{ top: '14%', opacity: 0.18 }}
      >
        <div style={{ width: 320, height: 460 }}>
          <Sprite fighter={f} side="a" state="win" />
        </div>
      </div>

      {/* Quote card. Note: we deliberately do NOT use a CSS keyframe
       *  animation here — in React 18 dev (StrictMode), the component
       *  mounts → unmounts → remounts on first render, which re-fires
       *  the keyframe and causes a visible flash/disappear/reappear. A
       *  static element renders consistently in both dev and prod. */}
      <div
        className="relative z-10 max-w-3xl px-8 py-6"
        style={{
          background: 'rgba(15,10,26,0.85)',
          border: `3px solid ${f.accent}`,
          boxShadow: `0 0 36px ${f.accent}77, inset -2px -2px 0 rgba(0,0,0,0.5), inset 2px 2px 0 rgba(255,255,255,0.1)`,
        }}
      >
        <div
          className="font-display text-[10px] tracking-widest mb-3"
          style={{ color: f.accent }}
        >
          ◇ VERBATIM FROM {episode.toUpperCase()}
        </div>
        <p
          className="font-body italic text-3xl text-white leading-snug"
          style={{ textShadow: '2px 2px 0 black' }}
        >
          &ldquo;{quote}&rdquo;
        </p>
        <div
          className="font-display text-[12px] tracking-widest mt-4"
          style={{ color: f.accent }}
        >
          — {f.shortName}
        </div>
      </div>
    </div>
  )
}

function StatsScene() {
  // Derive counts from the canonical data so this never drifts as the
  // roster grows. Frameworks = every move + every ult across all fighters.
  // Voice lines = 6 fixed slots per fighter + the trash-talk array length.
  // Cut from 6 stats to 4 — the previous "GAME MODES: 6" was stale after
  // the menu consolidation (PR #35), and "PATTERN MATCHES: ∞" was filler
  // that crowded the readable stats off the screen. Four stats, big and
  // legible, hold for the full 8s scene duration.
  const frameworks = FIGHTERS.reduce((sum, f) => sum + f.moves.length + 1, 0)
  const voiceLines = FIGHTERS.reduce(
    (sum, f) => sum + 6 + (f.voiceLines.trash?.length ?? 0),
    0
  )
  const stats = [
    { num: String(FIGHTERS.length), label: 'OPERATORS' },
    { num: String(frameworks), label: 'FRAMEWORKS' },
    { num: String(SCENARIO_ORDER.length), label: 'STAGES' },
    { num: String(voiceLines), label: 'VOICE LINES' },
  ]
  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center px-12">
      <div
        className="font-display tracking-widest mb-10"
        style={{
          color: '#FFD60A',
          fontSize: 32,
          letterSpacing: '0.3em',
          textShadow: '4px 4px 0 black, 0 0 24px #F77F00',
        }}
      >
        FROM LENNY'S ARCHIVE
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-12 gap-y-10">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col items-center">
            <div
              className="font-num tabular-nums"
              style={{
                color: 'white',
                fontSize: 96,
                lineHeight: 1,
                textShadow: '4px 4px 0 black, 0 0 18px #F72585',
              }}
            >
              {s.num}
            </div>
            <div
              className="font-display text-xs tracking-widest mt-3"
              style={{ color: '#FCBF49', letterSpacing: '0.3em' }}
            >
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RosterScene() {
  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center">
      <div
        className="font-display tracking-widest mb-6"
        style={{
          color: '#FFD60A',
          fontSize: 24,
          letterSpacing: '0.3em',
          textShadow: '4px 4px 0 black',
        }}
      >
        {FIGHTERS.length} OPERATORS
      </div>
      <div className="grid grid-cols-7 gap-2 max-w-4xl">
        {FIGHTERS.map((f, i) => (
          <div
            key={f.id}
            className="aspect-square relative"
            style={{
              background: `linear-gradient(180deg, ${f.accent}33, ${f.accent}11)`,
              border: `2px solid ${f.accent}88`,
              boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.4)',
              animation: `banner-in 0.5s ease-out ${(i * 0.04)}s both`,
            }}
          >
            <Sprite fighter={f} side="a" state="stance" />
            <div
              className="absolute left-0 right-0 bottom-0 font-display text-[7px] text-center py-0.5 text-white truncate"
              style={{ background: 'rgba(0,0,0,0.78)', letterSpacing: '0.5px' }}
            >
              {f.shortName}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
