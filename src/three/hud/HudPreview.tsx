import { useEffect, useMemo, useRef, useState } from 'react'
import type { FightRenderState } from '../types'
import type { Side } from '../../types'
import { FightHud } from './FightHud'
import type {
  AnnounceMoment,
  ComboState,
  DamageNumber,
  MoveDeck,
} from './types'
import { hudQuery } from './hudRoute'

// ---------------------------------------------------------------------------
// Fabricated scene presets so we can exercise every HUD state in isolation over
// a busy, 3D-like background. Not shipped — this is the visual QA harness.
// ---------------------------------------------------------------------------

const A_ACCENT = '#ff4d5e'
const B_ACCENT = '#17b6ff'

function baseFighter(side: Side): FightRenderState['a'] {
  return {
    id: side === 'a' ? 'chesky' : 'altman',
    side,
    accent: side === 'a' ? A_ACCENT : B_ACCENT,
    pose: 'stance',
    hp01: 1,
    super01: 0.35,
    conviction01: 0.7,
    superReady: false,
    shattered: false,
    active: side === 'a',
    statuses: [],
  }
}

interface Scene {
  label: string
  build: () => {
    state: FightRenderState
    announce?: AnnounceMoment | null
    combo?: ComboState | null
    moveDeck?: MoveDeck | null
    roundsWon?: { a: number; b: number }
    spawnDamage?: boolean
    poseA?: string
    poseB?: string
  }
}

const SCENES: Record<string, Scene> = {
  neutral: {
    label: 'Neutral',
    build: () => ({
      state: mkState({ aHp: 1, bHp: 1, aSuper: 0.4, bSuper: 0.55 }),
      roundsWon: { a: 1, b: 0 },
    }),
  },
  lowhp: {
    label: 'Low HP',
    build: () => ({
      state: mkState({
        aHp: 0.12, bHp: 0.62, aSuper: 1, bSuper: 0.7,
        aReady: true, aShattered: true,
        aStatus: ['HYPERGROWTH_BURN', 'OUTCOME_DEBT'],
      }),
      roundsWon: { a: 1, b: 1 },
      poseA: 'hurt',
    }),
  },
  super: {
    label: 'Super Ready',
    build: () => ({
      state: mkState({
        aHp: 0.78, bHp: 0.83, aSuper: 1, bSuper: 1,
        aReady: true, bReady: true,
      }),
      roundsWon: { a: 0, b: 1 },
    }),
  },
  combo: {
    label: 'Mid-Combo',
    build: () => ({
      state: mkState({ aHp: 0.9, bHp: 0.34, aSuper: 0.8, bSuper: 0.2 }),
      combo: { side: 'a', hits: 9, damage: 284, id: 1 },
      spawnDamage: true,
      poseA: 'attack',
      poseB: 'hurt',
    }),
  },
  ko: {
    label: 'K.O.',
    build: () => ({
      state: mkState({ aHp: 0.55, bHp: 0, bShattered: true }),
      announce: { kind: 'ko', id: 1 },
      roundsWon: { a: 1, b: 0 },
      poseA: 'win',
      poseB: 'lose',
    }),
  },
  status: {
    label: 'Status-heavy',
    build: () => ({
      state: mkState({
        aHp: 0.68, bHp: 0.44, aSuper: 0.6, bSuper: 0.9,
        aStatus: ['FOUNDER_MODE', 'SHIPPING_MOMENTUM', 'HONEST_FEEDBACK'],
        bStatus: ['CONFUSED_ICP', 'PRICING_PRESSURE', 'LNO_PARALYSIS', 'DISTRIBUTION_MOAT'],
      }),
    }),
  },
  deck: {
    label: 'Move Deck',
    build: () => ({
      state: mkState({ aHp: 0.82, bHp: 0.71, aSuper: 1, bSuper: 0.3, aReady: true }),
      moveDeck: {
        side: 'a',
        cards: [
          { id: 'm1', name: 'Use Your Own Product', kind: 'light', damage: 14, cost: 1, hotkey: 'Z' },
          { id: 'm2', name: '6-Week Sprint', kind: 'heavy', damage: 32, cost: 2, hotkey: 'X' },
          { id: 'm3', name: 'Founder Mode', kind: 'setup', damage: 0, cost: 2, hotkey: 'C' },
          { id: 'm4', name: 'Air-Design', kind: 'combo', damage: 41, cost: 3, hotkey: 'V' },
          { id: 'm5', name: 'Air Is A City', kind: 'ultimate', damage: 88, cost: 5, hotkey: 'B', ready: true },
        ],
      },
    }),
  },
  fight: {
    label: 'FIGHT!',
    build: () => ({
      state: mkState({ aHp: 1, bHp: 1, aSuper: 0.2, bSuper: 0.2 }),
      announce: { kind: 'fight', id: 1 },
    }),
  },
  round: {
    label: 'ROUND 1',
    build: () => ({
      state: mkState({ aHp: 1, bHp: 1 }),
      announce: { kind: 'round', round: 1, sub: 'READY', id: 1 },
    }),
  },
  perfect: {
    label: 'PERFECT',
    build: () => ({
      state: mkState({ aHp: 1, bHp: 0 }),
      announce: { kind: 'perfect', id: 1 },
      roundsWon: { a: 1, b: 0 },
    }),
  },
}

interface StateOpts {
  aHp: number; bHp: number
  aSuper?: number; bSuper?: number
  aReady?: boolean; bReady?: boolean
  aShattered?: boolean; bShattered?: boolean
  aStatus?: string[]; bStatus?: string[]
}

function mkState(o: StateOpts): FightRenderState {
  const a = baseFighter('a')
  const b = baseFighter('b')
  a.hp01 = o.aHp; b.hp01 = o.bHp
  a.super01 = o.aSuper ?? 0.4; b.super01 = o.bSuper ?? 0.4
  a.superReady = !!o.aReady; b.superReady = !!o.bReady
  a.shattered = !!o.aShattered; b.shattered = !!o.bShattered
  a.statuses = o.aStatus ?? []; b.statuses = o.bStatus ?? []
  return {
    scenario: 'hypergrowth',
    a, b,
    timeLeft: 62,
    round: 1,
    cinematic: false,
  }
}

// ---------------------------------------------------------------------------

export function HudPreview() {
  const q = hudQuery()
  const initialScene = q.get('scene') ?? 'neutral'
  const showUi = q.get('ui') !== '0'
  const [sceneKey, setSceneKey] = useState(
    SCENES[initialScene] ? initialScene : 'neutral',
  )
  const scene = SCENES[sceneKey] ?? SCENES.neutral
  const built = useMemo(() => scene.build(), [sceneKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Spawn transient damage numbers for combo/action scenes so screenshots catch
  // them mid-flight.
  const [dmg, setDmg] = useState<DamageNumber[]>([])
  const idRef = useRef(1)
  useEffect(() => {
    setDmg([])
    if (!built.spawnDamage) return
    const flavors: DamageNumber['flavor'][] = ['heavy', 'combo', 'crit', 'heavy', 'combo']
    let k = 0
    const push = () => {
      const id = idRef.current++
      const flavor = flavors[k++ % flavors.length]
      setDmg((cur) => [
        ...cur.slice(-4),
        {
          id,
          side: 'b',
          value: 20 + Math.floor(Math.random() * 40),
          flavor,
          x: 0.66 + (Math.random() - 0.5) * 0.08,
          y: 0.4 + (Math.random() - 0.5) * 0.1,
        },
      ])
      setTimeout(() => setDmg((cur) => cur.filter((d) => d.id !== id)), 1000)
    }
    push()
    const t = setInterval(push, 520)
    return () => clearInterval(t)
  }, [built, sceneKey])

  const stageUrl = `/stages/${built.state.scenario}.png`
  const poseA = (built.poseA ?? 'stance') as string
  const poseB = (built.poseB ?? 'stance') as string
  const portraitA = useChromaKey(`/sprites/${built.state.a.id}/win.png`)
  const portraitB = useChromaKey(`/sprites/${built.state.b.id}/win.png`)

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#05060c' }}>
      {/* Busy 3D-like backdrop: stage + fighters + grade + vignette. */}
      <div
        style={{
          position: 'absolute', inset: 0,
          backgroundImage: `url(${stageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center 40%',
          filter: 'saturate(1.05) contrast(1.05) brightness(0.9)',
        }}
      />
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% 62%, transparent 40%, rgba(0,0,0,0.62))' }} />
      <Fighter side="a" id={built.state.a.id} pose={poseA} accent={A_ACCENT} />
      <Fighter side="b" id={built.state.b.id} pose={poseB} accent={B_ACCENT} />
      {/* Fake atmosphere so we can judge legibility against bright bloom. */}
      <div style={{ position: 'absolute', left: '18%', bottom: '10%', width: 420, height: 420, background: 'radial-gradient(circle, rgba(255,180,80,0.35), transparent 70%)', filter: 'blur(20px)', mixBlendMode: 'screen', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', right: '20%', bottom: '18%', width: 380, height: 380, background: 'radial-gradient(circle, rgba(60,200,255,0.35), transparent 70%)', filter: 'blur(20px)', mixBlendMode: 'screen', pointerEvents: 'none' }} />

      <FightHud
        state={built.state}
        names={{ a: 'CHESKY', b: 'ALTMAN' }}
        portraits={{ a: portraitA ?? undefined, b: portraitB ?? undefined }}
        roundsWon={built.roundsWon ?? { a: 0, b: 0 }}
        roundsToWin={2}
        combo={built.combo ?? null}
        announce={built.announce ?? null}
        damageNumbers={dmg}
        moveDeck={built.moveDeck ?? null}
      />

      {showUi && (
        <div
          style={{
            position: 'absolute', left: 12, bottom: 12, zIndex: 100,
            display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 520,
            fontFamily: 'monospace',
          }}
        >
          {Object.entries(SCENES).map(([key, s]) => (
            <button
              key={key}
              onClick={() => setSceneKey(key)}
              style={{
                padding: '6px 10px',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.05em',
                color: key === sceneKey ? '#05060c' : '#fff',
                background: key === sceneKey ? '#ffd23c' : 'rgba(0,0,0,0.6)',
                border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Fighter({ side, id, pose, accent }: { side: Side; id: string; pose: string; accent: string }) {
  const file = pose === 'hurt' ? 'lose' : pose === 'ult' ? 'win' : pose
  const url = `/sprites/${id}/${file}.png`
  const keyed = useChromaKey(url)
  if (!keyed) return null
  return (
    <img
      src={keyed}
      alt=""
      draggable={false}
      style={{
        position: 'absolute',
        bottom: '6%',
        [side === 'a' ? 'left' : 'right']: '13%',
        height: '66%',
        transform: side === 'b' ? 'scaleX(-1)' : undefined,
        filter: `drop-shadow(0 18px 26px rgba(0,0,0,0.75)) drop-shadow(0 0 30px ${accent}55)`,
        imageRendering: 'auto',
      }}
    />
  )
}

/** Preview-only: strip the flat gray chroma matte from a sprite via canvas. */
function useChromaKey(url: string): string | null {
  const [out, setOut] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx = c.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, c.width, c.height)
      const d = data.data
      // Sample the matte from the top-left corner.
      const kr = d[0], kg = d[1], kb = d[2]
      for (let i = 0; i < d.length; i += 4) {
        const dr = d[i] - kr, dg = d[i + 1] - kg, db = d[i + 2] - kb
        const dist = Math.sqrt(dr * dr + dg * dg + db * db)
        if (dist < 48) d[i + 3] = 0
        else if (dist < 80) d[i + 3] = Math.round(((dist - 48) / 32) * 255)
      }
      ctx.putImageData(data, 0, 0)
      if (alive) setOut(c.toDataURL())
    }
    img.src = url
    return () => { alive = false }
  }, [url])
  return out
}
