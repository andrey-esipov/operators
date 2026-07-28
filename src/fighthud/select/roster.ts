/**
 * Select-screen roster — owned by src/fighthud/**.
 *
 * The game has two decoupled axes the player never sees: a *skin* (`?a`/`?b`,
 * the atlas + name + accent, from the card roster) and an *archetype*
 * (`?p1`/`?p2`, the moveset the sim actually fights, from src/fight/fighters).
 * A player picking "blind" was the whole complaint: a grappler has 1150 HP and
 * a zoner throws fireballs, and none of that is visible in a URL. This table is
 * the one place the two axes are joined into something choosable, with the
 * archetype surfaced as the meaningful part of the pick.
 *
 * Only skins with real atlas art are listed (the critic confirmed these are
 * genuine portraits, not letter badges). Two faces per archetype so each style
 * is represented and the grid reads as a balanced 3x2.
 */

/** The three sim movesets. Keep ids in sync with src/fight/fighters/index.ts. */
export type ArchetypeId = 'operator' | 'vanguard' | 'warden'

export interface ArchetypeInfo {
  id: ArchetypeId
  /** Genre shorthand the player recognises. */
  label: string
  /** One-line read on how it fights. */
  blurb: string
  /** Starting health — the single most legible stat difference between styles. */
  hp: number
  accent: string
}

/** Mirrors src/fight/fighters/*.ts (operator=MAX_HEALTH 1000, vanguard 1150, warden 900). */
export const ARCHETYPES: Record<ArchetypeId, ArchetypeInfo> = {
  operator: { id: 'operator', label: 'SHOTO', blurb: 'Balanced • fireball + uppercut', hp: 1000, accent: '#f4c130' },
  vanguard: { id: 'vanguard', label: 'GRAPPLER', blurb: 'Rushdown • command grabs, high HP', hp: 1150, accent: '#ef4d3a' },
  warden: { id: 'warden', label: 'ZONER', blurb: 'Keepaway • bolts + long pokes', hp: 900, accent: '#2f9bd8' },
}

export interface RosterEntry {
  /** Atlas / card-roster id, passed as `?a` or `?b`. */
  skin: string
  name: string
  shortName: string
  accent: string
  archetype: ArchetypeId
}

/** The choosable roster. skin ids all have `/fighters/<id>/atlas.png`. */
export const ROSTER: RosterEntry[] = [
  { skin: 'chesky', name: 'Brian Chesky', shortName: 'CHESKY', accent: '#E63946', archetype: 'operator' },
  { skin: 'spiegel', name: 'Evan Spiegel', shortName: 'SPIEGEL', accent: '#FCBF49', archetype: 'vanguard' },
  { skin: 'doshi', name: 'Shreyas Doshi', shortName: 'DOSHI', accent: '#0077B6', archetype: 'warden' },
  { skin: 'lenny', name: 'Lenny Rachitsky', shortName: 'LENNY', accent: '#FFD60A', archetype: 'operator' },
  { skin: 'madhavan', name: 'Madhavan Ramanujam', shortName: 'MADHAVAN', accent: '#F72585', archetype: 'vanguard' },
  { skin: 'turley', name: 'Nick Turley', shortName: 'TURLEY', accent: '#06D6A0', archetype: 'warden' },
]

export interface StageEntry {
  id: string
  name: string
  /** Short note the player sees — provenance from the blind rankings. */
  note?: string
  /** A swatch pair to stand in for a 3D thumbnail on the card. */
  swatch: [string, string]
}

/**
 * Stages, ordered best-first by the blind, shuffled ranking (pre-pmf won 7.5;
 * monetization came last at 5.5; ipo-prep 4th). `ai-native` has never once been
 * captured by anyone — flagged so the capture tool checks it renders rather than
 * assuming it does.
 */
export const STAGES: StageEntry[] = [
  { id: 'pre-pmf', name: 'THE GARAGE', note: 'TOP RANKED', swatch: ['#f0b429', '#3a2a18'] },
  { id: 'hypergrowth', name: 'THE ROCKET DECK', swatch: ['#ff6b3d', '#1a1030'] },
  { id: 'crisis', name: 'THE WAR ROOM', swatch: ['#e63946', '#14090c'] },
  { id: 'distribution', name: 'THE CHANNEL', swatch: ['#06d6a0', '#0a1a1a'] },
  { id: 'plateau', name: 'THE FLATLINE', swatch: ['#6c7a89', '#12161a'] },
  { id: 'ipo-prep', name: 'THE LISTING FLOOR', swatch: ['#00b4d8', '#08121a'] },
  { id: 'ai-native', name: 'THE MODEL FLOOR', note: 'UNTESTED', swatch: ['#b388ff', '#0c0a1a'] },
  { id: 'monetization', name: 'THE PRICING ROOM', swatch: ['#f72585', '#1a0a14'] },
]
