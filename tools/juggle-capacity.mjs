// Precise juggle-allowance census. Measures the ALLOWANCE mechanic — how many
// air hits the juggle gate permits after a launch — independent of route
// execution. Launch the victim, then each cycle force the attacker onto its
// launcher's first ACTIVE frame right on top of the airborne victim so the hit
// lands deterministically; count extensions until the gate (`stance==='juggle'
// && juggleLeft<=0`) closes. Isolating the gate this way is a mechanism probe,
// not a playability claim: real routes reach these hits via cancels.
import { createFight, step } from '../src/fight/sim.ts'
import { getFighterDef } from '../src/fight/fighters/index.ts'

const CHARS = ['operator', 'vanguard', 'warden']
const NEU = { dir: 5, held: new Set(), pressed: new Set() }

function airExtensions(atkId) {
  const def = getFighterDef(atkId)
  const active0 = def.moves['cr.HP'].active[0]
  let s = createFight(atkId, atkId)
  s.phase = 'fight'; s.phaseTimer = 0
  s.fighters[0].pos.x = -20; s.fighters[0].facing = 1
  s.fighters[1].pos.x = 20; s.fighters[1].facing = -1

  // Grounded launch: place the attacker one pre-active frame from contact.
  s.fighters[0].stance = 'attack'
  s.fighters[0].move = { id: 'cr.HP', frame: active0 - 1 }
  s.fighters[0].attackConnected = false

  let launched = false
  let airHits = 0
  let launchLeft = null

  for (let f = 0; f < 200; f++) {
    const A = s.fighters[0]
    const D = s.fighters[1]
    if (launched && !D.grounded && D.stance === 'juggle') {
      // Sit on the victim and arm the launcher one frame before active so this
      // step's advanceTimers lands it on the active frame.
      A.pos.x = D.pos.x
      A.pos.y = D.pos.y
      A.grounded = false
      A.stance = 'attack'
      A.move = { id: 'cr.HP', frame: active0 - 1 }
      A.attackConnected = false
    }
    const r = step(s, [NEU, NEU])
    s = r.state
    for (const e of r.events) {
      if (e.type === 'launch') {
        if (!launched) { launched = true; launchLeft = s.fighters[1].juggleLeft }
        else airHits++
      }
    }
    if (launched && s.fighters[1].grounded && s.fighters[1].stance !== 'juggle') break
    if (launched && s.fighters[1].stance === 'juggle' && s.fighters[1].juggleLeft <= 0) break
  }
  return { airHits, launchLeft, allowance: def.juggleAllowance ?? '(default)' }
}

console.log('\nAir extensions per archetype (gate-isolation probe)')
console.log('char'.padEnd(10) + 'def.allowance'.padStart(14) + 'left@launch'.padStart(13) + 'airExtensions'.padStart(15))
for (const c of CHARS) {
  const r = airExtensions(c)
  console.log(c.padEnd(10) + String(r.allowance).padStart(14) + String(r.launchLeft).padStart(13) + String(r.airHits).padStart(15))
}
console.log('')
