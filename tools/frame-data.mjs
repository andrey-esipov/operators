// Real frame-data tables, computed by driving the PURE sim (via tsx), not read
// off the authored numbers. For every move of every archetype it injects the
// move at point-blank against a defender who either blocks or eats it, then
// measures the exact frame each fighter regains control. The difference IS the
// on-block / on-hit advantage the engine actually delivers.
//
// Why inject the move directly (set stance/move) rather than feed inputs: frame
// advantage is a property of recovery-vs-stun, independent of input recognition,
// and injection lets us table EVERY move (including motion specials) uniformly.
// The normals are cross-checked against frameadvantage.test.ts, which drives the
// full input path, so the injection path is validated where it overlaps.
//
// Usage: npx tsx tools/frame-data.mjs [operator|vanguard|warden|all]
import { createFight, step, fighterCanAct } from '../src/fight/sim.ts'
import { getFighterDef } from '../src/fight/fighters/index.ts'

const CHARS = ['operator', 'vanguard', 'warden']

function rig(atkId, defId, gap) {
  const s = createFight(atkId, defId)
  s.phase = 'fight'
  s.phaseTimer = 0
  s.fighters[0].pos.x = -gap / 2
  s.fighters[1].pos.x = gap / 2
  s.fighters[0].facing = 1
  s.fighters[1].facing = -1
  return s
}

const NEU = { dir: 5, held: new Set(), pressed: new Set() }
// Defender holds back to block: right-side fighter blocks by holding absolute 6.
const BLOCK = { dir: 6, held: new Set(), pressed: new Set() }
const CROUCH_BLOCK = { dir: 3, held: new Set(), pressed: new Set() }

/** Inject `moveId` on the attacker and measure on-block or on-hit advantage.
 *  mode: 'block' | 'hit'. Returns { adv, connected, kind } or null. */
function measure(atkId, moveId, mode) {
  const def = getFighterDef(atkId)
  const move = def.moves[moveId]
  if (!move) return null
  const low = move.hit.guard === 'low'
  // For lows the standing blocker must crouch-block; for overheads, stand-block.
  const defenderInput = mode === 'block'
    ? (low ? CROUCH_BLOCK : BLOCK)
    : NEU
  let s = rig(atkId, atkId, 66)
  // Inject the move as if startMove just ran it.
  s.fighters[0].stance = 'attack'
  s.fighters[0].move = { id: moveId, frame: 0 }
  s.fighters[0].attackConnected = false

  let enteredAttack = true
  let reacted = false
  let attackerFree = -1
  let defenderFree = -1
  let connectFrame = -1
  let reactionKind = null

  for (let f = 0; f < 160; f++) {
    const r = step(s, [NEU, defenderInput])
    s = r.state
    const A = s.fighters[0]
    const D = s.fighters[1]
    for (const e of r.events) {
      if (connectFrame < 0 && (e.type === 'hit' || e.type === 'block' || e.type === 'launch')) {
        connectFrame = f
      }
    }
    if (!reacted && (D.stance === 'blockstun' || D.stance === 'hitstun' || D.stance === 'juggle' || D.stance === 'knockdown')) {
      reacted = true
      reactionKind = D.stance
    }
    if (enteredAttack && attackerFree < 0 && fighterCanAct(s, 0)) attackerFree = f
    if (reacted && defenderFree < 0 && D.stunRemaining === 0 &&
        D.stance !== 'blockstun' && D.stance !== 'hitstun' && D.stance !== 'juggle' &&
        D.stance !== 'knockdown' && D.stance !== 'wakeup') {
      defenderFree = f
    }
    if (attackerFree >= 0 && defenderFree >= 0) break
  }
  if (!reacted || attackerFree < 0 || defenderFree < 0) {
    return { adv: null, connected: reacted, kind: reactionKind }
  }
  return { adv: defenderFree - attackerFree, connected: true, kind: reactionKind }
}

function frameInfo(move) {
  const [a0, a1] = move.active
  const startup = a0
  const active = a1 - a0 + 1
  const total = move.frames.length
  const recovery = total - a0 - active
  const busy = total - startup
  return { startup, active, recovery, total, busy }
}

function tableFor(charId) {
  const def = getFighterDef(charId)
  console.log(`\n=== ${charId.toUpperCase()} ===`)
  console.log(
    'move'.padEnd(12) + 'tag'.padEnd(9) + 'dmg'.padStart(5) + 'gd'.padStart(5) +
    'lvl'.padStart(10) + ' | ' + 'su'.padStart(3) + 'act'.padStart(4) + 'rec'.padStart(4) +
    'busy'.padStart(5) + ' | ' + 'onBlk'.padStart(6) + 'onHit'.padStart(6) + '  note',
  )
  const rows = []
  for (const [id, move] of Object.entries(def.moves)) {
    const fi = frameInfo(move)
    const isThrow = move.hit.guard === 'throw'
    const isProjMove = move.frames.every((fr) => fr.hitboxes.length === 0) && !isThrow
    let onBlk = null, onHit = null
    if (!isThrow && !isProjMove) {
      onBlk = measure(charId, id, 'block')
      onHit = measure(charId, id, 'hit')
    }
    const blkStr = isThrow ? 'THROW' : isProjMove ? 'PROJ' : (onBlk?.adv ?? '—')
    const hitStr = isThrow ? 'THROW' : isProjMove ? 'PROJ' : (onHit?.adv ?? '—')
    // Flag: a raw normal/special that is 0 or plus on block is "safe"; heavies
    // and specials being safe is a red flag (should be punishable).
    let note = ''
    if (typeof blkStr === 'number') {
      if (blkStr >= -2 && (move.hit.level === 'heavy' || move.tag === 'special')) note = 'SAFE?'
      if (blkStr >= 3) note = 'VERY PLUS'
    }
    rows.push({ id, move, fi, blkStr, hitStr, note })
    console.log(
      id.padEnd(12) + move.tag.padEnd(9) + String(move.hit.damage).padStart(5) +
      String(move.hit.guard).slice(0, 4).padStart(5) + String(move.hit.level).padStart(10) +
      ' | ' + String(fi.startup).padStart(3) + String(fi.active).padStart(4) +
      String(fi.recovery).padStart(4) + String(fi.busy).padStart(5) + ' | ' +
      String(blkStr).padStart(6) + String(hitStr).padStart(6) + '  ' + note,
    )
  }
  return rows
}

const which = process.argv[2] ?? 'all'
const targets = which === 'all' ? CHARS : [which]
for (const c of targets) tableFor(c)
console.log('')
