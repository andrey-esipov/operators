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

  // Warm the lazy screen chunks up front so a phase flip mounts the target
  // screen synchronously (no React.lazy Suspense fallback flashing on the
  // early animation frames the screenshot harness captures).
  const LOADERS: Record<CerKind, () => Promise<unknown>> = {
    'pre-fight': () => import('../PreFight'),
    'round-end': () => import('../RoundEnd'),
    'match-end': () => import('../MatchEnd'),
    'arcade-victory': () => import('../ArcadeVictory'),
  }
  for (const load of Object.values(LOADERS)) void load()

  const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

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

  // Build FULLY-POPULATED entries. An earlier version of this helper cast
  // partial objects through `as unknown as BattleLogEntry`, which silenced tsc
  // and then crashed the renderer on `for (const s of entry.appliedStatuses)`
  // — blanking match-end and arcade-victory so nobody ever reviewed them. The
  // harness must produce data the real sim could produce; no casts.
  function sampleLog(winner: Side, quote: string, episode: string): BattleLogEntry[] {
    const w = winner
    const beats: Array<{ id: string; name: string; dmg: number; extra: Partial<BattleLogEntry> }> = [
      { id: 'x', name: 'OPENER', dmg: 90, extra: {} },
      { id: 'y', name: 'RUSH', dmg: 140, extra: { flash: 'combo', comboBonus: 22, comboTitle: 'TRIPLE THREAT' } },
      { id: 'z', name: 'FINISH', dmg: 220, extra: { flash: 'ult', shattered: true, signature: true } },
    ]
    let hp = 450
    return beats.map(({ id, name, dmg, extra }, i) => {
      hp = Math.max(0, hp - dmg)
      return {
        turn: i + 1,
        attacker: w,
        moveId: id,
        moveName: name,
        baseDamage: dmg,
        scenarioMultiplier: 1,
        comboBonus: 0,
        critMultiplier: 1,
        finalDamage: dmg,
        hpAfter: w === 'a' ? { a: 450, b: hp } : { a: hp, b: 450 },
        quote,
        episode,
        timestamp: new Date(0).toISOString(),
        appliedStatuses: [],
        ...extra,
      } satisfies BattleLogEntry
    })
  }

  const CER = {
    reset() {
      useGame.setState({ phase: 'menu' })
    },

    async show(kind: CerKind, opts: CerOpts = {}) {
      // Ensure the target chunk is resolved before we flip the phase so the
      // screen mounts on the very next frame (t0) with no Suspense flash.
      await LOADERS[kind]()
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
      // Flip on the next frame, then resolve one frame later so the caller's
      // clock (t0) starts exactly when the mounted screen has painted.
      await nextFrame()
      useGame.setState({ phase })
      await nextFrame()
    },
  }

  ;(window as unknown as { __ceremony?: typeof CER }).__ceremony = CER
}
