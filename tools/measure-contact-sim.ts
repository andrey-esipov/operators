/**
 * measure-contact-sim.ts — deterministic, render-free measurement of where the
 * sim's reported hit contact point (`event.at`) lands relative to the two
 * fighters, across controlled ranges.
 *
 * This is the ROOT-CAUSE probe for the "spark tracks the midpoint" report: the
 * renderer spawns the spark at `simToWorld(event.at)`, so if `event.at` itself
 * sits near the fighters' midpoint the spark cannot help but read centred, no
 * matter what the renderer does. Runs the real `step()` against real fighter
 * frame data — nothing mocked.
 *
 *   npx tsx tools/measure-contact-sim.ts
 */
import { createFight, step } from '../src/fight/sim'
import { neutralInput } from '../src/fight/input/sources'
import type { FightState, InputFrame, Button, Direction, FightEvent } from '../src/fight/types'
import { STAGE_HALF_W } from '../src/fight/constants'
import { writeFileSync } from 'fs'

function inp(dir: Direction, pressed: Button[] = [], held: Button[] = []): InputFrame {
  return { dir, held: new Set(held), pressed: new Set(pressed) }
}

interface Scenario {
  name: string
  xA: number
  xD: number
  button: Button
  defenderAir?: boolean
  defenderYcm?: number
}

// Pushbox half-width is 50 (PUSHBOX_W/2). Min centre separation ~100cm.
const scenarios: Scenario[] = [
  { name: 'point-blank', xA: -60, xD: 60, button: 'lp' },
  { name: 'max-reach', xA: -74, xD: 74, button: 'hp' },
  { name: 'airborne', xA: -55, xD: 55, button: 'hp', defenderAir: true, defenderYcm: 95 },
  { name: 'cornered', xA: STAGE_HALF_W - 155, xD: STAGE_HALF_W - 50, button: 'hp' },
]

function forceFight(s: FightState, sc: Scenario) {
  s.phase = 'fight'
  s.phaseTimer = 9999
  s.hitstop = 0
  const [A, D] = s.fighters
  A.pos.x = sc.xA; A.pos.y = 0; A.facing = 1; A.stance = 'idle'; A.grounded = true
  A.move = undefined; A.attackConnected = false; A.stunRemaining = 0; A.vel.x = 0; A.vel.y = 0
  D.pos.x = sc.xD; D.facing = -1; D.stunRemaining = 0; D.vel.x = 0; D.vel.y = 0
  if (sc.defenderAir) {
    D.pos.y = sc.defenderYcm ?? 90; D.grounded = false; D.stance = 'jump-fall'
  } else {
    D.pos.y = 0; D.grounded = true; D.stance = 'idle'
  }
  D.move = undefined; D.attackConnected = false
}

console.log('scenario'.padEnd(13), 'atX'.padStart(7), 'xA'.padStart(7), 'xD'.padStart(7),
  'mid'.padStart(7), 'defCtr→at'.padStart(10), 'mid→at'.padStart(8), 'read')

const emit: Array<Record<string, number | string | boolean>> = []

for (const sc of scenarios) {
  let s = createFight('operator', 'operator')
  forceFight(s, sc)
  // Frame 0: attacker presses the button. Then neutral. Defender does nothing.
  let hit: Extract<FightEvent, { type: 'hit' | 'counter-hit' }> | null = null
  let xAatHit = sc.xA
  let xDatHit = sc.xD
  for (let f = 0; f < 20 && !hit; f++) {
    const aInput = f === 0 ? inp(5, [sc.button]) : neutralInput()
    const res = step(s, [aInput, neutralInput()])
    s = res.state
    for (const e of res.events) {
      if (e.type === 'hit' || e.type === 'counter-hit') {
        hit = e
        xAatHit = s.fighters[0].pos.x
        xDatHit = s.fighters[1].pos.x
        break
      }
    }
  }
  if (!hit) {
    console.log(sc.name.padEnd(13), '   —   (no hit connected)')
    continue
  }
  const atX = hit.at.x
  const mid = (xAatHit + xDatHit) / 2
  const defToAt = Math.abs(atX - xDatHit)
  const midToAt = Math.abs(atX - mid)
  const frac = (atX - xAatHit) / (xDatHit - xAatHit) // 0=on attacker, 1=on defender
  // "read": which is the spark nearer to — the defender's centre or the midpoint?
  const read = defToAt < midToAt ? 'DEFENDER' : 'MIDPOINT'
  console.log(
    sc.name.padEnd(13),
    atX.toFixed(1).padStart(7),
    xAatHit.toFixed(1).padStart(7),
    xDatHit.toFixed(1).padStart(7),
    mid.toFixed(1).padStart(7),
    defToAt.toFixed(1).padStart(10),
    midToAt.toFixed(1).padStart(8),
    read.padStart(9),
    ('frac=' + frac.toFixed(2)).padStart(10),
  )
  emit.push({
    name: sc.name,
    xA: +xAatHit.toFixed(2), xD: +xDatHit.toFixed(2),
    atX: +atX.toFixed(2), atY: +hit.at.y.toFixed(2),
    mid: +mid.toFixed(2), frac: +frac.toFixed(3),
    button: sc.button,
    defenderAir: !!sc.defenderAir, defenderYcm: sc.defenderYcm ?? 0,
  })
}

writeFileSync(new URL('./_contact-scenarios.json', import.meta.url), JSON.stringify(emit, null, 2))
console.log('\nwrote tools/_contact-scenarios.json (' + emit.length + ' scenarios) for the pixel probe')
