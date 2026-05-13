import { create } from 'zustand'
import type { FighterRuntime, GameState, Move, ScenarioId, Side } from '../types'
import { getFighter, STARTING_ROSTER } from '../data/fighters'
import { AI_PROFILES } from '../data/ai-profiles'
import { ARCADE_PROGRESSION } from '../data/scenarios'
import { applyMove, initialRuntime, startTurn } from './applyMove'
import { Voice } from '../lib/voice'
import { loadStats, saveStats, checkAndUnlock } from '../data/achievements'

let flashCounter = 0
let damageCounter = 0
let soundCounter = 0

interface Actions {
  startMatch: (a: string, b: string, scenario: ScenarioId) => void
  selectFighters: (a: string, b: string) => void
  setScenario: (s: ScenarioId) => void
  setPhase: (p: GameState['phase']) => void
  toggleCrt: () => void
  toggleMusic: () => void
  toggleVoice: () => void
  /** Active player casts a move */
  castMove: (move: Move) => void
  /** ID of fighter currently shown on the Fighter Spotlight deep-dive page */
  spotlightFighter: string | null
  setSpotlightFighter: (id: string | null) => void
  /** Active player spends 1 momentum to predict opponent's next move type.
   *  If correct, opponent's next attack deals 50% damage and the predictor
   *  gains +20 super meter. Ends the active player's turn. */
  castRead: (type: 'light' | 'heavy' | 'setup' | 'combo' | 'ultimate') => void
  /** AI plays for the current side (used vs. bots) */
  aiPlay: (side: Side) => void
  newRound: () => void
  resetMatch: () => void
  advanceArcade: () => void
  setSelectedSide: (side: Side, id: string) => void
  /** Start arcade mode with a chosen fighter */
  startArcade: (fighterId: string) => void
  /** Continue to next arcade fight */
  nextArcadeFight: () => void
  /** Game mode (vs = hot seat 2P; arcade = vs bots) */
  mode: 'vs' | 'arcade' | 'practice' | 'daily'
  setMode: (m: 'vs' | 'arcade' | 'practice' | 'daily') => void
  /** AI difficulty applied to bots */
  difficulty: 'easy' | 'normal' | 'hard'
  setDifficulty: (d: 'easy' | 'normal' | 'hard') => void
  /** Start practice mode against a chosen fighter */
  startPractice: (player: string, opponent: string) => void
  /** Start daily challenge (date-seeded matchup) */
  startDaily: () => void
  /** Start a random matchup */
  startRandom: () => void
}

export const useGame = create<GameState & Actions>((set, get) => ({
  phase: 'menu',
  fighterA: null,
  fighterB: null,
  scenario: 'pre-pmf',
  round: 1,
  roundsWon: { a: 0, b: 0 },
  turn: 1,
  activeSide: 'a',
  log: [],
  selectedA: null,
  selectedB: null,
  arcadeStep: 0,
  quoteBank: [],
  crtEnabled: true,
  musicEnabled: true,
  voiceEnabled: true,
  damagePulses: [],
  mode: 'vs',
  difficulty: 'normal',
  spotlightFighter: null,

  setPhase: (p) => set({ phase: p }),
  toggleCrt: () => set((s) => ({ crtEnabled: !s.crtEnabled })),
  toggleMusic: () => set((s) => ({ musicEnabled: !s.musicEnabled })),
  toggleVoice: () => set((s) => {
    const next = !s.voiceEnabled
    Voice.setEnabled(next)
    return { voiceEnabled: next }
  }),
  setScenario: (s) => set({ scenario: s }),
  setSelectedSide: (side, id) => set(() => side === 'a' ? { selectedA: id } : { selectedB: id }),
  selectFighters: (a, b) => set({ selectedA: a, selectedB: b }),
  setMode: (m) => set({ mode: m }),
  setDifficulty: (d) => set({ difficulty: d }),
  setSpotlightFighter: (id) => set({ spotlightFighter: id }),

  startPractice: (player, opponent) => {
    set({
      mode: 'practice',
      phase: 'pre-fight',
      fighterA: initialRuntime(player),
      fighterB: initialRuntime(opponent),
      round: 1,
      roundsWon: { a: 0, b: 0 },
      turn: 1,
      activeSide: 'a',
      log: [],
      damagePulses: [],
      selectedA: player,
      selectedB: opponent,
    })
    setTimeout(() => set({ phase: 'fight' }), 2400)
  },

  startDaily: () => {
    // Daily challenge: seed from today's date (UTC). Same matchup for everyone.
    const today = new Date().toISOString().slice(0, 10)  // 'YYYY-MM-DD'
    let h = 0
    for (let i = 0; i < today.length; i++) h = (h * 31 + today.charCodeAt(i)) >>> 0
    const all = STARTING_ROSTER
    const player = all[h % all.length]
    const oppPool = all.filter((x: string) => x !== player)
    const opponent = oppPool[(h >>> 7) % oppPool.length]
    const scenarios = ['pre-pmf', 'hypergrowth', 'plateau', 'ai-native', 'monetization', 'crisis', 'ipo-prep', 'distribution'] as const
    const scenario = scenarios[(h >>> 13) % scenarios.length]
    set({
      mode: 'daily',
      phase: 'pre-fight',
      fighterA: initialRuntime(player),
      fighterB: initialRuntime(opponent),
      round: 1,
      roundsWon: { a: 0, b: 0 },
      turn: 1,
      activeSide: 'a',
      log: [],
      damagePulses: [],
      selectedA: player,
      selectedB: opponent,
      scenario,
    })
    setTimeout(() => set({ phase: 'fight' }), 4200)
  },

  startRandom: () => {
    // Random matchup — random player, random bot opponent, random scenario.
    // Uses 'daily' mode semantics (single fight, bot AI, no resource refill).
    const all = STARTING_ROSTER
    const player = all[Math.floor(Math.random() * all.length)]
    const oppPool = all.filter((x) => x !== player)
    const opponent = oppPool[Math.floor(Math.random() * oppPool.length)]
    const scenarios = ['pre-pmf', 'hypergrowth', 'plateau', 'ai-native', 'monetization', 'crisis', 'ipo-prep', 'distribution'] as const
    const scenario = scenarios[Math.floor(Math.random() * scenarios.length)]
    set({
      mode: 'daily',
      phase: 'pre-fight',
      fighterA: initialRuntime(player),
      fighterB: initialRuntime(opponent),
      round: 1,
      roundsWon: { a: 0, b: 0 },
      turn: 1,
      activeSide: 'a',
      log: [],
      damagePulses: [],
      selectedA: player,
      selectedB: opponent,
      scenario,
    })
    setTimeout(() => set({ phase: 'fight' }), 4200)
  },

  startArcade: (fighterId: string) => {
    set({ mode: 'arcade', arcadeStep: 0, selectedA: fighterId })
    // First arcade fight setup
    setTimeout(() => get().nextArcadeFight(), 200)
  },

  nextArcadeFight: () => {
    const state = get()
    const step = state.arcadeStep
    const progression = ARCADE_PROGRESSION
    if (step >= progression.length) {
      // Arcade run completion bookkeeping
      const av = loadStats()
      av.arcadeRunsCompleted += 1
      saveStats(av)
      checkAndUnlock(av)
      set({ phase: 'arcade-victory' })
      return
    }
    const { scenario, opponentId: declaredOpp } = progression[step]
    const playerId = state.selectedA
    if (!playerId) return
    // If declared opponent is the player themselves, fall back to another fighter for the stage
    let opponentId = declaredOpp
    if (opponentId === playerId) {
      const fallbackOrder = ['cagan', 'doshi', 'spiegel', 'turley', 'madhavan', 'catwu', 'chesky', 'lenny']
      opponentId = fallbackOrder.find((id) => id !== playerId) ?? 'doshi'
    }
    set({
      mode: 'arcade',
      phase: 'pre-fight',
      fighterA: initialRuntime(playerId),
      fighterB: initialRuntime(opponentId),
      scenario,
      round: 1,
      roundsWon: { a: 0, b: 0 },
      turn: 1,
      activeSide: 'a',
      log: [],
      damagePulses: [],
      selectedB: opponentId,
    })
    setTimeout(() => set({ phase: 'fight' }), 4200)
  },

  startMatch: (a, b, scenario) => {
    set({
      phase: 'pre-fight',
      fighterA: initialRuntime(a),
      fighterB: initialRuntime(b),
      scenario,
      round: 1,
      roundsWon: { a: 0, b: 0 },
      turn: 1,
      activeSide: 'a',
      log: [],
      damagePulses: [],
      selectedA: a,
      selectedB: b,
    })
    // After cinematic pre-fight beat (stage reveal), the screen transitions to 'fight'
    setTimeout(() => {
      set({ phase: 'fight' })
      // Both fighters quote their match-start line. Stagger so they don't overlap.
      const defA = getFighter(a); const defB = getFighter(b)
      if (defA) Voice.say(defA.voiceLines.matchStart, a, 'matchStart')
      if (defB) setTimeout(() => Voice.say(defB.voiceLines.matchStart, b, 'matchStart'), 1800)
    }, 4200)
  },

  newRound: () => {
    const { selectedA, selectedB, roundsWon } = get()
    if (!selectedA || !selectedB) return
    const nextRound = (get().round + 1) as 1 | 2 | 3
    // initialRuntime gives fresh cooldowns/reads, so ult is castable again each round
    set({
      fighterA: initialRuntime(selectedA),
      fighterB: initialRuntime(selectedB),
      round: nextRound,
      turn: 1,
      activeSide: 'a',
      log: [],
      damagePulses: [],
      phase: 'pre-fight',
      roundsWon, // preserved
    })
    setTimeout(() => set({ phase: 'fight' }), 2400)
  },

  resetMatch: () => {
    set({
      phase: 'menu',
      fighterA: null,
      fighterB: null,
      scenario: 'pre-pmf',
      round: 1,
      roundsWon: { a: 0, b: 0 },
      turn: 1,
      activeSide: 'a',
      log: [],
      damagePulses: [],
      selectedA: null,
      selectedB: null,
      arcadeStep: 0,
    })
  },

  advanceArcade: () => {
    set((s) => ({ arcadeStep: s.arcadeStep + 1 }))
  },

  castMove: (move: Move) => {
    const state = get()
    if (state.phase !== 'fight') return
    const attackerSide = state.activeSide
    const defenderSide: Side = attackerSide === 'a' ? 'b' : 'a'
    const attackerRuntime = attackerSide === 'a' ? state.fighterA : state.fighterB
    const defenderRuntime = defenderSide === 'a' ? state.fighterA : state.fighterB
    if (!attackerRuntime || !defenderRuntime) return

    const attackerDef = getFighter(attackerRuntime.defId)!
    const defenderDef = getFighter(defenderRuntime.defId)!

    const result = applyMove({
      attackerSide,
      attackerDef,
      defenderDef,
      attackerRuntime,
      defenderRuntime,
      move,
      scenario: state.scenario,
      turn: state.turn,
    })

    if (result.rejected) {
      // Could surface a toast / shake but for now just no-op
      return
    }

    const flashId = ++flashCounter
    const dmgId = ++damageCounter
    const sndId = ++soundCounter

    const newA = attackerSide === 'a' ? result.attacker : result.defender
    const newB = attackerSide === 'a' ? result.defender : result.attacker

    set({
      fighterA: newA,
      fighterB: newB,
      log: [...state.log, result.log],
      lastFlash: result.flash ? { kind: result.flash, side: attackerSide, id: flashId } : state.lastFlash,
      soundCue: { kind: result.flash ?? (result.log.finalDamage > 70 ? 'heavy' : 'light'), id: sndId },
      damagePulses: [
        ...state.damagePulses.filter((d) => Date.now() - d.id < 1200),
        { id: dmgId, side: defenderSide, amount: result.log.finalDamage, kind: result.flash === 'crit' ? 'crit' : 'normal' },
      ],
      quoteBank: result.log.appliedStatuses.length > 0 || result.log.finalDamage > 0
        ? [...state.quoteBank, { fighterId: attackerDef.id, moveId: move.id, ts: Date.now() }]
        : state.quoteBank,
    })

    // Voice line on key moments — ult lines and K.O. lines.
    if (result.flash === 'ult') {
      Voice.say(attackerDef.voiceLines.ult, attackerDef.id, 'ult')
    }

    // Stats: every move counts. Combo / crit / ult specifically tracked.
    const stats = loadStats()
    if (result.flash === 'combo') stats.totalCombos += 1
    if (result.flash === 'crit') stats.totalCrits += 1
    if (result.flash === 'ult') stats.totalUlts += 1
    if (result.log.appliedStatuses.length > 0 || result.log.finalDamage > 0) {
      stats.totalQuotes = Math.max(stats.totalQuotes, get().quoteBank.length + 1)
    }
    saveStats(stats)
    checkAndUnlock(stats)

    if (result.ko) {
      Voice.say(attackerDef.voiceLines.ko, attackerDef.id, 'ko')
      // K.O. + match-win bookkeeping
      const ks = loadStats()
      ks.totalKOs += 1
      saveStats(ks)
      checkAndUnlock(ks)
      // Trigger the K.O. cinematic overlay. The CombatScreen reads
      // koCinematic and runs a 2.4s sequence: slow-mo + white flash +
      // K.O. banner + particle burst. Then we transition to round/match end.
      flashCounter++
      const koId = flashCounter
      set({
        koCinematic: {
          winner: attackerSide,
          loser: defenderSide,
          comboTitle: result.log.comboTitle,
          id: koId,
        },
      })

      const newRoundsWon = {
        a: state.roundsWon.a + (attackerSide === 'a' ? 1 : 0),
        b: state.roundsWon.b + (attackerSide === 'b' ? 1 : 0),
      }
      const matchWinner = newRoundsWon.a >= 2 ? 'a' : newRoundsWon.b >= 2 ? 'b' : null

      // Match-end stats — only count when the match (not just a round) ends.
      if (matchWinner) {
        const ms = loadStats()
        ms.totalMatches += 1
        const playerWon = matchWinner === 'a'  // side A is always the player in single-player modes
        if (playerWon && state.mode !== 'vs') {
          ms.totalWins += 1
          // Track which fighters player has won as
          if (state.selectedA && !ms.fightersUsed.includes(state.selectedA)) {
            ms.fightersUsed.push(state.selectedA)
          }
          // Track which fighters player has beaten
          if (state.selectedB && !ms.fightersBeaten.includes(state.selectedB)) {
            ms.fightersBeaten.push(state.selectedB)
          }
          if (state.selectedB === 'lenny') {
            ms.lennyDefeats += 1
            if (state.difficulty === 'hard') ms.hardModeWins += 1
          }
        }
        saveStats(ms)
        checkAndUnlock(ms)
      }

      setTimeout(() => {
        set({
          phase: matchWinner ? 'match-end' : 'round-end',
          roundsWon: newRoundsWon,
          koCinematic: undefined,
        })
      }, 2400)
      return
    }

    // Advance turn — switch active side, run start-turn for new active
    const nextActive: Side = defenderSide
    const target = nextActive === 'a' ? newA : newB
    if (!target) return
    const turnStart = startTurn(target)

    let updatedTarget = turnStart.runtime
    // PRACTICE MODE: player (side A) always has full resources + topped HP
    // so they can experiment with the entire move kit freely.
    if (state.mode === 'practice' && nextActive === 'a') {
      updatedTarget = {
        ...updatedTarget,
        momentum: 10,
        superMeter: 100,
        hp: Math.max(updatedTarget.hp, Math.round(updatedTarget.maxHp * 0.8)),
      }
    }

    setTimeout(() => {
      set((s) => ({
        activeSide: nextActive,
        turn: s.turn + 1,
        fighterA: nextActive === 'a' ? updatedTarget : s.fighterA,
        fighterB: nextActive === 'b' ? updatedTarget : s.fighterB,
      }))
    }, 700)
  },

  castRead: (type) => {
    const state = get()
    if (state.phase !== 'fight') return
    const side = state.activeSide
    const me = side === 'a' ? state.fighterA : state.fighterB
    if (!me) return
    if (me.momentum < 1) return  // need 1 momentum

    // Spend 1 momentum, set the read on self. ApplyMove checks the defender's
    // (= active side's, now the opponent's) `read` field next turn.
    const updatedMe: FighterRuntime = {
      ...me,
      momentum: me.momentum - 1,
      read: type,
    }

    // Advance turn — same machinery as castMove, minus damage/log
    const nextActive: Side = side === 'a' ? 'b' : 'a'
    const otherRt = nextActive === 'a' ? state.fighterA : state.fighterB
    if (!otherRt) return
    const turnStart = startTurn(otherRt)
    let updatedOther = turnStart.runtime
    if (state.mode === 'practice' && nextActive === 'a') {
      updatedOther = {
        ...updatedOther,
        momentum: 10,
        superMeter: 100,
        hp: Math.max(updatedOther.hp, Math.round(updatedOther.maxHp * 0.8)),
      }
    }

    // Sound + small flash to confirm the read landed
    soundCounter++
    const sndId = soundCounter
    set({
      fighterA: side === 'a' ? updatedMe : (nextActive === 'a' ? updatedOther : state.fighterA),
      fighterB: side === 'b' ? updatedMe : (nextActive === 'b' ? updatedOther : state.fighterB),
      soundCue: { kind: 'read', id: sndId },
    })
    setTimeout(() => {
      set((s) => ({
        activeSide: nextActive,
        turn: s.turn + 1,
      }))
    }, 500)
  },

  aiPlay: (side: Side) => {
    const state = get()
    if (state.phase !== 'fight' || state.activeSide !== side) return
    const rt = side === 'a' ? state.fighterA : state.fighterB
    const oppRt = side === 'a' ? state.fighterB : state.fighterA
    if (!rt || !oppRt) return
    const def = getFighter(rt.defId)!

    // AI personality: weighted random move selection.
    // Reject moves on cooldown so the bot doesn't repeat-spam heavy.
    const allMoves: Move[] = [...def.moves, def.ult]
    const affordable = allMoves.filter((m) => {
      if (rt.momentum < m.momentum) return false
      if (m.type === 'ultimate' && rt.superMeter < 100) return false
      if (m.requiresSelfStatus && !rt.status.some((s) => s.key === m.requiresSelfStatus)) return false
      if ((rt.cooldowns[m.id] ?? 0) > 0) return false
      return true
    })

    if (affordable.length === 0) {
      // Force pass: light attack of 0 momentum cost — synthesize a "wait" by ending turn
      // We'll just play the cheapest move forcibly (light) — usually momentum 1
      const cheapest = [...def.moves].sort((a, b) => a.momentum - b.momentum)[0]
      if (cheapest && rt.momentum >= cheapest.momentum) {
        get().castMove(cheapest)
        return
      }
      // Otherwise we just skip the turn by advancing
      const nextSide: Side = side === 'a' ? 'b' : 'a'
      const target = nextSide === 'a' ? state.fighterA : state.fighterB
      if (!target) return
      const turnStart = startTurn(target)
      set((s) => ({
        activeSide: nextSide,
        turn: s.turn + 1,
        fighterA: nextSide === 'a' ? turnStart.runtime : s.fighterA,
        fighterB: nextSide === 'b' ? turnStart.runtime : s.fighterB,
      }))
      return
    }

    // Per-fighter AI profile (falls back to neutral) + global difficulty.
    const profile = AI_PROFILES[def.id] ?? def.ai ?? {
      aggression: 1.0, comboFocus: 1.0, ultRush: 1.0, defensiveBias: 0.0,
    }
    const difficulty = state.difficulty
    const lowHp = rt.hp / rt.maxHp < 0.3

    // Base weights (Normal). Easy = flatter, Hard = greedier.
    const baseW: Record<string, number> = difficulty === 'easy'
      ? { ultimate: 3, heavy: 3, combo: 3, setup: 3, light: 4 }
      : difficulty === 'hard'
      ? { ultimate: 18, heavy: 8, combo: 7, setup: 3, light: 2 }
      : { ultimate: 10, heavy: 5, combo: 4, setup: 3, light: 2 }

    // Apply personality multipliers
    const weights: Record<string, number> = {
      light: baseW.light,
      setup: baseW.setup,
      combo: baseW.combo * profile.comboFocus,
      heavy: baseW.heavy * profile.aggression,
      ultimate: baseW.ultimate * profile.aggression * profile.ultRush,
    }

    // Defensive bias when low HP — boost light + setup
    if (lowHp && profile.defensiveBias > 0) {
      weights.light *= 1 + profile.defensiveBias * 2
      weights.setup *= 1 + profile.defensiveBias * 1.5
      weights.ultimate *= 1 + profile.defensiveBias * 0.5  // still want to clutch ult
    }

    // Hard difficulty: prefer combo chains when setup was just played.
    if (difficulty === 'hard' && rt.lastMoveId) {
      for (const m of affordable) {
        if (m.combosFrom?.includes(rt.lastMoveId)) {
          weights[m.type] *= 3
        }
      }
    }

    // Hard difficulty: sometimes spend 1 momentum to READ the player's
    // likely next move type. We bias toward the player's most-played type
    // in this match (from the log).
    if (difficulty === 'hard' && rt.momentum >= 2 && !rt.read && Math.random() < 0.25) {
      const playerSide: Side = side === 'a' ? 'b' : 'a'
      const playerLog = state.log.filter((l) => l.attacker === playerSide)
      if (playerLog.length >= 2) {
        const counts: Record<string, number> = {}
        for (const l of playerLog) {
          // Look up move type by id on the player's def
          const pDef = getFighter((playerSide === 'a' ? state.fighterA : state.fighterB)!.defId)
          const m = pDef ? [...pDef.moves, pDef.ult].find((x) => x.id === l.moveId) : null
          if (m) counts[m.type] = (counts[m.type] ?? 0) + 1
        }
        const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
        if (best) {
          get().castRead(best[0] as 'light' | 'heavy' | 'setup' | 'combo' | 'ultimate')
          return
        }
      }
    }

    const weighted = affordable.flatMap((m) => Array(Math.max(1, Math.round(weights[m.type] ?? 1))).fill(m))
    const choice = weighted[Math.floor(Math.random() * weighted.length)]
    get().castMove(choice)
  },
}))
