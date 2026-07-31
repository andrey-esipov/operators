/**
 * The skin seam gate.
 *
 * The defect this guards is the collapse the seam was built to kill: the sim
 * being constructed from ARCHETYPE alone, so `chesky` and `lenny` — two faces
 * onto `operator` — are byte-identical fighters and no per-face number can ever
 * diverge. Each block below names the proxy it measures and ships an
 * anti-vacuity control, because three of this project's documented lying
 * harnesses shared one shape: a test that checks ONE member of a set while the
 * rest go unverified. Every set here (the six skins, both fighter slots) is
 * checked whole.
 *
 * Cross-administered: expect a peer to write a mutation AGAINST this file. The
 * mutations it must catch are spelled out inline so that adversary knows the
 * bar.
 */

import { describe, it, expect } from 'vitest'
import { MatchSim } from '../../play/MatchSim'
import {
  getFighterDef,
  resolveSimFighter,
  applySkinDeltas,
  SKINS,
  FIGHTERS,
} from '../fighters'
import { ROSTER } from '../../fighthud/select/roster'
import type { Controller } from '../../play/MatchSim'

const DUMMIES: [Controller, Controller] = [{ kind: 'dummy' }, { kind: 'dummy' }]

describe('skin seam — the skin reaches the sim', () => {
  // PROXY: the id the sim stamps on each constructed fighter
  // (`FightState.fighters[i].id`). It is load-bearing, not cosmetic — `sim.ts`
  // re-resolves the moveset every frame via `getFighterDef(f.id)` — so if the
  // skin reaches THIS field, its deltas reach the strike.
  it('constructs both fighters from the SKIN when the pick is coherent', () => {
    const sim = new MatchSim({
      p1: { skin: 'chesky', base: 'operator' },
      p2: { skin: 'doshi', base: 'warden' },
      controllers: DUMMIES,
    })
    const [a, b] = sim.current.fighters
    // Both slots, not one: the "one member checked" blindness is the named risk.
    expect(a.id).toBe('chesky')
    expect(b.id).toBe('doshi')
    // ANTI-VACUITY: prove this is not trivially true because the id is always the
    // skin. A resolveSimFighter that ignored `base` and always echoed the skin
    // would pass the block above AND silently break every capture tool that
    // forces a foreign archetype. So the collapse's OPPOSITE must also hold:
    expect(a.id).not.toBe('operator')
    expect(b.id).not.toBe('warden')
  })

  // PROXY: same field, under a DELIBERATE axis mismatch — the shape the capture
  // fleet depends on (`?a=spiegel&p1=warden`: a vanguard face throwing warden's
  // fireballs). Here the sim must take the explicit BASE, never the face.
  it('constructs from the BASE when the pick forces a foreign archetype', () => {
    const sim = new MatchSim({
      p1: { skin: 'spiegel', base: 'warden' }, // vanguard face, warden moveset
      p2: { skin: 'lenny', base: 'vanguard' }, // operator face, vanguard moveset
      controllers: DUMMIES,
    })
    const [a, b] = sim.current.fighters
    expect(a.id).toBe('warden')
    expect(b.id).toBe('vanguard')
    // ANTI-VACUITY: and NOT the faces — the mismatch axis is real, not collapsed.
    expect(a.id).not.toBe('spiegel')
    expect(b.id).not.toBe('lenny')
  })
})

describe('skin seam — resolveSimFighter reconciles the two axes (whole set)', () => {
  // PROXY: the registry key resolveSimFighter hands createFight. Checked across
  // ALL SIX skins in both directions — coherent and mismatched — so no single
  // face can be the one that silently collapses.
  it('coherent pick (skin.base === base) resolves to the SKIN, for every skin', () => {
    const skins = Object.keys(SKINS)
    expect(skins.length).toBe(6) // guard the set size itself
    for (const skin of skins) {
      const base = SKINS[skin].base
      expect(resolveSimFighter({ skin, base })).toBe(skin)
    }
  })

  it('mismatched pick resolves to the BASE, for every skin', () => {
    const archetypes = Object.keys(FIGHTERS) // operator, vanguard, warden
    for (const skin of Object.keys(SKINS)) {
      const natural = SKINS[skin].base
      // pick any archetype that is NOT this skin's natural base
      const foreign = archetypes.find((a) => a !== natural)!
      expect(resolveSimFighter({ skin, base: foreign })).toBe(foreign)
      // ANTI-VACUITY: the coherent case above could pass with "always return
      // skin"; this case fails that mutation. Together they pin the reconcile.
      expect(resolveSimFighter({ skin, base: foreign })).not.toBe(skin)
    }
  })

  it('unknown skin resolves to the BASE, so getFighterDef is never asked for a bad id', () => {
    // `?a=reid` is a real capture (probe-portraits.mjs) — an unknown face the
    // renderer degrades to a letter badge. The sim must fall through to the
    // archetype, never call getFighterDef('reid') (which throws).
    expect(SKINS['reid']).toBeUndefined()
    expect(resolveSimFighter({ skin: 'reid', base: 'operator' })).toBe('operator')
    expect(() => getFighterDef('reid')).toThrow()
  })
})

describe('skin seam — the delta mechanism is real and immutable', () => {
  // PROXY: the fields of the def applySkinDeltas returns vs. the base it was
  // given. This is the mechanism that will let chesky out-hit lenny; if it does
  // not actually layer a delta onto the CONSUMED path, the seam is decorative.
  it('layers a hit delta onto exactly the targeted move, leaving the base untouched', () => {
    const base = getFighterDef('operator')
    const ids = Object.keys(base.moves)
    expect(ids.length).toBeGreaterThanOrEqual(2) // need a target AND a sibling
    const target = ids[0]
    const sibling = ids[1]

    const baseDamageBefore = base.moves[target].hit.damage
    const siblingDamageBefore = base.moves[sibling].hit.damage

    const resolved = applySkinDeltas(base, 'fixture-skin', {
      base: 'operator',
      health: base.health + 137,
      moves: { [target]: { hit: { damage: baseDamageBefore + 999 } } },
    })

    // delta applied on the target
    expect(resolved.id).toBe('fixture-skin')
    expect(resolved.health).toBe(base.health + 137)
    expect(resolved.moves[target].hit.damage).toBe(baseDamageBefore + 999)
    // sibling move untouched — a delta is surgical, not a broadcast
    expect(resolved.moves[sibling].hit.damage).toBe(siblingDamageBefore)
    // non-delta'd fields of the target survive the shallow merge (e.g. hitstun)
    expect(resolved.moves[target].hit.hitstun).toBe(base.moves[target].hit.hitstun)

    // ANTI-VACUITY / IMMUTABILITY: the base singleton MUST be unchanged. Two
    // faces share one base; an in-place mutation would leak one skin's numbers
    // into the other and into the archetype. A mutation that did
    // `base.moves[t].hit.damage += 999` would make this fail.
    expect(base.moves[target].hit.damage).toBe(baseDamageBefore)
    expect(base.moves[sibling].hit.damage).toBe(siblingDamageBefore)
    expect(resolved.moves[target]).not.toBe(base.moves[target]) // new object
    expect(resolved.moves[target].hit).not.toBe(base.moves[target].hit)
  })

  it('drops a delta keyed to a move the base does not have (a delta cannot invent a move)', () => {
    const base = getFighterDef('operator')
    const resolved = applySkinDeltas(base, 'ghost-skin', {
      base: 'operator',
      moves: { 'no-such-move': { hit: { damage: 9999 } } },
    })
    expect(resolved.moves['no-such-move']).toBeUndefined()
    // and the real moves are all still present and unchanged
    for (const id of Object.keys(base.moves)) {
      expect(resolved.moves[id].hit.damage).toBe(base.moves[id].hit.damage)
    }
  })
})

describe('skin seam — the seam lands INERT (no face diverges yet)', () => {
  // PROXY: per-move reference identity between a shipped skin's resolved def and
  // its base. With zero deltas authored, applySkinDeltas returns the base's OWN
  // move objects (same refs); only `id` differs. This block is the "no
  // divergence yet" contract and is EXPECTED to be edited the day the first real
  // per-face delta lands — that edit is the design work this seam unblocks.
  it('every shipped skin is byte-identical to its base but for id', () => {
    for (const [skin, def] of Object.entries(SKINS)) {
      const resolved = getFighterDef(skin)
      const base = getFighterDef(def.base)
      expect(resolved.id).toBe(skin)
      expect(resolved.health).toBe(base.health)
      // structural fields carried by reference (nothing rebuilt)
      expect(resolved.select).toBe(base.select)
      expect(resolved.projectiles).toBe(base.projectiles)
      // and every move is the SAME object (no delta cloned it)
      const baseIds = Object.keys(base.moves)
      expect(Object.keys(resolved.moves)).toEqual(baseIds)
      for (const id of baseIds) {
        expect(resolved.moves[id]).toBe(base.moves[id])
      }
    }
  })
})

describe('skin seam — the two registries agree', () => {
  // PROXY: the skin→archetype pairing, held in BOTH the sim registry (SKINS) and
  // the select screen's presentation roster (ROSTER, owned by fighthud). They
  // are hand-maintained mirrors; drift is how a face ends up choosable but
  // unbuildable, or built as the wrong archetype. Checked as a bijection so a
  // skin missing from EITHER side fails.
  it('SKINS and the select roster cover the same faces, mapped to the same bases', () => {
    const rosterSkins = ROSTER.map((e) => e.skin).sort()
    const simSkins = Object.keys(SKINS).sort()
    expect(simSkins).toEqual(rosterSkins)
    for (const entry of ROSTER) {
      expect(SKINS[entry.skin]?.base).toBe(entry.archetype)
    }
  })

  it('every skin base is a real archetype in FIGHTERS', () => {
    for (const [skin, def] of Object.entries(SKINS)) {
      expect(FIGHTERS[def.base], `${skin} → ${def.base}`).toBeDefined()
    }
  })
})
