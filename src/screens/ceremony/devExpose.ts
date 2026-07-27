import { useGame } from '../../state/game'
import { initialRuntime } from '../../state/applyMove'
import type { BattleLogEntry, ScenarioId, Side } from '../../types'

// DEV-only: expose the zustand store on window so screenshot/E2E harnesses can
// drive the ceremony screens (round-end, match-end, arcade-victory) into their
// terminal states without simulating a full real-time fight. Tree-shaken out of
// production builds via the import.meta.env.DEV guard.
if (import.meta.env.DEV) {
  ;(window as unknown as { __game?: typeof useGame }).__game = useGame

  // Deterministic ceremony harness. The four ceremony screens are ANIMATIONS,
  // so the screenshot harness needs to (a) drop the store into an exact
  // terminal state and (b) re-mount the target screen at a known t0 so a frame
  // captured N ms later is reproducible. Each helper below sets the full store
  // slice a screen reads, then flips `phase`. To capture a specific animation
  // frame: call reset(), then show(kind), then wait N ms, then screenshot.
  // Because a phase transition remounts the lazy screen, mount == t0.
  //
  // NOTE: several ceremony screens arm their own auto-advance timers on mount
  // (PreFight's startMatch cut, RoundEnd's newRound). The helpers here set
  // state directly instead of calling those actions, so nothing auto-advances
  // and the harness owns the clock.

  type CerKind = 'pre-fight' | 'round-end' | 'match-end' | 'arcade-victory'

  interface CerOpts {
    a?: string
    b?: string
    scenario?: ScenarioId
    round?: 1 | 2 | 3
    winner?: Side
    perfect?: boolean
    boss?: boolean
    mode?: 'vs' | 'arcade' | 'practice' | 'daily' | 'story'
    arcadeStep?: number
  }

  function sampleLog(winner: Side, quote: string, episode: string): BattleLogEntry[] {
    const w = winner
    const l: Side = winner === 'a' ? 'b' : 'a'
    return [
      { attacker: w, defender: l, moveId: 'x', moveName: 'OPENER', finalDamage: 90, quote, episode } as unknown as BattleLogEntry,
      { attacker: w, defender: l, moveId: 'y', moveName: 'RUSH', finalDamage: 140, quote, episode } as unknown as BattleLogEntry,
      { attacker: w, defender: l, moveId: 'z', moveName: 'FINISH', finalDamage: 220, quote, episode } as unknown as BattleLogEntry,
    ]
  }

  const CER = {
    reset() {
      useGame.setState({ phase: 'menu' })
    },

    show(kind: CerKind, opts: CerOpts = {}) {
      const a = opts.a ?? 'chesky'
      const b = opts.b ?? (opts.boss ? 'lenny' : 'doshi')
      const scenario: ScenarioId = opts.scenario ?? 'hypergrowth'
      const winner: Side = opts.winner ?? 'a'
      const mode = opts.mode ?? (kind === 'arcade-victory' ? 'arcade' : 'vs')

      const rtA = initialRuntime(a)
      const rtB = initialRuntime(b)

      if (kind === 'round-end' || kind === 'match-end') {
        const wRt = winner === 'a' ? rtA : rtB
        const lRt = winner === 'a' ? rtB : rtA
        lRt.hp = 0
        wRt.hp = opts.perfect ? wRt.maxHp : Math.round(wRt.maxHp * 0.42)
      }

      const roundsWon =
        kind === 'match-end'
          ? winner === 'a'
            ? { a: 2, b: 1 }
            : { a: 1, b: 2 }
          : winner === 'a'
            ? { a: 1, b: 0 }
            : { a: 0, b: 1 }

      useGame.setState({
        phase: 'menu',
        fighterA: rtA,
        fighterB: rtB,
        selectedA: a,
        selectedB: b,
        scenario,
        round: opts.round ?? (kind === 'pre-fight' ? 1 : 2),
        roundsWon,
        turn: 1,
        activeSide: 'a',
        mode,
        arcadeStep: opts.arcadeStep ?? 0,
        log:
          kind === 'pre-fight'
            ? []
            : sampleLog(winner, 'You found a new pattern. I will add it to the show.', 'ep 308'),
        damagePulses: [],
      })

      const phase =
        kind === 'pre-fight' ? 'pre-fight'
        : kind === 'round-end' ? 'round-end'
        : kind === 'match-end' ? 'match-end'
        : 'arcade-victory'
      requestAnimationFrame(() => useGame.setState({ phase }))
    },
  }

  ;(window as unknown as { __ceremony?: typeof CER }).__ceremony = CER
}
