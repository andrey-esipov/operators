import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FightScene3D, type FightSceneHandle } from '../FightScene3D'
import type { FightEvent, FightRenderState, FighterPose, HitFlavor } from '../types'
import type { ScenarioId } from '../../types'
import { STAGE_ORDER } from '../stage/StageRegistry'
import { getFighter, FIGHTERS } from '../../data/fighters'

/**
 * Visual lab.
 *
 * A standalone harness for the 3D renderer, reachable at `?lab=1`. It exists
 * so the render layer can be inspected and screenshotted without playing
 * through the game — every stage, pose, hit flavour and cinematic is one
 * function call away, and `window.__OPS3D__` exposes the same controls to
 * automation.
 */

declare global {
  interface Window {
    __OPS3D__?: {
      setStage(id: ScenarioId): void
      setFighters(a: string, b: string): void
      setPose(side: 'a' | 'b', pose: FighterPose): void
      hit(flavor: HitFlavor, target?: 'a' | 'b', power?: number): void
      ko(loser?: 'a' | 'b'): void
      shatter(side?: 'a' | 'b'): void
      setHp(side: 'a' | 'b', hp01: number): void
      setSuper(side: 'a' | 'b', v: number): void
      quality(q: 'low' | 'medium' | 'high' | 'ultra'): void
      state(): FightRenderState
      /** Resolves when the renderer has drawn at least `n` frames. */
      settle(n?: number): Promise<void>
      /** True once the scene has drawn and every queued asset has landed. */
      ready(): boolean
    }
  }
}

function makeState(
  scenario: ScenarioId,
  aId: string,
  bId: string,
  overrides?: Partial<{
    aPose: FighterPose; bPose: FighterPose
    aHp: number; bHp: number
    aSuper: number; bSuper: number
    aShattered: boolean; bShattered: boolean
    active: 'a' | 'b'
  }>,
): FightRenderState {
  const a = getFighter(aId)
  const b = getFighter(bId)
  const o = overrides ?? {}
  return {
    scenario,
    round: 1,
    timeLeft: 90,
    cinematic: false,
    a: {
      id: aId, side: 'a', accent: a?.accent ?? '#F77F00',
      pose: o.aPose ?? 'stance', hp01: o.aHp ?? 1, super01: o.aSuper ?? 0,
      conviction01: 1, superReady: (o.aSuper ?? 0) >= 1, shattered: o.aShattered ?? false,
      active: (o.active ?? 'a') === 'a', statuses: [],
    },
    b: {
      id: bId, side: 'b', accent: b?.accent ?? '#00B4D8',
      pose: o.bPose ?? 'stance', hp01: o.bHp ?? 1, super01: o.bSuper ?? 0,
      conviction01: 1, superReady: (o.bSuper ?? 0) >= 1, shattered: o.bShattered ?? false,
      active: (o.active ?? 'a') === 'b', statuses: [],
    },
  }
}

const FLAVORS: HitFlavor[] = ['light', 'heavy', 'crit', 'combo', 'ex', 'ult', 'signature']

export function ThreeLab() {
  const params = new URLSearchParams(window.location.search)
  const [stage, setStage] = useState<ScenarioId>((params.get('stage') as ScenarioId) ?? 'hypergrowth')
  const [aId, setAId] = useState(params.get('a') ?? 'chesky')
  const [bId, setBId] = useState(params.get('b') ?? 'lenny')
  const [aPose, setAPose] = useState<FighterPose>('stance')
  const [bPose, setBPose] = useState<FighterPose>('stance')
  const [aHp, setAHp] = useState(1)
  const [bHp, setBHp] = useState(1)
  const [aSuper, setASuper] = useState(0)
  const [bSuper, setBSuper] = useState(0)
  const [events, setEvents] = useState<FightEvent[]>([])
  const [hud, setHud] = useState(params.get('hud') !== '0')
  const handleRef = useRef<FightSceneHandle | null>(null)

  const state = useMemo(
    () => makeState(stage, aId, bId, { aPose, bPose, aHp, bHp, aSuper, bSuper }),
    [stage, aId, bId, aPose, bPose, aHp, bHp, aSuper, bSuper],
  )

  const emit = useCallback((e: FightEvent) => {
    handleRef.current?.emit(e)
    setEvents((prev) => [...prev.slice(-16), e])
  }, [])

  const onReady = useCallback((h: FightSceneHandle) => {
    handleRef.current = h
    window.__OPS3D__ = {
      setStage: (id) => setStage(id),
      setFighters: (a, b) => { setAId(a); setBId(b) },
      setPose: (side, pose) => (side === 'a' ? setAPose(pose) : setBPose(pose)),
      hit: (flavor, target = 'b', power = 0.6) => {
        const attacker = target === 'a' ? 'b' : 'a'
        h.emit({ kind: 'cast', attacker, flavor })
        h.emit({ kind: 'hit', attacker, target, flavor, damage: Math.round(power * 120), power })
      },
      ko: (loser = 'b') => h.emit({ kind: 'ko', winner: loser === 'a' ? 'b' : 'a', loser }),
      shatter: (side = 'b') => h.emit({ kind: 'shatter', side }),
      setHp: (side, v) => (side === 'a' ? setAHp(v) : setBHp(v)),
      setSuper: (side, v) => (side === 'a' ? setASuper(v) : setBSuper(v)),
      quality: (q) => h.engine.setQuality(q),
      state: () => state,
      settle: (n = 12) =>
        new Promise<void>((resolve) => {
          const start = h.engine.frameCount
          const tick = () => {
            if (h.engine.frameCount - start >= n) resolve()
            else requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        }),
      ready: () => h.engine.frameCount > 4 && h.engine.assets.pending() === 0,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (window.__OPS3D__) window.__OPS3D__.state = () => state
  }, [state])

  // Keyboard: 1-7 fire hit flavours, K = KO, S = shatter, [ ] cycle stages.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const idx = '1234567'.indexOf(e.key)
      if (idx >= 0) {
        const flavor = FLAVORS[idx]
        emit({ kind: 'cast', attacker: 'a', flavor })
        emit({ kind: 'hit', attacker: 'a', target: 'b', flavor, damage: 60, power: 0.7 })
      }
      if (e.key === 'k') emit({ kind: 'ko', winner: 'a', loser: 'b' })
      if (e.key === 's') emit({ kind: 'shatter', side: 'b' })
      if (e.key === '[') setStage((s) => STAGE_ORDER[(STAGE_ORDER.indexOf(s) + STAGE_ORDER.length - 1) % STAGE_ORDER.length])
      if (e.key === ']') setStage((s) => STAGE_ORDER[(STAGE_ORDER.indexOf(s) + 1) % STAGE_ORDER.length])
      if (e.key === 'h') setHud((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [emit])

  return (
    <div className="fixed inset-0" style={{ background: '#05030b' }}>
      <FightScene3D state={state} onReady={onReady} />
      {hud && (
        <div
          className="absolute left-3 top-3 z-50 text-[11px] leading-5"
          style={{
            background: 'rgba(6,4,12,0.82)',
            border: '1px solid rgba(255,255,255,0.14)',
            padding: '10px 12px',
            color: '#e8e2f5',
            fontFamily: 'ui-monospace, monospace',
            maxWidth: 320,
          }}
        >
          <div style={{ opacity: 0.6, marginBottom: 6 }}>THREE LAB — h to hide</div>
          <Row label="stage">
            <select value={stage} onChange={(e) => setStage(e.target.value as ScenarioId)} style={selStyle}>
              {STAGE_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Row>
          <Row label="P1">
            <select value={aId} onChange={(e) => setAId(e.target.value)} style={selStyle}>
              {FIGHTERS.map((f) => <option key={f.id} value={f.id}>{f.shortName}</option>)}
            </select>
          </Row>
          <Row label="P2">
            <select value={bId} onChange={(e) => setBId(e.target.value)} style={selStyle}>
              {FIGHTERS.map((f) => <option key={f.id} value={f.id}>{f.shortName}</option>)}
            </select>
          </Row>
          <Row label="pose1">
            <PoseSel value={aPose} onChange={setAPose} />
          </Row>
          <Row label="pose2">
            <PoseSel value={bPose} onChange={setBPose} />
          </Row>
          <Row label="hp">
            <input type="range" min={0} max={1} step={0.01} value={aHp} onChange={(e) => setAHp(+e.target.value)} />
            <input type="range" min={0} max={1} step={0.01} value={bHp} onChange={(e) => setBHp(+e.target.value)} />
          </Row>
          <Row label="super">
            <input type="range" min={0} max={1} step={0.01} value={aSuper} onChange={(e) => setASuper(+e.target.value)} />
            <input type="range" min={0} max={1} step={0.01} value={bSuper} onChange={(e) => setBSuper(+e.target.value)} />
          </Row>
          <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {FLAVORS.map((f, i) => (
              <button
                key={f}
                onClick={() => {
                  emit({ kind: 'cast', attacker: 'a', flavor: f })
                  emit({ kind: 'hit', attacker: 'a', target: 'b', flavor: f, damage: 60, power: 0.7 })
                }}
                style={btnStyle}
              >
                {i + 1} {f}
              </button>
            ))}
            <button onClick={() => emit({ kind: 'shatter', side: 'b' })} style={btnStyle}>s shatter</button>
            <button onClick={() => emit({ kind: 'ko', winner: 'a', loser: 'b' })} style={btnStyle}>k ko</button>
          </div>
          <div style={{ marginTop: 6, opacity: 0.5 }}>events: {events.length}</div>
        </div>
      )}
    </div>
  )
}

const selStyle: React.CSSProperties = {
  background: '#150e26', color: '#e8e2f5', border: '1px solid #3a2d55',
  fontSize: 11, padding: '1px 3px', maxWidth: 170,
}
const btnStyle: React.CSSProperties = {
  background: '#1d1533', color: '#e8e2f5', border: '1px solid #3a2d55',
  fontSize: 10, padding: '3px 6px', cursor: 'pointer',
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <span style={{ opacity: 0.55, width: 44 }}>{label}</span>
      {children}
    </div>
  )
}

function PoseSel({ value, onChange }: { value: FighterPose; onChange: (p: FighterPose) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as FighterPose)} style={selStyle}>
      {(['stance', 'attack', 'win', 'lose', 'ult', 'hurt'] as FighterPose[]).map((p) => (
        <option key={p} value={p}>{p}</option>
      ))}
    </select>
  )
}
