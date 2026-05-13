import { useEffect, useState, useMemo } from 'react'
import { useGame } from '../state/game'
import { getFighter } from '../data/fighters'
import { pickQuoteForMove } from '../lib/quotePool'
import type { Move } from '../types'
import { Sprite } from '../components/Sprite'
import { HpBar } from '../components/HpBar'
import { SuperMeter } from '../components/SuperMeter'
import { MomentumBar } from '../components/MomentumBar'
import { MoveCard } from '../components/MoveCard'
import { StageBackground } from '../components/StageBackground'
import { ComboBanner } from '../components/ComboBanner'
import { DamageFloats } from '../components/DamageFloat'
import { StatusChip } from '../components/StatusChip'
import { Sfx } from '../lib/audio'
import { AnimatePresence, motion } from 'framer-motion'

export function CombatScreen({ mode = 'vs' }: { mode?: 'vs' | 'arcade' }) {
  const fighterA = useGame((s) => s.fighterA)
  const fighterB = useGame((s) => s.fighterB)
  const scenario = useGame((s) => s.scenario)
  const round = useGame((s) => s.round)
  const roundsWon = useGame((s) => s.roundsWon)
  const activeSide = useGame((s) => s.activeSide)
  const log = useGame((s) => s.log)
  const lastFlash = useGame((s) => s.lastFlash)
  const soundCue = useGame((s) => s.soundCue)
  const damagePulses = useGame((s) => s.damagePulses)
  const castMove = useGame((s) => s.castMove)
  const aiPlay = useGame((s) => s.aiPlay)

  const [timeLeft, setTimeLeft] = useState(90)
  const [comboBanner, setComboBanner] = useState<{ title: string; kind: 'combo' | 'ult' | 'crit' } | null>(null)
  const [hitFlash, setHitFlash] = useState<'crit' | 'combo' | 'ult' | null>(null)
  const [shaking, setShaking] = useState(false)
  const [lastQuote, setLastQuote] = useState<{ q: string; ep: string; t: string; name: string } | null>(null)
  /** Which side is currently in attack-pose (briefly after casting) */
  const [attackingSide, setAttackingSide] = useState<'a' | 'b' | null>(null)
  const resetMatch = useGame((s) => s.resetMatch)

  // ESC key to quit to menu
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') resetMatch()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [resetMatch])

  // Audio cues
  useEffect(() => {
    if (!soundCue) return
    switch (soundCue.kind) {
      case 'crit': Sfx.crit(); break
      case 'combo': Sfx.combo(); break
      case 'ult': Sfx.ult(); break
      case 'heavy': Sfx.heavy(); break
      default: Sfx.light()
    }
  }, [soundCue?.id])

  // Combat log effects: combo banner + hit flash + screen shake + quote callout
  useEffect(() => {
    if (log.length === 0) return
    const last = log[log.length - 1]
    if (last.comboTitle) {
      setComboBanner({ title: last.comboTitle, kind: last.flash ?? 'combo' })
      setTimeout(() => setComboBanner(null), 2400)
    }
    if (last.flash) {
      setHitFlash(last.flash)
      setTimeout(() => setHitFlash(null), 200)
    }
    if (last.finalDamage > 50) {
      setShaking(true)
      setTimeout(() => setShaking(false), 220)
    }
    if (last.quote) {
      const att = last.attacker === 'a' ? fighterA : fighterB
      const def = att ? getFighter(att.defId) : null
      // Rotate quotes per cast — 40% chance pull from fighter's verbatim quote pool
      const fighterIdForQuote = att?.defId
      const moveForQuote = def ? [...def.moves, def.ult].find((m) => m.id === last.moveId) : null
      const rotated = fighterIdForQuote && moveForQuote
        ? pickQuoteForMove(fighterIdForQuote, moveForQuote)
        : { quote: last.quote, episode: last.episode, timestamp: last.timestamp }
      setLastQuote({
        q: rotated.quote,
        ep: rotated.episode || last.episode,
        t: rotated.timestamp || last.timestamp,
        name: def?.shortName ?? '',
      })
      // Read time: short quotes get less, long ones get more. 4.5s - 6s.
      const readTime = Math.min(6500, Math.max(4500, rotated.quote.length * 60))
      setTimeout(() => setLastQuote(null), readTime)
    }
    // Attack sprite pose: briefly switch the attacker to attack frame
    setAttackingSide(last.attacker)
    setTimeout(() => setAttackingSide(null), 350)
  }, [log.length])

  // Round timer
  useEffect(() => {
    setTimeLeft(90)
    const id = setInterval(() => setTimeLeft((t) => Math.max(0, t - 1)), 1000)
    return () => clearInterval(id)
  }, [round])

  // Timer expiry → higher-HP side wins the round
  useEffect(() => {
    if (timeLeft !== 0) return
    if (!fighterA || !fighterB) return
    // Trigger the same end-of-round path that K.O. uses
    const winner: 'a' | 'b' = fighterA.hp >= fighterB.hp ? 'a' : 'b'
    useGame.setState((s) => ({
      phase: s.roundsWon.a + (winner === 'a' ? 1 : 0) >= 2 || s.roundsWon.b + (winner === 'b' ? 1 : 0) >= 2 ? 'match-end' : 'round-end',
      roundsWon: {
        a: s.roundsWon.a + (winner === 'a' ? 1 : 0),
        b: s.roundsWon.b + (winner === 'b' ? 1 : 0),
      },
      // Synthesize a "time-up" log entry so RoundEnd shows something useful
      log: [...s.log, {
        turn: s.turn,
        attacker: winner,
        moveId: 'time-up',
        moveName: 'TIME UP',
        baseDamage: 0,
        scenarioMultiplier: 1,
        comboBonus: 0,
        critMultiplier: 1,
        finalDamage: 0,
        hpAfter: { a: fighterA.hp, b: fighterB.hp },
        quote: 'Time wins arguments.',
        episode: 'host',
        timestamp: 'TIME',
        appliedStatuses: [],
      }],
    }))
  }, [timeLeft, fighterA, fighterB])

  // Bot AI for player B in arcade mode
  useEffect(() => {
    if (mode !== 'arcade') return
    if (activeSide !== 'b') return
    const id = setTimeout(() => aiPlay('b'), 1200 + Math.random() * 600)
    return () => clearTimeout(id)
  }, [activeSide, mode, aiPlay])

  if (!fighterA || !fighterB) return null
  const a = getFighter(fighterA.defId)!
  const b = getFighter(fighterB.defId)!

  const aSuperReady = fighterA.superMeter >= 100
  const bSuperReady = fighterB.superMeter >= 100

  return (
    <div className={`relative w-full h-full overflow-hidden ${shaking ? 'shake' : ''}`}>
      {/* Stage background */}
      <StageBackground scenario={scenario} shake={shaking} />

      {/* Hit flash overlay */}
      <AnimatePresence>
        {hitFlash && (
          <motion.div
            key={lastFlash?.id ?? 'flash'}
            initial={{ opacity: 0.85 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute inset-0 z-30 pointer-events-none"
            style={{
              background:
                hitFlash === 'ult'
                  ? '#F72585'
                  : hitFlash === 'crit'
                  ? '#FFFFFF'
                  : '#FFD60A',
            }}
          />
        )}
      </AnimatePresence>

      {/* TOP HUD */}
      <div className="absolute left-0 right-0 top-0 z-20 px-6 pt-3 flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <HpBar hp={fighterA.hp} maxHp={fighterA.maxHp} side="a" name={a.shortName} />
          <div className="flex items-center gap-4 mt-1">
            <SuperMeter value={fighterA.superMeter} side="a" />
            <MomentumBar value={fighterA.momentum} side="a" />
          </div>
          <div className="flex gap-1 mt-1">
            {fighterA.status.map((s) => <StatusChip key={s.key} status={s} />)}
          </div>
        </div>

        <div className="flex flex-col items-center pt-2">
          <div className="font-display text-[10px] tracking-widest text-white/70">
            ROUND {round}/3
          </div>
          <div className="flex gap-2 mt-1">
            <span style={{ width: 12, height: 12, background: roundsWon.a > 0 ? '#E63946' : '#2A1F33', border: '1px solid white' }} />
            <span style={{ width: 12, height: 12, background: roundsWon.b > 0 ? '#00B4D8' : '#2A1F33', border: '1px solid white' }} />
          </div>
          <div className="font-num text-5xl tabular-nums mt-2" style={{ color: timeLeft < 15 ? '#EF233C' : '#FFD60A', textShadow: '3px 3px 0 black' }}>
            {timeLeft}
          </div>
        </div>

        <div className="flex flex-col gap-1 items-end">
          <HpBar hp={fighterB.hp} maxHp={fighterB.maxHp} side="b" name={b.shortName} />
          <div className="flex items-center gap-4 mt-1 flex-row-reverse">
            <SuperMeter value={fighterB.superMeter} side="b" />
            <MomentumBar value={fighterB.momentum} side="b" />
          </div>
          <div className="flex gap-1 mt-1 flex-row-reverse">
            {fighterB.status.map((s) => <StatusChip key={s.key} status={s} />)}
          </div>
        </div>
      </div>

      {/* Quit button (top-right) */}
      <button
        onClick={() => {
          Sfx.menuMove()
          resetMatch()
        }}
        className="absolute top-2 right-2 z-30 px-2 py-1 font-display text-[7px] tracking-widest text-white/60 hover:text-white"
        title="ESC to quit"
        style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.2)' }}
      >
        QUIT [ESC]
      </button>

      {/* FIGHTERS */}
      <div className="absolute left-0 right-0 z-10" style={{ bottom: 200 }}>
        <div className="flex items-end justify-between px-12 md:px-20">
          <div style={{
            width: 340, height: 440,
            filter: activeSide === 'a' ? 'drop-shadow(0 0 16px #FFD60A)' : 'drop-shadow(0 8px 16px rgba(0,0,0,0.6))',
            transition: 'filter 0.2s',
          }}>
            <Sprite
              fighter={a}
              side="a"
              state={
                fighterA.hp <= 0
                  ? 'lose'
                  : attackingSide === 'a'
                  ? (lastFlash?.kind === 'ult' ? 'ult' : 'attack')
                  : 'stance'
              }
              shake={shaking && damagePulses[damagePulses.length-1]?.side === 'a'}
            />
          </div>
          <div style={{
            width: 340, height: 440,
            filter: activeSide === 'b' ? 'drop-shadow(0 0 16px #FFD60A)' : 'drop-shadow(0 8px 16px rgba(0,0,0,0.6))',
            transition: 'filter 0.2s',
          }}>
            <Sprite
              fighter={b}
              side="b"
              state={
                fighterB.hp <= 0
                  ? 'lose'
                  : attackingSide === 'b'
                  ? (lastFlash?.kind === 'ult' ? 'ult' : 'attack')
                  : 'stance'
              }
              shake={shaking && damagePulses[damagePulses.length-1]?.side === 'b'}
            />
          </div>
        </div>
      </div>

      {/* Damage floats */}
      <DamageFloats pulses={damagePulses} />

      {/* Quote callout (real podcast quote) */}
      <AnimatePresence>
        {lastQuote && (
          <motion.div
            key={lastQuote.q}
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -30, opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute left-1/2 z-20 -translate-x-1/2 px-6 py-3 max-w-2xl text-center"
            style={{
              top: '46%',
              background: 'rgba(15,10,26,0.92)',
              border: '2px solid #FFD60A',
              boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.5), inset 2px 2px 0 rgba(255,255,255,0.1), 0 0 24px rgba(255,214,10,0.4)',
            }}
          >
            <div className="font-body text-2xl text-white leading-snug italic">
              "{lastQuote.q}"
            </div>
            <div className="font-display text-[8px] tracking-widest mt-2" style={{ color: '#FFD60A' }}>
              — {lastQuote.name} · {lastQuote.ep} · {lastQuote.t}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Combo banner */}
      <ComboBanner title={comboBanner?.title ?? null} kind={comboBanner?.kind} />

      {/* MOVE BAR */}
      <ActiveMoves
        side={activeSide}
        fighterA={fighterA}
        fighterB={fighterB}
        onCast={(m) => castMove(m)}
        mode={mode}
        aSuperReady={aSuperReady}
        bSuperReady={bSuperReady}
      />
    </div>
  )
}

function ActiveMoves({
  side,
  fighterA,
  fighterB,
  onCast,
  mode,
  aSuperReady,
  bSuperReady,
}: {
  side: 'a' | 'b'
  fighterA: NonNullable<ReturnType<typeof useGame.getState>['fighterA']>
  fighterB: NonNullable<ReturnType<typeof useGame.getState>['fighterB']>
  onCast: (m: Move) => void
  mode: 'vs' | 'arcade'
  aSuperReady: boolean
  bSuperReady: boolean
}) {
  const activeRt = side === 'a' ? fighterA : fighterB
  const def = useMemo(() => getFighter(activeRt.defId)!, [activeRt.defId])
  const superReady = side === 'a' ? aSuperReady : bSuperReady

  const showHumanControls = !(mode === 'arcade' && side === 'b')

  return (
    <div className="absolute left-0 right-0 bottom-0 z-20 px-6 pb-4">
      {showHumanControls ? (
        <>
          <div className="font-display text-[10px] tracking-widest text-center mb-2" style={{ color: side === 'a' ? '#E63946' : '#00B4D8' }}>
            P{side === 'a' ? '1' : '2'} · {def.shortName} · CHOOSE MOVE
          </div>
          <div className="flex gap-2 flex-wrap justify-center">
            {def.moves.map((m) => (
              <MoveCard
                key={m.id}
                move={m}
                canAfford={activeRt.momentum >= m.momentum}
                lastMoveId={activeRt.lastMoveId}
                onClick={() => onCast(m)}
              />
            ))}
            <MoveCard
              move={def.ult}
              canAfford={activeRt.momentum >= def.ult.momentum}
              isUltimate
              superReady={superReady}
              hasRequiredStatus={
                !def.ult.requiresSelfStatus ||
                activeRt.status.some((s) => s.key === def.ult.requiresSelfStatus)
              }
              lastMoveId={activeRt.lastMoveId}
              onClick={() => onCast(def.ult)}
            />
          </div>
        </>
      ) : (
        <div className="text-center font-display text-base tracking-widest text-white/60 py-6 animate-pulse">
          {def.shortName} IS THINKING...
        </div>
      )}
    </div>
  )
}
