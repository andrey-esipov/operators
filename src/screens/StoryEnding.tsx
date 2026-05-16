import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useGame } from '../state/game'
import { getFighter } from '../data/fighters'
import { Sprite } from '../components/Sprite'
import { Sfx } from '../lib/audio'
import { Voice } from '../lib/voice'

/**
 * Story Mode career-ending screen. Plays after the final chapter's
 * ending-splash beat has been advanced. Replaces ArcadeVictory.tsx for
 * Story Mode runs.
 *
 * Tier 1: procedural ending using the player's existing stance sprite +
 * their ult.comboTitle (or ult.name) as the tagline + Lenny epitaph text.
 * Tier 2/3: marquee 8 get bespoke ending splash images at
 * `/public/story/endings/{fighterId}.png` rendered instead of the sprite.
 */
export function StoryEnding() {
  const playerFighterId = useGame((s) => s.storyState?.playerFighterId)
  const setPhase = useGame((s) => s.setPhase)
  const resetMatch = useGame((s) => s.resetMatch)

  const playerDef = playerFighterId ? getFighter(playerFighterId) : null

  // Probe for bespoke ending art (marquee 8). Falls back to sprite.
  const [hasSplash, setHasSplash] = useState(false)
  const splashSrc = playerFighterId ? `/story/endings/${playerFighterId}.png` : ''
  useEffect(() => {
    if (!playerFighterId) return
    let cancelled = false
    const img = new Image()
    img.onload = () => { if (!cancelled) setHasSplash(true) }
    img.onerror = () => { if (!cancelled) setHasSplash(false) }
    img.src = splashSrc
    return () => { cancelled = true }
  }, [playerFighterId, splashSrc])

  // Final victory voice line + sting on mount.
  useEffect(() => {
    if (!playerDef) return
    Sfx.victory()
    Voice.say(playerDef.voiceLines.win, playerDef.id, 'win')
  }, [playerDef])

  if (!playerDef) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <button
          onClick={() => { resetMatch(); setPhase('menu') }}
          className="font-display text-base tracking-widest text-white"
        >
          MAIN MENU
        </button>
      </div>
    )
  }

  const accent = playerDef.accent ?? '#FFD60A'
  const tagline = playerDef.ult.comboTitle || playerDef.ult.name

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ background: '#0F0A1A' }}>
      {/* Background — bespoke splash if available, else gradient */}
      {hasSplash ? (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${splashSrc})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            imageRendering: 'pixelated' as const,
            opacity: 0.55,
          }}
        />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(circle at center, ${accent}33 0%, #1A0F2E 60%, #0F0A1A 100%)`,
          }}
        />
      )}

      {/* CRT scanlines */}
      <div
        className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-30"
        style={{
          background:
            'repeating-linear-gradient(0deg, rgba(255,255,255,0.08) 0px, rgba(255,255,255,0.08) 1px, transparent 2px, transparent 4px)',
        }}
      />

      {/* Confetti / particle layer */}
      <Confetti accent={accent} />

      {/* Title */}
      <motion.div
        initial={{ y: -30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.6 }}
        className="absolute top-12 left-0 right-0 text-center z-20"
      >
        <div
          className="font-display tracking-widest"
          style={{
            fontSize: 14,
            letterSpacing: '0.5em',
            color: accent,
            textShadow: '2px 2px 0 black, 0 0 12px ' + accent,
          }}
        >
          ★ END OF SHOW ★
        </div>
        <div
          className="font-display tracking-widest mt-3"
          style={{
            fontSize: 56,
            letterSpacing: '0.16em',
            color: '#FFFFFF',
            textShadow: `5px 5px 0 black, 0 0 32px ${accent}`,
            transform: 'skewX(-4deg)',
          }}
        >
          {playerDef.shortName} WINS
        </div>
      </motion.div>

      {/* Stance sprite (only when no bespoke splash) */}
      {!hasSplash && (
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.6, type: 'spring', damping: 14 }}
          className="absolute z-10"
          style={{
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 340,
            height: 440,
            filter: `drop-shadow(0 0 28px ${accent}) drop-shadow(0 8px 24px rgba(0,0,0,0.7))`,
          }}
        >
          <Sprite fighter={playerDef} side="a" state="win" />
        </motion.div>
      )}

      {/* Tagline — fighter's iconic line */}
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1.1, duration: 0.5 }}
        className="absolute z-20 text-center px-12"
        style={{ bottom: 160, left: 0, right: 0 }}
      >
        <div
          className="font-display tracking-widest"
          style={{
            fontSize: 36,
            letterSpacing: '0.14em',
            color: '#FFFFFF',
            textShadow: `4px 4px 0 black, 0 0 24px ${accent}`,
            transform: 'skewX(-4deg)',
          }}
        >
          {tagline}
        </div>
        <div
          className="font-body italic mt-3 max-w-2xl mx-auto"
          style={{
            fontSize: 18,
            color: 'white',
            textShadow: '2px 2px 0 black',
          }}
        >
          — {playerDef.ult.episode} · {playerDef.ult.timestamp}
        </div>
      </motion.div>

      {/* Action buttons */}
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1.6, duration: 0.4 }}
        className="absolute bottom-12 left-0 right-0 z-20 flex items-center justify-center gap-4"
      >
        <button
          onClick={() => { Sfx.menuSelect(); resetMatch(); setPhase('character-select') }}
          className="px-6 py-3 font-display tracking-widest"
          style={{
            background: `linear-gradient(180deg, ${accent}33, ${accent}11)`,
            color: 'white',
            border: `2px solid ${accent}`,
            boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.5), inset 2px 2px 0 rgba(255,255,255,0.15)',
            fontSize: 11,
            letterSpacing: '0.4em',
          }}
        >
          PLAY AGAIN
        </button>
        <button
          onClick={() => { Sfx.menuMove(); resetMatch(); setPhase('menu') }}
          className="px-6 py-3 font-display tracking-widest"
          style={{
            background: 'rgba(15,10,26,0.7)',
            color: 'white',
            border: '2px solid #3B2360',
            boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.5)',
            fontSize: 11,
            letterSpacing: '0.4em',
          }}
        >
          ← MAIN MENU
        </button>
      </motion.div>
    </div>
  )
}

function Confetti({ accent }: { accent: string }) {
  const colors = [accent, '#FFD60A', '#F72585', '#06D6A0', '#FFFFFF']
  const particles = Array.from({ length: 60 })
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map((_, i) => {
        const left = (i * 17 + 7) % 100
        const delay = (i * 0.13) % 2
        const duration = 4 + ((i * 7) % 6)
        const color = colors[i % colors.length]
        const size = 3 + (i % 4)
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${left}%`,
              top: '-10%',
              width: size,
              height: size,
              background: color,
              animation: `confettiFall ${duration}s ${delay}s linear infinite`,
              boxShadow: `0 0 4px ${color}`,
            }}
          />
        )
      })}
      <style>{`
        @keyframes confettiFall {
          0%   { transform: translateY(0) rotate(0deg); opacity: 1 }
          90%  { opacity: 1 }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0 }
        }
      `}</style>
    </div>
  )
}
