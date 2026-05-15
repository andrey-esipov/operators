import type { Discipline, Era, FighterDef } from '../types'

/**
 * Per-fighter taxonomy: which discipline + era the operator belongs to.
 *
 * Kept as a separate map rather than inlined on each fighter def so:
 *   1. The 40-fighter backfill doesn't require a 40-row diff per axis.
 *   2. A new fighter can either declare these inline OR be added here.
 *
 * Discipline reflects the operator's primary craft on the podcast (a PM-CEO
 * is 'product', a CTO-builder is 'engineering', a marketplace VC is 'capital').
 * Era buckets are coarse: ep 1-99 = early, 100-199 = mid, 200+ = recent.
 */
export const FIGHTER_TAXONOMY: Record<string, { discipline: Discipline; era: Era }> = {
  // ─── PRODUCT ──────────────────────────────────────────────────────
  chesky:    { discipline: 'product',     era: 'recent' },
  doshi:     { discipline: 'product',     era: 'mid' },
  catwu:     { discipline: 'product',     era: 'recent' },
  spiegel:   { discipline: 'product',     era: 'recent' },
  cagan:     { discipline: 'product',     era: 'early' },
  stewart:   { discipline: 'product',     era: 'recent' },
  // ─── DESIGN ───────────────────────────────────────────────────────
  dylan:     { discipline: 'design',      era: 'mid' },
  julie:     { discipline: 'design',      era: 'early' },
  melanie:   { discipline: 'design',      era: 'recent' },
  // ─── ENGINEERING ──────────────────────────────────────────────────
  tobi:      { discipline: 'engineering', era: 'recent' },
  drew:      { discipline: 'engineering', era: 'recent' },
  jason:     { discipline: 'engineering', era: 'early' },
  taylor:    { discipline: 'engineering', era: 'recent' },
  amjad:     { discipline: 'engineering', era: 'recent' },
  boz:       { discipline: 'engineering', era: 'recent' },
  boris:     { discipline: 'engineering', era: 'recent' },
  // ─── GROWTH ───────────────────────────────────────────────────────
  madhavan:  { discipline: 'growth',      era: 'recent' },
  dunford:   { discipline: 'growth',      era: 'mid' },
  seth:      { discipline: 'growth',      era: 'recent' },
  nikita:    { discipline: 'growth',      era: 'mid' },
  benioff:   { discipline: 'growth',      era: 'recent' },
  dharmesh:  { discipline: 'growth',      era: 'mid' },
  rahul:     { discipline: 'growth',      era: 'early' },
  elena:     { discipline: 'growth',      era: 'mid' },
  // ─── AI ───────────────────────────────────────────────────────────
  altman:    { discipline: 'ai',          era: 'recent' },
  turley:    { discipline: 'ai',          era: 'recent' },
  lazar:     { discipline: 'ai',          era: 'recent' },
  krieger:   { discipline: 'ai',          era: 'recent' },
  simon:     { discipline: 'ai',          era: 'recent' },
  feifei:    { discipline: 'ai',          era: 'recent' },
  aparna:    { discipline: 'ai',          era: 'recent' },
  // ─── CAPITAL ──────────────────────────────────────────────────────
  andreessen:{ discipline: 'capital',     era: 'recent' },
  horowitz:  { discipline: 'capital',     era: 'recent' },
  tavel:     { discipline: 'capital',     era: 'mid' },
  maples:    { discipline: 'capital',     era: 'recent' },
  jessica:   { discipline: 'capital',     era: 'mid' },
  // ─── OPS ──────────────────────────────────────────────────────────
  gokul:     { discipline: 'ops',         era: 'mid' },
  annie:     { discipline: 'ops',         era: 'recent' },
  ries:      { discipline: 'ops',         era: 'early' },
  // ─── HOST ─────────────────────────────────────────────────────────
  lenny:     { discipline: 'host',        era: 'recent' },

  // ─── WAVE 4 (May 2026 expansion) ──────────────────────────────────
  reid:      { discipline: 'capital',     era: 'mid' },
  sellis:    { discipline: 'growth',      era: 'early' },
  achen:     { discipline: 'growth',      era: 'mid' },
  balfour:   { discipline: 'growth',      era: 'mid' },
  kscott:    { discipline: 'ops',         era: 'early' },
  torres:    { discipline: 'product',     era: 'mid' },
  perri:     { discipline: 'product',     era: 'mid' },
  wlarson:   { discipline: 'engineering', era: 'recent' },
  cfournier: { discipline: 'engineering', era: 'mid' },
  belsky:    { discipline: 'design',      era: 'mid' },
  rabois:    { discipline: 'capital',     era: 'recent' },
  forsgren:  { discipline: 'engineering', era: 'recent' },
  duarte:    { discipline: 'design',      era: 'mid' },
  pcampbell: { discipline: 'growth',      era: 'mid' },
  eliz:      { discipline: 'growth',      era: 'mid' },
  wodtke:    { discipline: 'product',     era: 'mid' },
  gilad:     { discipline: 'product',     era: 'mid' },
  gmoore:    { discipline: 'growth',      era: 'mid' },
  rmartin:   { discipline: 'ops',         era: 'mid' },
  rumelt:    { discipline: 'ops',         era: 'mid' },
  moesta:    { discipline: 'product',     era: 'mid' },
  cutler:    { discipline: 'product',     era: 'mid' },
  logan:     { discipline: 'ai',          era: 'recent' },
  truell:    { discipline: 'ai',          era: 'recent' },
}

/**
 * Parse the episode tag into an integer for era derivation. Accepts forms
 * like 'ep 217', 'ep 1–298' (Lenny), or 'ep 56'. Returns null when the tag
 * is a range or unparseable — caller decides on the fallback.
 */
function parseEpisodeNumber(ep: string): number | null {
  // Range form ("ep 1–298") returns null — host-style entries fall through.
  if (ep.includes('–') || ep.includes('-') || ep.includes('+')) return null
  const m = ep.match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

export function getEra(f: FighterDef): Era {
  if (f.era) return f.era
  const explicit = FIGHTER_TAXONOMY[f.id]?.era
  if (explicit) return explicit
  const n = parseEpisodeNumber(f.episode)
  if (n === null) return 'recent'
  if (n < 100) return 'early'
  if (n < 200) return 'mid'
  return 'recent'
}

export function getDiscipline(f: FighterDef): Discipline {
  if (f.discipline) return f.discipline
  const explicit = FIGHTER_TAXONOMY[f.id]?.discipline
  if (explicit) return explicit
  // Conservative default for a fighter without taxonomy info.
  return 'product'
}

/** Display label for a Discipline value. */
export const DISCIPLINE_LABEL: Record<Discipline, string> = {
  product:     'PRODUCT',
  design:      'DESIGN',
  engineering: 'ENGINEERING',
  growth:      'GROWTH',
  ai:          'AI',
  capital:     'CAPITAL',
  ops:         'OPS',
  host:        'HOST',
}

/** Display label for an Era value. */
export const ERA_LABEL: Record<Era, string> = {
  early:  'EARLY · ep 1-99',
  mid:    'MID · ep 100-199',
  recent: 'RECENT · ep 200+',
}

/** Accent color for each discipline — used by filter chips and sprite cells. */
export const DISCIPLINE_COLOR: Record<Discipline, string> = {
  product:     '#FFD60A',
  design:      '#F72585',
  engineering: '#06D6A0',
  growth:      '#F77F00',
  ai:          '#7209B7',
  capital:     '#00B4D8',
  ops:         '#FCBF49',
  host:        '#E63946',
}
