import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Word } from '../Announcements'
import { loadPortrait, preloadPortrait, type PortraitInfo } from '../portraits'
import { Sfx } from '../../lib/audio'
import { Voice } from '../../lib/voice'
import { getFighter } from '../../data/fighters'
import { ARCHETYPES, ROSTER, STAGES, type RosterEntry, type StageEntry } from './roster'
import './select.css'
import '../hud.css'

/**
 * Character + stage select — the game's front door, owned by src/fighthud/**.
 *
 * Reached at `?select=1`. This is deliberately NOT the bare-`/` landing: every
 * capture tool in tools/ boots `/` (often with no query at all) and waits for a
 * live match on `window.__PLAY__`, so gating `/` behind select would break them
 * mid-run in the confusing way this project keeps getting burned by. Instead an
 * explicit matchup in the query string always boots straight into the fight, and
 * this screen simply *writes* that query string when the player locks in:
 *
 *     /?a=<skin>&b=<skin>&p1=<arch>&p2=<arch>&stage=<id>&cpu=medium
 *
 * A full navigation (not a client swap) is intentional — PlayableMatch gets the
 * same clean mount a tool's URL would give it, so there is exactly one code path
 * into a match.
 *
 * It reuses the HUD's own visual language rather than inventing a second one:
 * the extruded `Word` lettering from Announcements, the accent-ramp nameplates,
 * and the atlas-cropped portraits from portraits.ts. Cursor movement is hard and
 * discrete, every confirm pops and flashes, and the two nameplates fill in as
 * picks lock — the beats a fighting-game select is expected to hit.
 */

type Phase = 'p1' | 'p2' | 'stage' | 'launch'
const ROSTER_COLS = 3
const STAGE_COLS = 4

const CPU = 'medium'

/** Speak the chosen fighter's line on lock-in — the signature "the character
 *  answers when you pick them" beat that every arcade fighter has and a silent
 *  menu conspicuously lacks. Uses `matchStart`, the line written to be said at
 *  the moment a fighter squares up.
 *
 *  Every failure path here is a no-op by construction: the select roster is
 *  keyed by atlas `skin` id while voice lines live on the card-game fighter
 *  defs, so a skin without a def simply stays silent, and `Voice.say` already
 *  swallows blocked autoplay and missing TTS. A menu confirm must never throw. */
function sayPick(entry: RosterEntry) {
  const def = getFighter(entry.skin)
  if (def) Voice.say(def.voiceLines.matchStart, def.id, 'matchStart')
}

/** Build a layered "place" out of a stage's two-colour swatch — sky glow, a
 *  horizon light-line and a grounded floor — so a card reads as somewhere you'd
 *  fight rather than a flat gradient chip. Pure CSS: the renderer owns the real
 *  3D stage; this is only the picker thumbnail. */
function stageScene([a, b]: [string, string]): string {
  return [
    `radial-gradient(90% 62% at 50% 122%, ${a}99 0%, transparent 60%)`,
    `radial-gradient(66% 48% at 72% 4%, ${a}66 0%, transparent 55%)`,
    `linear-gradient(180deg, ${b} 0%, color-mix(in srgb, ${a} 26%, ${b}) 56%, color-mix(in srgb, ${a} 62%, ${b}) 60%, color-mix(in srgb, ${a} 22%, ${b}) 61%, ${b} 100%)`,
  ].join(', ')
}

/** Cover-crop an atlas frame into a fixed box — the same trick Portrait.tsx uses
 *  for the HUD, but sized for the larger select art (head + torso). */
function AtlasCrop({
  skin,
  w,
  h,
  topFraction = 0.72,
  sideTrim = 0.12,
  accent,
}: {
  skin: string
  w: number
  h: number
  topFraction?: number
  sideTrim?: number
  accent: string
}) {
  const [info, setInfo] = useState<PortraitInfo | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    setInfo(null)
    loadPortrait(skin).then((p) => {
      if (alive.current) setInfo(p)
    })
    return () => {
      alive.current = false
    }
  }, [skin])

  if (!info) {
    // Accent-tinted shimmer, never a dead black box: the load race used to
    // photograph as black squares (SPIEGEL/DOSHI/LENNY). A mid-load frame now
    // reads as "art incoming", and preloadPortrait() usually beats first paint.
    return <span className="fsel-crop fsel-crop-loading" style={{ width: w, height: h, ['--accent' as string]: accent }} aria-hidden />
  }
  const { rect, atlas } = info
  const cropX = rect.x + rect.w * sideTrim
  const cropW = rect.w * (1 - sideTrim * 2)
  const cropH = rect.h * topFraction
  const scale = Math.max(w / cropW, h / cropH)
  const offsetX = (w - cropW * scale) / 2
  return (
    <span className="fsel-crop fsel-crop-in" style={{ width: w, height: h }}>
      <img
        src={atlas}
        alt=""
        draggable={false}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transformOrigin: '0 0',
          transform: `translate(${offsetX}px, 0px) scale(${scale}) translate(${-cropX}px, ${-rect.y}px)`,
          imageRendering: 'pixelated',
          maxWidth: 'none',
        }}
      />
    </span>
  )
}

/** The locked/side nameplate — mirrors the in-match HUD nameband. While a side
 *  is active and unlocked it *previews* the hovered fighter (art + name + style)
 *  so your half of the screen fills in live as you scrub the grid, the way SF6/
 *  Tekken telegraph a pick. It snaps to a solid lock on confirm. */
function SidePlate({
  side,
  entry,
  preview,
  active,
}: {
  side: 'a' | 'b'
  entry: RosterEntry | null
  preview: RosterEntry | null
  active: boolean
}) {
  const shown = entry ?? (active ? preview : null)
  const locked = !!entry
  const previewing = !locked && !!shown
  const arch = shown ? ARCHETYPES[shown.archetype] : null
  return (
    <div
      className={`fsel-plate ${side} ${locked ? 'locked' : ''} ${active ? 'active' : ''} ${previewing ? 'previewing' : ''}`}
      data-testid={`fsel-plate-${side}`}
      style={{ ['--accent' as string]: shown?.accent ?? '#4a4a5a' }}
    >
      <div className="fsel-plate-art">
        {shown ? (
          <AtlasCrop key={shown.skin} skin={shown.skin} w={190} h={240} accent={shown.accent} />
        ) : (
          <span className="fsel-plate-q">?</span>
        )}
      </div>
      <div className="fsel-plate-meta">
        <div className="fsel-plate-tag">
          {side === 'a' ? 'PLAYER 1' : 'PLAYER 2'}
          {previewing && <span className="fsel-plate-state"> — HOVER</span>}
          {locked && <span className="fsel-plate-state locked"> — LOCKED</span>}
        </div>
        <div className="fsel-plate-name" style={{ color: shown?.accent ?? '#8a8a9a' }}>
          {shown ? shown.shortName : '—'}
        </div>
        {arch && (
          <div className="fsel-plate-arch" style={{ ['--accent' as string]: arch.accent }}>
            <span className="fsel-arch-label">{arch.label}</span>
            <span className="fsel-arch-hp">{arch.hp} HP</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function FightSelect() {
  const [phase, setPhase] = useState<Phase>('p1')
  const [cursor, setCursor] = useState(0)
  const [p1, setP1] = useState<number | null>(null)
  const [p2, setP2] = useState<number | null>(null)
  const [stage, setStage] = useState<number | null>(null)
  // Bumped on every confirm so the locked cell + screen edge can pop.
  const [confirmKey, setConfirmKey] = useState(0)
  const [confirmAccent, setConfirmAccent] = useState('#f4c130')
  // The VS face-off runs a tiny beat machine inside the 'launch' phase:
  // 'vs' (portraits slam in + VS clash) → 'fight' (FIGHT! + stinger) → navigate.
  const [launchBeat, setLaunchBeat] = useState<'vs' | 'fight'>('vs')
  const [portraitsReady, setPortraitsReady] = useState(false)
  // Launch/VS timers, tracked so an unmount mid-beat can't fire a stray navigate.
  const timers = useRef<number[]>([])
  const clearTimers = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
  }, [])

  // Warm every roster atlas up front so the grid paints all at once instead of
  // popping in one-by-one — and so a capture can't photograph the load race.
  useEffect(() => {
    let live = true
    Promise.all(ROSTER.map((r) => preloadPortrait(r.skin))).then(() => {
      if (live) setPortraitsReady(true)
    })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => () => clearTimers(), [clearTimers])

  const grid = phase === 'stage' || phase === 'launch' ? STAGES : ROSTER

  // Mirror live state into a ref so the __SELECT__ probe reads the committed
  // value synchronously right after driving an action.
  const snap = useRef({ phase, cursor, p1, p2, stage, portraitsReady })
  snap.current = { phase, cursor, p1, p2, stage, portraitsReady }

  const launch = useCallback((p1i: number, p2i: number, stageIdx: number) => {
    const a = ROSTER[p1i]
    const b = ROSTER[p2i]
    const st = STAGES[stageIdx]
    const q = new URLSearchParams({
      a: a.skin,
      b: b.skin,
      p1: a.archetype,
      p2: b.archetype,
      stage: st.id,
      cpu: CPU,
    })
    window.location.assign(`${window.location.pathname}?${q.toString()}`)
  }, [])

  const move = useCallback(
    (dx: number, dy: number) => {
      const s = snap.current
      if (s.phase === 'launch') return
      const len = s.phase === 'stage' ? STAGES.length : ROSTER.length
      const w = s.phase === 'stage' ? STAGE_COLS : ROSTER_COLS
      let next = s.cursor
      if (dx) next = (next + dx + len) % len
      if (dy) next = (next + dy * w + len) % len
      if (next !== s.cursor) {
        setCursor(next)
        Sfx.menuMove()
      }
    },
    [],
  )

  const confirm = useCallback(() => {
    const s = snap.current
    if (s.phase === 'p1') {
      Sfx.menuSelect()
      // Lock-in: the chosen fighter answers in their own voice — the signature
      // "the character responds when you pick them" beat. Voice.say is
      // fail-silent (swallows a blocked HTMLAudio play, no-ops without TTS), so
      // it is safe on the gesture-driven confirm and in headless capture.
      sayPick(ROSTER[s.cursor])
      setP1(s.cursor)
      setConfirmAccent(ROSTER[s.cursor].accent)
      setConfirmKey((k) => k + 1)
      setPhase('p2')
      // Offer P2 a different default cell so the two picks don't stack.
      setCursor((s.cursor + 1) % ROSTER.length)
    } else if (s.phase === 'p2') {
      Sfx.menuSelect()
      sayPick(ROSTER[s.cursor])
      setP2(s.cursor)
      setConfirmAccent(ROSTER[s.cursor].accent)
      setConfirmKey((k) => k + 1)
      setPhase('stage')
      setCursor(0)
    } else if (s.phase === 'stage') {
      Sfx.menuSelect()
      setStage(s.cursor)
      setConfirmAccent('#f6ec5a')
      setConfirmKey((k) => k + 1)
      setLaunchBeat('vs')
      setPhase('launch')
      const p1i = s.p1 ?? 0
      const p2i = s.p2 ?? 1
      const stageIdx = s.cursor
      // VS face-off beat, then hand off. The nav is still an explicit result of a
      // stage lock (never a render loop), just delayed by the ceremony; the
      // handoff capture waits up to 30s, so the longer beat is safe.
      clearTimers()
      timers.current.push(window.setTimeout(() => { setLaunchBeat('fight'); Sfx.fight() }, 1500))
      timers.current.push(window.setTimeout(() => launch(p1i, p2i, stageIdx), 2350))
    }
  }, [launch, clearTimers])

  const back = useCallback(() => {
    const s = snap.current
    if (s.phase === 'p2') {
      Sfx.menuMove()
      setPhase('p1')
      setCursor(s.p1 ?? 0)
      setP2(null)
    } else if (s.phase === 'stage') {
      Sfx.menuMove()
      setPhase('p2')
      setCursor(s.p2 ?? 0)
      setStage(null)
    }
  }, [])

  // Keyboard: hard cursor movement + confirm/back. Arrows and WASD.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft': case 'a': case 'A': move(-1, 0); break
        case 'ArrowRight': case 'd': case 'D': move(1, 0); break
        case 'ArrowUp': case 'w': case 'W': move(0, -1); break
        case 'ArrowDown': case 's': case 'S': move(0, 1); break
        case 'Enter': case ' ': confirm(); break
        case 'Escape': case 'Backspace': back(); break
        default: return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, confirm, back])

  // Gamepad: same hard cursor language as the keyboard. D-pad / left stick move
  // (press-then-repeat), A confirms, B backs out. Polls in rAF and does NOTHING
  // when no pad is present, so it can never drive the render-loop navigation the
  // stability check guards against — the only nav path is still a user stage lock.
  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return
    let raf = 0
    let heldDir: string | null = null
    let nextRepeat = 0
    let prevA = false
    let prevB = false
    const DEAD = 0.5
    const step = (dir: string) =>
      move(dir === 'l' ? -1 : dir === 'r' ? 1 : 0, dir === 'u' ? -1 : dir === 'd' ? 1 : 0)
    const poll = (t: number) => {
      raf = requestAnimationFrame(poll)
      const pad = Array.from(navigator.getGamepads?.() ?? []).find(Boolean)
      if (!pad) {
        heldDir = null
        return
      }
      const ax = pad.axes[0] ?? 0
      const ay = pad.axes[1] ?? 0
      const left = pad.buttons[14]?.pressed || ax < -DEAD
      const right = pad.buttons[15]?.pressed || ax > DEAD
      const up = pad.buttons[12]?.pressed || ay < -DEAD
      const down = pad.buttons[13]?.pressed || ay > DEAD
      const dir = left ? 'l' : right ? 'r' : up ? 'u' : down ? 'd' : null
      if (dir) {
        if (dir !== heldDir) {
          heldDir = dir
          nextRepeat = t + 300
          step(dir)
        } else if (t >= nextRepeat) {
          nextRepeat = t + 130
          step(dir)
        }
      } else {
        heldDir = null
      }
      const a = pad.buttons[0]?.pressed ?? false
      const b = pad.buttons[1]?.pressed ?? false
      if (a && !prevA) confirm()
      if (b && !prevB) back()
      prevA = a
      prevB = b
    }
    raf = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(raf)
  }, [move, confirm, back])

  // Dev probe so a capture tool can compose an exact mid-selection state and
  // ASSERT it, rather than screenshotting whatever happened to be on screen.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__SELECT__ = {
      ready: () => true,
      state: () => {
        const s = snap.current
        return {
          phase: s.phase,
          cursor: s.cursor,
          p1: s.p1 != null ? ROSTER[s.p1].skin : null,
          p2: s.p2 != null ? ROSTER[s.p2].skin : null,
          p1arch: s.p1 != null ? ROSTER[s.p1].archetype : null,
          p2arch: s.p2 != null ? ROSTER[s.p2].archetype : null,
          stage: s.stage != null ? STAGES[s.stage].id : null,
          portraitsReady: s.portraitsReady,
        }
      },
      move: (dx: number, dy: number) => move(dx, dy),
      setCursor: (i: number) => setCursor(i),
      confirm: () => confirm(),
      back: () => back(),
    }
    return () => {
      delete window.__SELECT__
    }
  }, [move, confirm, back])

  const heading = phase === 'stage' ? 'SELECT STAGE' : phase === 'p1' ? 'PLAYER 1' : phase === 'p2' ? 'PLAYER 2' : 'FIGHT'
  const headAccent = phase === 'stage' ? '#f6ec5a' : phase === 'p1' ? '#f4c130' : '#ef6a3a'

  const p1Entry = p1 != null ? ROSTER[p1] : null
  const p2Entry = p2 != null ? ROSTER[p2] : null
  const hovered = phase !== 'stage' && phase !== 'launch' ? ROSTER[cursor] : null
  const hoveredArch = hovered ? ARCHETYPES[hovered.archetype] : null

  const cells = useMemo(() => grid.map((g, i) => ({ g, i })), [grid])

  return (
    <div className="fsel-root" data-testid="fsel-root" data-phase={phase} data-portraits={portraitsReady ? 'ready' : 'loading'}>
      {/* Screen-edge confirm pulse — same defensive-flash language as FlashChip. */}
      <AnimatePresence>
        {confirmKey > 0 && (
          <motion.div
            key={confirmKey}
            className="fsel-confirm-edge"
            style={{ background: `radial-gradient(ellipse at 50% 46%, transparent 52%, ${confirmAccent}cc 100%)` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.85, 0] }}
            transition={{ duration: 0.5, times: [0, 0.16, 1], ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>

      {phase !== 'launch' && (
        <header className="fsel-head">
          <Word text={heading} color="#ffffff" accent={headAccent} className="fsel-title" />
        </header>
      )}

      <SidePlate side="a" entry={p1Entry} preview={phase === 'p1' ? ROSTER[cursor] : null} active={phase === 'p1'} />
      <SidePlate side="b" entry={p2Entry} preview={phase === 'p2' ? ROSTER[cursor] : null} active={phase === 'p2'} />

      {phase !== 'stage' && phase !== 'launch' && (
        <div className="fsel-stage-area">
          <div className="fsel-grid fsel-grid-roster" role="listbox" aria-label="fighters">
            {(cells as { g: RosterEntry; i: number }[]).map(({ g, i }) => {
              const isCursor = i === cursor
              const lockedByP1 = p1 === i && phase === 'p2'
              return (
                <motion.button
                  key={g.skin}
                  type="button"
                  className={`fsel-cell ${isCursor ? 'cursor' : ''} ${lockedByP1 ? 'taken' : ''}`}
                  data-testid="fsel-cell"
                  data-skin={g.skin}
                  data-cursor={isCursor ? '1' : undefined}
                  style={{ ['--accent' as string]: g.accent }}
                  onMouseEnter={() => { if (i !== cursor) { setCursor(i); Sfx.menuMove() } }}
                  onClick={() => { setCursor(i); confirm() }}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0, scale: isCursor ? 1.07 : 1 }}
                  transition={{
                    opacity: { duration: 0.24, delay: 0.03 * i },
                    y: { type: 'spring', stiffness: 420, damping: 26, delay: 0.03 * i },
                    scale: { type: 'spring', stiffness: 540, damping: 20 },
                  }}
                >
                  <span className="fsel-cell-art">
                    <AtlasCrop skin={g.skin} w={150} h={168} accent={g.accent} />
                    <span className="fsel-cell-sheen" aria-hidden />
                  </span>
                  <span className="fsel-cell-name">{g.shortName}</span>
                  <span className="fsel-cell-arch" style={{ ['--accent' as string]: ARCHETYPES[g.archetype].accent }}>
                    {ARCHETYPES[g.archetype].label}
                  </span>
                  {lockedByP1 && <span className="fsel-cell-p1">P1</span>}
                </motion.button>
              )
            })}
          </div>

          {hovered && hoveredArch && (
            <div className="fsel-readout" data-testid="fsel-readout" style={{ ['--accent' as string]: hovered.accent }}>
              <div className="fsel-readout-name">{hovered.name}</div>
              <div className="fsel-readout-arch" style={{ color: hoveredArch.accent }}>{hoveredArch.label}</div>
              <div className="fsel-readout-blurb">{hoveredArch.blurb}</div>
              <div className="fsel-readout-hp">
                <span className="fsel-readout-hp-label">HEALTH</span>
                <span className="fsel-readout-hp-bar">
                  <span className="fsel-readout-hp-fill" style={{ transform: `scaleX(${hoveredArch.hp / 1150})` }} />
                </span>
                <span className="fsel-readout-hp-num">{hoveredArch.hp}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {phase === 'stage' && (
        <div className="fsel-stage-area">
          <div className="fsel-grid fsel-grid-stage" role="listbox" aria-label="stages">
            {(cells as { g: StageEntry; i: number }[]).map(({ g, i }) => {
              const isCursor = i === cursor && phase === 'stage'
              const chosen = stage === i
              return (
                <motion.button
                  key={g.id}
                  type="button"
                  className={`fsel-stagecard ${isCursor ? 'cursor' : ''} ${chosen ? 'chosen' : ''}`}
                  data-testid="fsel-stagecard"
                  data-stage={g.id}
                  data-cursor={isCursor ? '1' : undefined}
                  onMouseEnter={() => { if (phase === 'stage' && i !== cursor) { setCursor(i); Sfx.menuMove() } }}
                  onClick={() => { if (phase === 'stage') { setCursor(i); confirm() } }}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0, scale: isCursor ? 1.06 : 1 }}
                  transition={{
                    opacity: { duration: 0.22, delay: 0.028 * i },
                    y: { type: 'spring', stiffness: 440, damping: 26, delay: 0.028 * i },
                    scale: { type: 'spring', stiffness: 540, damping: 20 },
                  }}
                >
                  <span className="fsel-stage-thumb" data-stage={g.id} style={{ background: stageScene(g.swatch) }}>
                    <span className="fsel-stage-floor" aria-hidden />
                    <span className="fsel-stage-sheen" aria-hidden />
                    <span className="fsel-stage-vignette" aria-hidden />
                    {g.note && <span className={`fsel-stage-flag ${g.note === 'UNTESTED' ? 'warn' : ''}`}>{g.note}</span>}
                  </span>
                  <span className="fsel-stage-name">{g.name}</span>
                </motion.button>
              )
            })}
          </div>
        </div>
      )}

      {phase === 'launch' && (
        <div className="fsel-launch" data-testid="fsel-launch" data-beat={launchBeat}>
          <span className="fsel-vs-scrim" aria-hidden />
          <span className="fsel-vs-bolt" aria-hidden />
          <motion.div
            className="fsel-vs-fighter a"
            layout="position"
            style={{ ['--accent' as string]: p1Entry?.accent ?? '#f4c130' }}
            initial={{ x: '-16vw', opacity: 0, rotate: -5 }}
            animate={{ x: 0, opacity: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22, layout: { type: 'spring', stiffness: 320, damping: 34 } }}
          >
            <span className="fsel-vs-art">
              {p1Entry && <AtlasCrop key={p1Entry.skin} skin={p1Entry.skin} w={340} h={430} accent={p1Entry.accent} />}
            </span>
            <span className="fsel-vs-name" style={{ color: p1Entry?.accent }}>{p1Entry?.shortName}</span>
            <span className="fsel-vs-arch">{p1Entry ? ARCHETYPES[p1Entry.archetype].label : ''}</span>
          </motion.div>

          <div className="fsel-vs-center">
            <AnimatePresence>
              {launchBeat === 'vs' ? (
                <motion.div
                  key="vs"
                  className="fsel-vs-clash"
                  initial={{ scale: 2.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.5, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 15 }}
                >
                  <Word text="VS" color="#ffffff" accent="#ef6a3a" className="fsel-vs-word" />
                </motion.div>
              ) : (
                <motion.div
                  key="fight"
                  className="fsel-vs-clash"
                  initial={{ scale: 0.55, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 440, damping: 14 }}
                >
                  <Word text="FIGHT!" color="#fff4c2" accent="#ef6a3a" className="fsel-fight" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <motion.div
            className="fsel-vs-fighter b"
            layout="position"
            style={{ ['--accent' as string]: p2Entry?.accent ?? '#ef6a3a' }}
            initial={{ x: '16vw', opacity: 0, rotate: 5 }}
            animate={{ x: 0, opacity: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22, layout: { type: 'spring', stiffness: 320, damping: 34 } }}
          >
            <span className="fsel-vs-art">
              {p2Entry && <AtlasCrop key={p2Entry.skin} skin={p2Entry.skin} w={340} h={430} accent={p2Entry.accent} />}
            </span>
            <span className="fsel-vs-name" style={{ color: p2Entry?.accent }}>{p2Entry?.shortName}</span>
            <span className="fsel-vs-arch">{p2Entry ? ARCHETYPES[p2Entry.archetype].label : ''}</span>
          </motion.div>
        </div>
      )}

      <footer className="fsel-hint" data-testid="fsel-hint">
        <span><kbd>← ↑ ↓ →</kbd> / <kbd>WASD</kbd> MOVE</span>
        <span><kbd>ENTER</kbd> CONFIRM</span>
        <span><kbd>ESC</kbd> BACK</span>
        <span className="fsel-hint-pad"><kbd>PAD</kbd> D-PAD · A · B</span>
      </footer>
    </div>
  )
}

declare global {
  interface Window {
    __SELECT__?: {
      ready: () => boolean
      state: () => {
        phase: Phase
        cursor: number
        p1: string | null
        p2: string | null
        p1arch: string | null
        p2arch: string | null
        stage: string | null
        portraitsReady: boolean
      }
      move: (dx: number, dy: number) => void
      setCursor: (i: number) => void
      confirm: () => void
      back: () => void
    }
  }
}
