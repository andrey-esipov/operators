import { create } from 'zustand'
import type { GameState, Move, ScenarioId, Side } from '../types'
import { getFighter } from '../data/fighters'
import { applyMove, initialRuntime, startTurn } from './applyMove'

let flashCounter = 0
let damageCounter = 0
let soundCounter = 0

interface Actions {
  startMatch: (a: string, b: string, scenario: ScenarioId) => void
  selectFighters: (a: string, b: string) => void
  setScenario: (s: ScenarioId) => void
  setPhase: (p: GameState['phase']) => void
  toggleCrt: () => void
  /** Active player casts a move */
  castMove: (move: Move) => void
  /** AI plays for the current side (used vs. bots) */
  aiPlay: (side: Side) => void
  newRound: () => void
  resetMatch: () => void
  advanceArcade: () => void
  setSelectedSide: (side: Side, id: string) => void
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
  damagePulses: [],

  setPhase: (p) => set({ phase: p }),
  toggleCrt: () => set((s) => ({ crtEnabled: !s.crtEnabled })),
  setScenario: (s) => set({ scenario: s }),
  setSelectedSide: (side, id) => set(() => side === 'a' ? { selectedA: id } : { selectedB: id }),
  selectFighters: (a, b) => set({ selectedA: a, selectedB: b }),

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
    // After short delay, the screen transitions to 'fight'
    setTimeout(() => set({ phase: 'fight' }), 1400)
  },

  newRound: () => {
    const { selectedA, selectedB, roundsWon } = get()
    if (!selectedA || !selectedB) return
    const nextRound = (get().round + 1) as 1 | 2 | 3
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
    setTimeout(() => set({ phase: 'fight' }), 1200)
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

    if (result.ko) {
      // round end
      const newRoundsWon = {
        a: state.roundsWon.a + (attackerSide === 'a' ? 1 : 0),
        b: state.roundsWon.b + (attackerSide === 'b' ? 1 : 0),
      }
      const matchWinner = newRoundsWon.a >= 2 ? 'a' : newRoundsWon.b >= 2 ? 'b' : null
      setTimeout(() => {
        set({ phase: matchWinner ? 'match-end' : 'round-end', roundsWon: newRoundsWon })
      }, 1500)
      return
    }

    // Advance turn — switch active side, run start-turn for new active
    const nextActive: Side = defenderSide
    const target = nextActive === 'a' ? newA : newB
    if (!target) return
    const turnStart = startTurn(target)

    const updatedTarget = turnStart.runtime
    setTimeout(() => {
      set((s) => ({
        activeSide: nextActive,
        turn: s.turn + 1,
        fighterA: nextActive === 'a' ? updatedTarget : s.fighterA,
        fighterB: nextActive === 'b' ? updatedTarget : s.fighterB,
      }))
    }, 700)
  },

  aiPlay: (side: Side) => {
    const state = get()
    if (state.phase !== 'fight' || state.activeSide !== side) return
    const rt = side === 'a' ? state.fighterA : state.fighterB
    const oppRt = side === 'a' ? state.fighterB : state.fighterA
    if (!rt || !oppRt) return
    const def = getFighter(rt.defId)!

    // AI personality: weighted random move selection
    const allMoves: Move[] = [...def.moves, def.ult]
    const affordable = allMoves.filter((m) => {
      if (rt.momentum < m.momentum) return false
      if (m.type === 'ultimate' && rt.superMeter < 100) return false
      if (m.requiresSelfStatus && !rt.status.some((s) => s.key === m.requiresSelfStatus)) return false
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

    // Weight moves: prefer ultimates when available, then heavy, then combo, then setup, then light
    const weights: Record<string, number> = {
      ultimate: 10, heavy: 5, combo: 4, setup: 3, light: 2,
    }
    const weighted = affordable.flatMap((m) => Array(weights[m.type] ?? 1).fill(m))
    const choice = weighted[Math.floor(Math.random() * weighted.length)]
    get().castMove(choice)
  },
}))
