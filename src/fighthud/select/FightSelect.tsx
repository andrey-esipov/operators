import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Word } from '../Announcements'
import { loadPortrait, type PortraitInfo } from '../portraits'
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
    return <span className="fsel-crop-empty" style={{ width: w, height: h, background: `${accent}22` }} />
  }
  const { rect, atlas } = info
  const cropX = rect.x + rect.w * sideTrim
  const cropW = rect.w * (1 - sideTrim * 2)
  const cropH = rect.h * topFraction
  const scale = Math.max(w / cropW, h / cropH)
  const offsetX = (w - cropW * scale) / 2
  return (
    <span className="fsel-crop" style={{ width: w, height: h }}>
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

/** The locked/side nameplate — mirrors the in-match HUD nameband. */
function SidePlate({ side, entry, active }: { side: 'a' | 'b'; entry: RosterEntry | null; active: boolean }) {
  const arch = entry ? ARCHETYPES[entry.archetype] : null
  return (
    <div className={`fsel-plate ${side} ${entry ? 'locked' : ''} ${active ? 'active' : ''}`} data-testid={`fsel-plate-${side}`}>
      <div className="fsel-plate-art" style={{ ['--accent' as string]: entry?.accent ?? '#4a4a5a' }}>
        {entry ? (
          <AtlasCrop skin={entry.skin} w={190} h={240} accent={entry.accent} />
        ) : (
          <span className="fsel-plate-q">?</span>
        )}
      </div>
      <div className="fsel-plate-meta">
        <div className="fsel-plate-tag">{side === 'a' ? 'PLAYER 1' : 'PLAYER 2'}</div>
        <div className="fsel-plate-name" style={{ color: entry?.accent ?? '#8a8a9a' }}>
          {entry ? entry.shortName : '—'}
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

  const grid = phase === 'stage' || phase === 'launch' ? STAGES : ROSTER

  // Mirror live state into a ref so the __SELECT__ probe reads the committed
  // value synchronously right after driving an action.
  const snap = useRef({ phase, cursor, p1, p2, stage })
  snap.current = { phase, cursor, p1, p2, stage }

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
      setCursor((c) => {
        const len = snap.current.phase === 'stage' ? STAGES.length : ROSTER.length
        const w = snap.current.phase === 'stage' ? STAGE_COLS : ROSTER_COLS
        let next = c
        if (dx) next = (next + dx + len) % len
        if (dy) next = (next + dy * w + len) % len
        return next
      })
    },
    [],
  )

  const confirm = useCallback(() => {
    const s = snap.current
    if (s.phase === 'p1') {
      setP1(s.cursor)
      setConfirmAccent(ROSTER[s.cursor].accent)
      setConfirmKey((k) => k + 1)
      setPhase('p2')
      // Offer P2 a different default cell so the two picks don't stack.
      setCursor((s.cursor + 1) % ROSTER.length)
    } else if (s.phase === 'p2') {
      setP2(s.cursor)
      setConfirmAccent(ROSTER[s.cursor].accent)
      setConfirmKey((k) => k + 1)
      setPhase('stage')
      setCursor(0)
    } else if (s.phase === 'stage') {
      setStage(s.cursor)
      setConfirmAccent('#f6ec5a')
      setConfirmKey((k) => k + 1)
      setPhase('launch')
      const p1i = s.p1 ?? 0
      const p2i = s.p2 ?? 1
      window.setTimeout(() => launch(p1i, p2i, s.cursor), 950)
    }
  }, [launch])

  const back = useCallback(() => {
    const s = snap.current
    if (s.phase === 'p2') {
      setPhase('p1')
      setCursor(s.p1 ?? 0)
      setP2(null)
    } else if (s.phase === 'stage') {
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
    <div className="fsel-root" data-testid="fsel-root" data-phase={phase}>
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

      <header className="fsel-head">
        <Word text={heading} color="#ffffff" accent={headAccent} className="fsel-title" />
      </header>

      <SidePlate side="a" entry={p1Entry} active={phase === 'p1'} />
      <SidePlate side="b" entry={p2Entry} active={phase === 'p2'} />

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
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => { setCursor(i); confirm() }}
                  animate={isCursor ? { scale: 1.06 } : { scale: 1 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 22 }}
                >
                  <AtlasCrop skin={g.skin} w={150} h={168} accent={g.accent} />
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

      {(phase === 'stage' || phase === 'launch') && (
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
                  onMouseEnter={() => phase === 'stage' && setCursor(i)}
                  onClick={() => { if (phase === 'stage') { setCursor(i); confirm() } }}
                  animate={isCursor ? { scale: 1.05 } : { scale: 1 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 22 }}
                >
                  <span className="fsel-stage-thumb" style={{ background: `linear-gradient(150deg, ${g.swatch[0]}, ${g.swatch[1]})` }}>
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
        <motion.div
          className="fsel-launch"
          data-testid="fsel-launch"
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 18 }}
        >
          <Word text="FIGHT!" color="#fff4c2" accent="#ef6a3a" className="fsel-fight" />
        </motion.div>
      )}

      <footer className="fsel-hint" data-testid="fsel-hint">
        <span><kbd>← ↑ ↓ →</kbd> / <kbd>WASD</kbd> MOVE</span>
        <span><kbd>ENTER</kbd> CONFIRM</span>
        <span><kbd>ESC</kbd> BACK</span>
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
      }
      move: (dx: number, dy: number) => void
      setCursor: (i: number) => void
      confirm: () => void
      back: () => void
    }
  }
}
