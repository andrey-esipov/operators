import type { AIProfile } from '../types'

/**
 * Per-fighter AI personalities — applied when this fighter is bot-controlled.
 *
 * Profile dimensions:
 *   aggression    — heavy/ult weight multiplier (>1 = aggressive)
 *   comboFocus    — combo/setup weight (>1 = sets up combos)
 *   ultRush       — bias toward casting ult ASAP (>1 = clutch-y)
 *   defensiveBias — chance to play light/setup when below 30% HP (0..1)
 *
 * Designed so the bot "plays like" the real operator's philosophy.
 * Missing entries fall back to neutral 1/1/1/0.
 */
export const AI_PROFILES: Record<string, AIProfile> = {
  // ─── AGGRO / FOUNDER MODE ────────────────────────────────────────
  chesky:    { aggression: 1.6, comboFocus: 1.4, ultRush: 1.5, defensiveBias: 0.0 },
  nikita:    { aggression: 1.8, comboFocus: 1.1, ultRush: 1.8, defensiveBias: 0.0 },  // Glass cannon
  altman:    { aggression: 1.5, comboFocus: 0.8, ultRush: 1.6, defensiveBias: 0.0 },

  // ─── STRATEGY / CONTROL ─────────────────────────────────────────
  doshi:     { aggression: 0.7, comboFocus: 1.6, ultRush: 0.8, defensiveBias: 0.5 },
  cagan:     { aggression: 0.8, comboFocus: 1.5, ultRush: 0.9, defensiveBias: 0.4 },
  dunford:   { aggression: 0.9, comboFocus: 1.3, ultRush: 0.9, defensiveBias: 0.3 },
  annie:     { aggression: 0.7, comboFocus: 1.5, ultRush: 0.7, defensiveBias: 0.6 },  // Pre-mortem fan
  madhavan:  { aggression: 0.9, comboFocus: 1.4, ultRush: 1.0, defensiveBias: 0.3 },

  // ─── TEMPO / SPEED ──────────────────────────────────────────────
  catwu:     { aggression: 1.3, comboFocus: 1.2, ultRush: 1.4, defensiveBias: 0.1 },
  tobi:      { aggression: 1.4, comboFocus: 1.2, ultRush: 1.3, defensiveBias: 0.1 },
  stewart:   { aggression: 1.1, comboFocus: 1.3, ultRush: 1.1, defensiveBias: 0.2 },

  // ─── AI-NATIVE ──────────────────────────────────────────────────
  lazar:     { aggression: 1.3, comboFocus: 0.9, ultRush: 1.5, defensiveBias: 0.0 },  // Chaos
  amjad:     { aggression: 1.2, comboFocus: 1.2, ultRush: 1.3, defensiveBias: 0.1 },
  boris:     { aggression: 1.5, comboFocus: 1.3, ultRush: 1.4, defensiveBias: 0.0 },  // Five agents
  krieger:   { aggression: 1.0, comboFocus: 1.4, ultRush: 1.2, defensiveBias: 0.2 },
  simon:     { aggression: 1.0, comboFocus: 1.4, ultRush: 1.2, defensiveBias: 0.3 },
  turley:    { aggression: 1.4, comboFocus: 1.0, ultRush: 1.4, defensiveBias: 0.0 },

  // ─── DISTRIBUTION / GROWTH ──────────────────────────────────────
  spiegel:   { aggression: 0.9, comboFocus: 1.2, ultRush: 0.9, defensiveBias: 0.5 },  // Tank
  seth:      { aggression: 1.0, comboFocus: 1.3, ultRush: 1.0, defensiveBias: 0.3 },

  // ─── POLYMATH / ADAPTIVE ────────────────────────────────────────
  taylor:    { aggression: 1.1, comboFocus: 1.2, ultRush: 1.1, defensiveBias: 0.2 },
  julie:     { aggression: 0.9, comboFocus: 1.4, ultRush: 1.0, defensiveBias: 0.3 },

  // ─── ORACLE / VC ─────────────────────────────────────────────────
  andreessen: { aggression: 1.3, comboFocus: 1.2, ultRush: 1.3, defensiveBias: 0.2 },

  // ─── ENGINEERING / BUILDER ──────────────────────────────────────
  drew:      { aggression: 0.8, comboFocus: 1.3, ultRush: 0.9, defensiveBias: 0.5 },  // Tank
  dylan:     { aggression: 1.1, comboFocus: 1.4, ultRush: 1.1, defensiveBias: 0.2 },

  // ─── CALM CONTRARIAN ────────────────────────────────────────────
  jason:     { aggression: 0.6, comboFocus: 1.6, ultRush: 0.6, defensiveBias: 0.8 },  // Patient

  // ─── ORG DESIGN ─────────────────────────────────────────────────
  gokul:     { aggression: 0.9, comboFocus: 1.5, ultRush: 1.0, defensiveBias: 0.3 },

  // ─── BOSS — LENNY ───────────────────────────────────────────────
  // Pattern-matches everything; aggressive late-game with pattern-match ult.
  lenny:     { aggression: 1.3, comboFocus: 1.5, ultRush: 1.4, defensiveBias: 0.2 },
}
