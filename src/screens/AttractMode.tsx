import { useEffect, useState, useMemo } from 'react'
import { FIGHTERS, FEATURED_ROSTER, getFighter } from '../data/fighters'
import type { FighterDef } from '../types'
import { SCENARIOS, SCENARIO_ORDER } from '../data/scenarios'
import { PULL_QUOTES } from '../data/pull-quotes'
import { Sprite } from '../components/Sprite'
import { Sfx } from '../lib/audio'
import { Announcer } from '../lib/announcer'
import './menu/menu.css'

// AAA type tokens (defined on .am-root in menu.css). Referencing them
// inline keeps every scene on the same industrial display/UI faces instead
// of the pixel webfont the old attract reel used.
const DISPLAY = 'var(--mm-display)'
const UI = 'var(--mm-ui)'
const BODY = 'var(--mm-body)'

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
 *   1. Title beat        — "OPERATORS" logotype with subtitle
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

  // Advance scenes. Stats + quote scenes hold longer than the default so
  // the viewer can actually read them.
  useEffect(() => {
    const duration =
      scene.kind === 'ko' ? 3000
      : scene.kind === 'title' ? 3500
      : scene.kind === 'stats' ? 6000
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
      className="am-root"
      onClick={onExit}
      onKeyDown={onExit}
      tabIndex={-1}
      style={{ background: 'radial-gradient(circle at 50% 32%, #150C26 0%, #07050E 100%)' }}
    >
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

      {/* Atmosphere overlays over every scene */}
      <div className="am-vignette" aria-hidden />
      <div className="am-scan" aria-hidden />
      <div className="am-grain" aria-hidden />

      {/* Constant PRESS START prompt at bottom */}
      <div
        className="am-prompt"
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 30, zIndex: 41,
          textAlign: 'center', fontSize: 18, pointerEvents: 'none',
        }}
      >
        PRESS START
      </div>
    </div>
  )
}

// ─── SCENES ─────────────────────────────────────────────────────────

function TitleScene() {
  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center">
      {/* Hero artwork if present, driven dark so the logotype owns the frame */}
      <img
        src="/menu/title-hero.png"
        alt=""
        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ imageRendering: 'pixelated', opacity: 0.34, filter: 'brightness(0.7) saturate(1.1)' }}
      />
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at 50% 46%, transparent 24%, rgba(4,2,10,0.9) 100%)' }}
      />
      <div className="am-eyebrow relative z-10" style={{ fontSize: 15, marginBottom: 18 }}>
        A Tactical Fighter on Lenny&rsquo;s Podcast
      </div>
      <div className="am-logo am-anim relative z-10" style={{ fontSize: 150 }}>
        OPERATORS
      </div>
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
        style={{ imageRendering: 'pixelated', filter: 'brightness(0.5) saturate(0.9)' }}
      />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at center, transparent 26%, rgba(4,2,10,0.82) 100%)' }} />

      {/* Stage label */}
      <div
        className="am-label absolute left-0 right-0 text-center"
        style={{
          top: 54, color: stage.accent, fontSize: 20, letterSpacing: '0.32em',
          animation: 'banner-in 0.6s ease-out',
        }}
      >
        {stage.icon}&nbsp;&nbsp;{stage.name}
      </div>

      {/* Fighters facing off */}
      <div className="absolute inset-x-0 bottom-24 flex items-end justify-center gap-10">
        <div style={{ width: 260, height: 340 }} className="idle-bob">
          <Sprite fighter={a} side="a" state="stance" />
          <div
            className="absolute top-0 left-0 right-0 text-center"
            style={{ fontFamily: UI, fontWeight: 700, color: a.accent, fontSize: 22, letterSpacing: '0.14em', textShadow: '0 2px 10px #000', transform: 'translateY(-40px)' }}
          >
            {a.shortName}
          </div>
        </div>
        <div
          className="am-banner"
          style={{ fontSize: 82, animation: 'attract-pop-in 0.5s cubic-bezier(0.2,0.9,0.3,1)' }}
        >
          VS
        </div>
        <div style={{ width: 260, height: 340 }} className="idle-bob">
          <Sprite fighter={b} side="b" state="stance" />
          <div
            className="absolute top-0 left-0 right-0 text-center"
            style={{ fontFamily: UI, fontWeight: 700, color: b.accent, fontSize: 22, letterSpacing: '0.14em', textShadow: '0 2px 10px #000', transform: 'translateY(-40px)' }}
          >
            {b.shortName}
          </div>
        </div>
      </div>
    </div>
  )
}

function KOScene({ winner, loser }: { winner: string; loser: string }) {
  const w = getFighter(winner)!
  const l = getFighter(loser)!
  return (
    <div
      className="relative w-full h-full"
      style={{ background: 'radial-gradient(ellipse at 50% 40%, #150C26 0%, #07050E 100%)' }}
    >
      {/* Defeated fighter on the side */}
      <div className="absolute left-8 bottom-12 opacity-50" style={{ width: 240, height: 320 }}>
        <Sprite fighter={l} side="b" state="lose" />
      </div>

      {/* Winner pose */}
      <div className="absolute right-12 bottom-8" style={{ width: 280, height: 380 }}>
        <Sprite fighter={w} side="a" state="win" />
      </div>

      {/* "K.O." banner */}
      <div
        className="am-banner absolute left-0 right-0 text-center"
        style={{
          top: '22%', fontSize: 168, letterSpacing: '0.02em',
          textShadow: '0 0 40px rgba(255,46,136,0.7), 0 6px 0 rgba(0,0,0,0.6)',
          animation: 'koBannerCrash 0.6s cubic-bezier(0.2, 0.9, 0.3, 1)',
        }}
      >
        K.O.
      </div>

      <div
        className="am-label absolute left-0 right-0 text-center"
        style={{ top: '50%', color: w.accent, fontSize: 26, letterSpacing: '0.34em' }}
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
          const hue = ['#FFC23D', '#FF7E10', '#FF2E88', '#FFFFFF'][i % 4]
          return (
            <rect
              key={i}
              x={50}
              y={34}
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
        style={{ top: '12%', opacity: 0.14 }}
      >
        <div style={{ width: 320, height: 460 }}>
          <Sprite fighter={f} side="a" state="win" />
        </div>
      </div>

      {/* Quote card. No entrance keyframe on purpose — StrictMode's
       *  mount→unmount→remount would re-fire it and flash the card. */}
      <div
        className="relative z-10 max-w-3xl"
        style={{
          padding: '38px 44px',
          background: 'linear-gradient(180deg, rgba(12,7,22,0.9), rgba(7,4,14,0.94))',
          borderLeft: `4px solid ${f.accent}`,
          boxShadow: `0 30px 80px rgba(0,0,0,0.6), -18px 0 60px ${f.accent}22`,
          backdropFilter: 'blur(2px)',
        }}
      >
        <div
          style={{ fontFamily: UI, fontWeight: 700, fontSize: 12, letterSpacing: '0.28em', color: f.accent, marginBottom: 16, textTransform: 'uppercase' }}
        >
          Verbatim from {episode}
        </div>
        <p
          style={{ fontFamily: BODY, fontStyle: 'italic', fontSize: 34, lineHeight: 1.28, color: '#F5F0FF', textShadow: '0 2px 12px #000' }}
        >
          &ldquo;{quote}&rdquo;
        </p>
        <div
          style={{ fontFamily: UI, fontWeight: 700, fontSize: 15, letterSpacing: '0.22em', color: f.accent, marginTop: 22, textTransform: 'uppercase' }}
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
        className="am-label"
        style={{ color: 'var(--mm-amber)', fontSize: 22, letterSpacing: '0.34em', marginBottom: 44 }}
      >
        From Lenny&rsquo;s Archive
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-16 gap-y-10">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className="flex flex-col items-center"
            style={{ animation: `attract-pop-in 0.55s ease-out ${i * 0.18}s both` }}
          >
            <div
              style={{
                fontFamily: DISPLAY, color: '#F5F0FF', fontSize: 108, lineHeight: 1,
                transform: 'skewX(-6deg)',
                textShadow: '0 0 26px rgba(255,46,136,0.45), 0 6px 0 rgba(0,0,0,0.5)',
              }}
            >
              {s.num}
            </div>
            <div
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 13, letterSpacing: '0.3em', color: 'var(--mm-amber)', marginTop: 14 }}
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
        className="am-label"
        style={{ color: 'var(--mm-amber)', fontSize: 22, letterSpacing: '0.32em', marginBottom: 26 }}
      >
        {FIGHTERS.length} Operators
      </div>
      <div className="grid grid-cols-7 gap-2 max-w-4xl">
        {FIGHTERS.map((f, i) => (
          <div
            key={f.id}
            className="aspect-square relative"
            style={{
              background: `linear-gradient(180deg, ${f.accent}30, ${f.accent}0D)`,
              border: `1px solid ${f.accent}77`,
              boxShadow: 'inset 0 -18px 30px rgba(0,0,0,0.5)',
              animation: `banner-in 0.5s ease-out ${(i * 0.04)}s both`,
            }}
          >
            <Sprite fighter={f} side="a" state="stance" />
            <div
              className="absolute left-0 right-0 bottom-0 text-center truncate"
              style={{ fontFamily: UI, fontWeight: 700, fontSize: 8, letterSpacing: '0.06em', color: '#fff', padding: '2px 0', background: 'rgba(4,2,10,0.82)' }}
            >
              {f.shortName}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
