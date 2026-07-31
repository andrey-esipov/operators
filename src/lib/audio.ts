/**
 * SFX facade.
 *
 * Historically this file synthesised small chiptune blips inline. It now
 * DELEGATES to the AAA procedural fight-audio engine in `src/audio/**`
 * (`fightAudio`) — layered, mastered, reverberant impacts synthesised entirely
 * with the Web Audio API (zero asset cost). The public `Sfx` surface is
 * unchanged so every existing call site (CombatScreen, menus, cinematics)
 * keeps working; each method is argument-free exactly as before.
 *
 * A single shared AudioContext lives inside `fightAudio`; it is created lazily
 * and resumed on the first user gesture (menu clicks/hover all route here).
 */

import { fightAudio } from '../audio'

// Resume the shared context on any SFX call. `resume()` is idempotent and only
// succeeds inside a user-gesture task, which every call site below is.
function wake() {
  fightAudio.init()
  fightAudio.resume()
}

export const Sfx = {
  // ─── impacts → the layered AAA impact engine ────────────────────────
  light() { wake(); fightAudio.impact('light') },
  heavy() { wake(); fightAudio.impact('heavy') },
  crit() { wake(); fightAudio.impact('crit') },
  combo() { wake(); fightAudio.impact('combo') },
  ult() { wake(); fightAudio.impact('ult') },
  ex() { wake(); fightAudio.impact('ex') },
  signature() { wake(); fightAudio.impact('signature') },
  shatter() { wake(); fightAudio.shatter() },
  ko() { wake(); fightAudio.ko() },

  // ─── menu / UI feel ─────────────────────────────────────────────────
  menuMove() { wake(); fightAudio.menuMove() },
  menuSelect() { wake(); fightAudio.menuSelect() },

  /** Round-start "FIGHT!" tonal stinger (the announcer voice line is separate). */
  fight() { wake(); fightAudio.superStinger() },

  // ─── match end ──────────────────────────────────────────────────────
  victory() { wake(); fightAudio.victory() },
  defeat() { wake(); fightAudio.defeat() },
}
