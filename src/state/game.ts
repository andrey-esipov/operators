import { create } from 'zustand'
import type { FighterRuntime, GameState, Move, ScenarioId, Side } from '../types'
import { getFighter, STARTING_ROSTER } from '../data/fighters'
import { AI_PROFILES } from '../data/ai-profiles'
import { ARCADE_PROGRESSION } from '../data/scenarios'
import { STORY_PROGRESSION, PROCEDURAL_ENDING_EPITAPH } from './../data/story-tournament'
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
  /** Active player casts a move. Pass `opts.ex` to EX-cast (spend 50 super
   *  for +50% damage; ignored on ultimates). */
  castMove: (move: Move, opts?: { ex?: boolean }) => void
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
  /** Start Story Mode — The Operator Tournament. Universal 8-chapter
   *  arc; marquee 8 fighters get bespoke overlays. */
  startStory: (fighterId: string) => void
  /** Advance the Story Mode cutscene state machine to the next beat.
   *  Called by SPACE / click during a story-cutscene phase. */
  advanceStoryBeat: () => void
  /** Game mode (vs = hot seat 2P; arcade = vs bots; story = career mode) */
  mode: 'vs' | 'arcade' | 'practice' | 'daily' | 'story'
  setMode: (m: 'vs' | 'arcade' | 'practice' | 'daily' | 'story') => void
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
  arcadeOpponentQueue: [],
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
    // Build the opponent queue up front so each arcade run is internally
    // consistent. Difficulty determines whether opponents are scenario
    // specialists (HARD) or random non-specialists (EASY / NORMAL).
    const { difficulty } = get()
    const progression = ARCADE_PROGRESSION
    const nonBoss = progression.slice(0, -1)
    const queue: string[] = []

    if (difficulty === 'hard') {
      // Hard: the punishing scenario-specialist progression. Each
      // opponent has +30-50% damage on the stage they show up on.
      for (const stage of nonBoss) {
        const id = stage.opponentId === fighterId ? 'doshi' : stage.opponentId
        queue.push(id)
      }
    } else {
      // Easy / Normal: shuffle the playable roster (sans player + boss)
      // and consume from the shuffled list so no opponent repeats in
      // one run.
      const pool = STARTING_ROSTER.filter((id) => id !== fighterId && id !== 'lenny')
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[pool[i], pool[j]] = [pool[j], pool[i]]
      }
      const used = new Set<string>()

      if (difficulty === 'easy') {
        // Easy: actively prefer opponents who do NOT specialize in this
        // scenario (bonus < 1.3x). Falls back to any unused fighter
        // if no weak match exists.
        for (const stage of nonBoss) {
          const weak = pool.find((id) => {
            if (used.has(id)) return false
            const bonus = getFighter(id)?.scenarioBonus[stage.scenario] ?? 1.0
            return bonus < 1.3
          })
          const fallback = pool.find((id) => !used.has(id))
          const chosen = weak ?? fallback ?? 'doshi'
          queue.push(chosen)
          used.add(chosen)
        }
      } else {
        // Normal: fully random — take the first N from the shuffled
        // pool. Variety per run, no engineered difficulty spike.
        for (let i = 0; i < nonBoss.length; i++) {
          queue.push(pool[i] ?? 'doshi')
        }
      }
    }

    // Lenny is always the final boss.
    queue.push('lenny')

    set({
      mode: 'arcade',
      arcadeStep: 0,
      selectedA: fighterId,
      arcadeOpponentQueue: queue,
    })
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
    const { scenario } = progression[step]
    const playerId = state.selectedA
    if (!playerId) return

    // Prefer the queue (built at startArcade); fall back to the legacy
    // hardcoded opponent for back-compat with older saves / dev calls
    // that bypass startArcade.
    let opponentId = state.arcadeOpponentQueue[step] ?? progression[step].opponentId
    if (opponentId === playerId) {
      const fallbackOrder = ['cagan', 'doshi', 'spiegel', 'turley', 'madhavan', 'catwu', 'chesky']
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

  // ─── STORY MODE — The Operator Tournament ───────────────────────────
  //
  // Reuses the arcade fight machinery (initialRuntime, scenario, round,
  // KO bookkeeping) but inserts a 4-beat cutscene state machine around
  // each fight:
  //   chapter-intro      → pre-fight-dialogue → [PreFight → Combat → MatchEnd]
  //   → post-fight-reaction → chapter-outro → next chapter
  // After chapter 8 (Lenny boss): ending-splash.
  startStory: (fighterId: string) => {
    // The marquee 8 get bespoke career arcs (Tier 2 wires this in).
    const MARQUEE = ['amjad', 'chesky', 'boris', 'altman', 'benioff', 'feifei', 'elena', 'reid']
    const arcMode: 'tournament' | 'career' = MARQUEE.includes(fighterId) ? 'career' : 'tournament'

    // Build opponent queue from the story progression (fixed order).
    // If the player IS the scenario specialist for a chapter, swap in a
    // sensible alternative so we don't fight ourselves.
    const queue: string[] = STORY_PROGRESSION.map((ch) => {
      if (ch.opponentId === fighterId) {
        // Pick a thematic alt for each scenario (mirrors arcade fallback).
        const altByScenario: Record<string, string> = {
          'pre-pmf': 'doshi',
          hypergrowth: 'cagan',
          plateau: 'spiegel',
          'ai-native': 'altman',
          monetization: 'turley',
          crisis: 'chesky',
          distribution: 'madhavan',
          'ipo-prep': 'lenny',
        }
        return altByScenario[ch.scenario] ?? 'doshi'
      }
      return ch.opponentId
    })

    flashCounter++
    const firstChapter = STORY_PROGRESSION[0]
    set({
      mode: 'story',
      arcadeStep: 0,
      selectedA: fighterId,
      arcadeOpponentQueue: queue,
      storyState: { playerFighterId: fighterId, arcMode },
      phase: 'story-cutscene',
      storyCutscene: {
        beat: 'chapter-intro',
        chapter: 1,
        text: firstChapter.chapterIntro,
        speakerId: 'lenny',
        opponentId: queue[0],
        id: flashCounter,
      },
    })
  },

  advanceStoryBeat: () => {
    const state = get()
    if (state.mode !== 'story' || !state.storyCutscene || !state.storyState) return
    const cs = state.storyCutscene
    const chapterIdx = cs.chapter - 1
    const chapter = STORY_PROGRESSION[chapterIdx]
    if (!chapter) return
    const playerId = state.storyState.playerFighterId
    const opponentId = state.arcadeOpponentQueue[chapterIdx] ?? chapter.opponentId
    const playerDef = getFighter(playerId)

    flashCounter++

    switch (cs.beat) {
      case 'chapter-intro': {
        // Move to pre-fight dialogue: opponent challenges, then player's
        // matchStart line is the response (rendered as a second bubble).
        set({
          storyCutscene: {
            beat: 'pre-fight-dialogue',
            chapter: cs.chapter,
            text: chapter.opponentChallenge,
            speakerId: opponentId,
            opponentId,
            id: flashCounter,
          },
        })
        return
      }
      case 'pre-fight-dialogue': {
        // Hand off to the existing arcade fight machinery. Clear cutscene;
        // route through nextArcadeFight using the story scenario+opponent.
        set({
          storyCutscene: undefined,
          phase: 'pre-fight',
          fighterA: initialRuntime(playerId),
          fighterB: initialRuntime(opponentId),
          scenario: chapter.scenario,
          round: 1,
          roundsWon: { a: 0, b: 0 },
          turn: 1,
          activeSide: 'a',
          log: [],
          damagePulses: [],
          selectedB: opponentId,
        })
        setTimeout(() => {
          set({ phase: 'fight' })
          const defA = getFighter(playerId); const defB = getFighter(opponentId)
          if (defA) Voice.say(defA.voiceLines.matchStart, playerId, 'matchStart')
          if (defB) setTimeout(() => Voice.say(defB.voiceLines.matchStart, opponentId, 'matchStart'), 1800)
        }, 4200)
        return
      }
      case 'post-fight-reaction': {
        // After the fight resolved, advance to the chapter outro (Lenny's
        // reflective wrap-up before next chapter / ending).
        set({
          storyCutscene: {
            beat: 'chapter-outro',
            chapter: cs.chapter,
            text: chapter.chapterOutro,
            speakerId: 'lenny',
            opponentId,
            id: flashCounter,
          },
        })
        return
      }
      case 'chapter-outro': {
        // Move to next chapter (or ending if this was chapter 8).
        const nextChapterIdx = chapterIdx + 1
        if (nextChapterIdx >= STORY_PROGRESSION.length) {
          // Reached the end — show ending splash.
          const epitaph = playerDef
            ? PROCEDURAL_ENDING_EPITAPH(playerDef.shortName)
            : "That's the operator who went the distance."
          set({
            arcadeStep: nextChapterIdx,
            storyCutscene: {
              beat: 'ending-splash',
              chapter: 8,
              text: epitaph,
              speakerId: 'lenny',
              id: flashCounter,
            },
          })
          return
        }
        // Next chapter intro.
        const next = STORY_PROGRESSION[nextChapterIdx]
        const nextOpponent = state.arcadeOpponentQueue[nextChapterIdx] ?? next.opponentId
        set({
          arcadeStep: nextChapterIdx,
          storyCutscene: {
            beat: 'chapter-intro',
            chapter: next.chapter,
            text: next.chapterIntro,
            speakerId: 'lenny',
            opponentId: nextOpponent,
            id: flashCounter,
          },
        })
        return
      }
      case 'ending-splash': {
        // Final beat — record completion stats, route to the story-ending
        // screen which has the share/retry/menu buttons.
        const ks = loadStats()
        ks.arcadeRunsCompleted += 1
        saveStats(ks)
        checkAndUnlock(ks)
        set({ phase: 'story-ending', storyCutscene: undefined })
        return
      }
    }
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
    const { selectedA, selectedB, roundsWon, fighterA: prevA, fighterB: prevB } = get()
    if (!selectedA || !selectedB) return
    const nextRound = (get().round + 1) as 1 | 2 | 3
    // Cross-round super-meter carryover. Cooldowns + status reset, but the
    // meter persists so banking it for a clutch round-2 ult is a viable
    // strategy. Capped at 100 (the existing per-cast cap).
    const carryA = prevA?.superMeter ?? 0
    const carryB = prevB?.superMeter ?? 0
    set({
      fighterA: initialRuntime(selectedA, carryA),
      fighterB: initialRuntime(selectedB, carryB),
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
      arcadeOpponentQueue: [],
    })
  },

  advanceArcade: () => {
    set((s) => ({ arcadeStep: s.arcadeStep + 1 }))
  },

  castMove: (move: Move, opts?: { ex?: boolean }) => {
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
      ex: opts?.ex,
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

    // Sound cue: include "+ex" suffix so CombatScreen's audio effect plays
    // the EX sting *additively* on top of the primary cue (crit/combo/light).
    const primarySound = result.flash === 'ex'
      ? 'ex'
      : result.flash ?? (result.log.finalDamage > 70 ? 'heavy' : 'light')
    const soundKind = result.ex && result.flash !== 'ex' ? `${primarySound}+ex` : primarySound

    set({
      fighterA: newA,
      fighterB: newB,
      log: [...state.log, result.log],
      lastFlash: result.flash ? { kind: result.flash, side: attackerSide, id: flashId } : state.lastFlash,
      soundCue: { kind: soundKind, id: sndId },
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

    // Stats: every move counts. Combo / crit / ult / EX / shatter / signature tracked.
    const stats = loadStats()
    if (result.flash === 'combo') stats.totalCombos += 1
    if (result.flash === 'crit') stats.totalCrits += 1
    if (result.flash === 'ult' || result.flash === 'signature') stats.totalUlts += 1
    if (result.ex) stats.totalEx += 1
    if (result.shattered) stats.totalShatters += 1
    if (result.signature) stats.totalSignatures += 1
    if (result.log.appliedStatuses.length > 0 || result.log.finalDamage > 0) {
      stats.totalQuotes = Math.max(stats.totalQuotes, get().quoteBank.length + 1)
    }
    saveStats(stats)
    checkAndUnlock(stats)

    // ─── SIGNATURE SEQUENCE branch ───
    // When an ult lands on a shattered defender, intercept both the K.O.
    // path and the normal turn-advance path with a 4s cinematic. After the
    // cinematic, fold back into the regular K.O. → round-end flow OR the
    // normal turn switch, depending on whether the hit was lethal.
    if (result.signature) {
      flashCounter++
      const sigId = flashCounter
      // Tagline: ult.comboTitle if set, else the ult name itself (which is
      // already the operator's iconic line — "AIR IS A CITY", "LNO
      // FRAMEWORK", "PATTERN MATCHING", etc.).
      const tagline = attackerDef.ult.comboTitle || attackerDef.ult.name

      // Fire the K.O. voice line up front so it overlaps with the
      // signature audio sting rather than waiting for the K.O. banner.
      if (result.ko) Voice.say(attackerDef.voiceLines.ko, attackerDef.id, 'ko')

      set({
        soundCue: { kind: 'signature', id: ++soundCounter },
        signatureCinematic: {
          attackerSide,
          defenderSide,
          tagline,
          fighterId: attackerDef.id,
          id: sigId,
          ko: result.ko,
        },
      })

      // Stats: count signature ults as ult + 1 special tally.
      if (result.ko) {
        const ks = loadStats()
        ks.totalKOs += 1
        saveStats(ks)
        checkAndUnlock(ks)
      }

      setTimeout(() => {
        if (result.ko) {
          // Round/match end after the cinematic finishes.
          const newRoundsWon = {
            a: state.roundsWon.a + (attackerSide === 'a' ? 1 : 0),
            b: state.roundsWon.b + (attackerSide === 'b' ? 1 : 0),
          }
          const matchWinner = newRoundsWon.a >= 2 ? 'a' : newRoundsWon.b >= 2 ? 'b' : null
          if (matchWinner) {
            const ms = loadStats()
            ms.totalMatches += 1
            const playerWon = matchWinner === 'a'
            if (playerWon && state.mode !== 'vs') {
              ms.totalWins += 1
              if (state.selectedA && !ms.fightersUsed.includes(state.selectedA)) ms.fightersUsed.push(state.selectedA)
              if (state.selectedB && !ms.fightersBeaten.includes(state.selectedB)) ms.fightersBeaten.push(state.selectedB)
              if (state.selectedB === 'lenny') {
                ms.lennyDefeats += 1
                if (state.difficulty === 'hard') ms.hardModeWins += 1
              }
            }
            saveStats(ms)
            checkAndUnlock(ms)
          }
          flashCounter++
          const koId = flashCounter
          set({
            signatureCinematic: undefined,
            koCinematic: { winner: attackerSide, loser: defenderSide, comboTitle: tagline, id: koId },
          })
          // STORY MODE: after the K.O. cinematic, route to the post-fight
          // story cutscene instead of match-end (player wins only).
          const storyWin = matchWinner === 'a' && state.mode === 'story' && state.storyState
          if (storyWin) {
            setTimeout(() => {
              flashCounter++
              const chapterIdx = state.arcadeStep
              const chapter = STORY_PROGRESSION[chapterIdx]
              const opponentDef = getFighter(state.selectedB ?? '')
              const reaction = opponentDef ? opponentDef.voiceLines.lose : 'A new pattern.'
              set({
                roundsWon: newRoundsWon,
                koCinematic: undefined,
                phase: 'story-cutscene',
                storyCutscene: {
                  beat: 'post-fight-reaction',
                  chapter: (chapter?.chapter ?? 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
                  text: reaction,
                  speakerId: state.selectedB ?? undefined,
                  opponentId: state.selectedB ?? undefined,
                  id: flashCounter,
                },
              })
            }, 2000)
            return
          }
          setTimeout(() => {
            set({
              phase: matchWinner ? 'match-end' : 'round-end',
              roundsWon: newRoundsWon,
              koCinematic: undefined,
            })
          }, 2000)
        } else {
          // No K.O. — clear cinematic, advance turn to the (now-revived)
          // defender. Start their turn normally so cooldowns/status tick.
          const cur = get()
          const tgt = defenderSide === 'a' ? cur.fighterA : cur.fighterB
          if (!tgt) {
            set({ signatureCinematic: undefined })
            return
          }
          const ts = startTurn(tgt)
          let updated = ts.runtime
          if (state.mode === 'practice' && defenderSide === 'a') {
            updated = {
              ...updated,
              momentum: 10,
              superMeter: 100,
              hp: Math.max(updated.hp, Math.round(updated.maxHp * 0.8)),
            }
          }
          set((s) => ({
            signatureCinematic: undefined,
            activeSide: defenderSide,
            turn: s.turn + 1,
            fighterA: defenderSide === 'a' ? updated : s.fighterA,
            fighterB: defenderSide === 'b' ? updated : s.fighterB,
          }))
        }
      }, 4000)
      return
    }

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
        // STORY MODE — when the player wins a chapter, route through the
        // post-fight cutscene instead of the regular match-end screen. The
        // chapter outro + next chapter handoff lives in advanceStoryBeat.
        // Player loss still falls through to match-end (back to menu).
        const storyWin = matchWinner === 'a' && state.mode === 'story' && state.storyState
        if (storyWin) {
          flashCounter++
          const chapterIdx = state.arcadeStep
          const chapter = STORY_PROGRESSION[chapterIdx]
          const opponentDef = getFighter(state.selectedB ?? '')
          // Post-fight reaction: opponent concedes (their `lose` voice line),
          // displayed in opponent's portrait. Fallback if def missing.
          const reaction = opponentDef
            ? opponentDef.voiceLines.lose
            : 'A new pattern.'
          set({
            roundsWon: newRoundsWon,
            koCinematic: undefined,
            phase: 'story-cutscene',
            storyCutscene: {
              beat: 'post-fight-reaction',
              chapter: (chapter?.chapter ?? 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
              text: reaction,
              speakerId: state.selectedB ?? undefined,
              opponentId: state.selectedB ?? undefined,
              id: flashCounter,
            },
          })
          return
        }
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

    // If the next active fighter's start-of-turn DoT killed them, end
    // the round here with credit to the OPPONENT (whoever applied the
    // status, or simply the other side for self-applied burns like
    // Turley's HYPERGROWTH_BURN). Otherwise the next move would
    // mis-attribute the K.O. — the opponent's attack would land on a
    // fighter who was already at 0 HP and grab the round.
    if (turnStart.koDueToDoT && state.mode !== 'practice') {
      const dotWinnerSide: Side = nextActive === 'a' ? 'b' : 'a'
      const dotLoserSide: Side = nextActive
      flashCounter++
      const koId = flashCounter

      const dotNewRoundsWon = {
        a: state.roundsWon.a + (dotWinnerSide === 'a' ? 1 : 0),
        b: state.roundsWon.b + (dotWinnerSide === 'b' ? 1 : 0),
      }
      const dotMatchWinner = dotNewRoundsWon.a >= 2 ? 'a' : dotNewRoundsWon.b >= 2 ? 'b' : null

      // Synthesize a "BURNED OUT" log entry so RoundEnd / MatchEnd can
      // attribute the round-win correctly via the log's `attacker` field.
      const burnLogEntry = {
        turn: state.turn,
        attacker: dotWinnerSide,
        moveId: 'dot-finish',
        moveName: 'BURNED OUT',
        baseDamage: turnStart.selfDamage,
        scenarioMultiplier: 1,
        comboBonus: 0,
        critMultiplier: 1,
        finalDamage: turnStart.selfDamage,
        hpAfter: {
          a: nextActive === 'a' ? 0 : (newA?.hp ?? 0),
          b: nextActive === 'b' ? 0 : (newB?.hp ?? 0),
        },
        quote: 'Burn rate caught up.',
        episode: 'host',
        timestamp: 'BURNOUT',
        appliedStatuses: [],
      }

      set({
        fighterA: nextActive === 'a' ? updatedTarget : newA,
        fighterB: nextActive === 'b' ? updatedTarget : newB,
        log: [...state.log, burnLogEntry],
        koCinematic: {
          winner: dotWinnerSide,
          loser: dotLoserSide,
          id: koId,
        },
      })

      const ks = loadStats()
      ks.totalKOs += 1
      saveStats(ks)
      checkAndUnlock(ks)

      // Match-end stats parity with the cast-K.O. path.
      if (dotMatchWinner) {
        const ms = loadStats()
        ms.totalMatches += 1
        const playerWon = dotMatchWinner === 'a'
        if (playerWon && state.mode !== 'vs') {
          ms.totalWins += 1
          if (state.selectedA && !ms.fightersUsed.includes(state.selectedA)) {
            ms.fightersUsed.push(state.selectedA)
          }
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
          phase: dotMatchWinner ? 'match-end' : 'round-end',
          roundsWon: dotNewRoundsWon,
          koCinematic: undefined,
        })
      }, 2400)
      return
    }

    // CONVICTION SHATTERED path: when the cast just broke the defender's
    // conviction, the defender loses their turn to the cinematic and the
    // attacker keeps the active flag. We still tick the defender's
    // start-of-turn so cooldowns/status decrements progress (and a +2
    // momentum starts the attacker's punish turn). The +75% damage bonus
    // attaches to the attacker's NEXT damaging hit on this defender.
    if (result.shattered) {
      flashCounter++
      const shatterId = flashCounter
      const attackerRt = attackerSide === 'a' ? newA : newB
      if (!attackerRt) return

      // Tick the defender's clocks. Conviction regen is suppressed inside
      // startTurn while shattered is true (so the bonus window stays open
      // for the attacker's punish hit, which clears the flag itself).
      const defenderTick = startTurn(updatedTarget).runtime
      // Attacker starts a fresh turn — +2 momentum, status tick, etc.
      const attackerTick = startTurn(attackerRt).runtime

      set({
        soundCue: { kind: 'shatter', id: ++soundCounter },
        shatterCinematic: { shatteredSide: defenderSide, id: shatterId },
      })

      setTimeout(() => {
        set((s) => ({
          // Active side STAYS on the attacker — they get the punish turn.
          activeSide: attackerSide,
          // Bump turn count by 2: one for the silent skip, one for the new
          // attacker turn. Keeps the turn log roughly accurate.
          turn: s.turn + 2,
          fighterA: attackerSide === 'a' ? attackerTick : defenderTick,
          fighterB: attackerSide === 'b' ? attackerTick : defenderTick,
          shatterCinematic: undefined,
        }))
      }, 2400)
      return
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
    // Don't act while a cinematic is playing — the state will be restored
    // when the cinematic ends, and acting before then races the restore.
    if (state.koCinematic || state.shatterCinematic) return
    const rt = side === 'a' ? state.fighterA : state.fighterB
    const oppRt = side === 'a' ? state.fighterB : state.fighterA
    if (!rt || !oppRt) return
    const def = getFighter(rt.defId)!

    // AI personality: weighted random move selection.
    // Reject moves on cooldown so the bot doesn't repeat-spam heavy.
    const allMoves: Move[] = [...def.moves, def.ult]
    const affordable = allMoves.filter((m) => {
      // Ultimates are clamped to 5 momentum system-wide (see applyMove.ts).
      const effMomentum = m.type === 'ultimate' ? Math.min(m.momentum, 5) : m.momentum
      if (rt.momentum < effMomentum) return false
      if (m.type === 'ultimate' && rt.superMeter < 100) return false
      // requiresSelfStatus is no longer a hard gate — it's a +50% damage
      // bonus. AI is free to cast the ult even without the buff active.
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
      // Hard pass: nothing affordable, no cheapest light playable. Yield the
      // turn AND tick the yielder's own cooldowns + momentum so they recover
      // next time around. Without the self-startTurn the yielder's cooldowns
      // freeze, which on bad RNG could chain several yielded turns in a row.
      const nextSide: Side = side === 'a' ? 'b' : 'a'
      const target = nextSide === 'a' ? state.fighterA : state.fighterB
      if (!target) return
      const yieldTurn = startTurn(rt)
      const nextTurn = startTurn(target)
      set((s) => ({
        activeSide: nextSide,
        turn: s.turn + 1,
        fighterA: side === 'a' ? yieldTurn.runtime : (nextSide === 'a' ? nextTurn.runtime : s.fighterA),
        fighterB: side === 'b' ? yieldTurn.runtime : (nextSide === 'b' ? nextTurn.runtime : s.fighterB),
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

    // Hard difficulty EX rolls: when the bot is below 60% HP and sitting on
    // a healthy super meter, splash 50 super into a heavy/combo for the
    // +50% damage boost. Roughly 20% chance per eligible pick — common
    // enough to feel like real pressure, rare enough that the player can
    // still bait it out.
    const exEligible = (choice.type === 'heavy' || choice.type === 'combo')
      && difficulty === 'hard'
      && rt.superMeter >= 75
      && rt.hp / rt.maxHp < 0.6
    if (exEligible && Math.random() < 0.2) {
      get().castMove(choice, { ex: true })
      return
    }
    get().castMove(choice)
  },
}))

// Dev/debug hook: expose the store on window in dev builds only. Lets
// browser-MCP smoke tests poke runtime state (set conviction, etc.) without
// having to play through 50 turns. Stripped in production builds.
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __useGame: typeof useGame }).__useGame = useGame
}
