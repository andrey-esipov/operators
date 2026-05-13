/**
 * Browser SpeechSynthesis voice lines.
 *
 * Free, ships everywhere, no paid services. Picks a stable voice per fighter
 * (different voices give different fighters identity). Rate/pitch tuned per
 * fighter archetype where it makes sense (Lenny = deep+slow boss voice etc.).
 *
 * Public API:
 *   Voice.say(text, fighterId, vocalProfile?)
 *   Voice.stop()
 *   Voice.toggle()
 *   Voice.isEnabled()
 *   Voice.setEnabled(bool)
 */

let enabled = true
let synth: SpeechSynthesis | null = null
let voicesCache: SpeechSynthesisVoice[] = []

interface VoiceProfile {
  rate: number    // 0.1..10 (default 1)
  pitch: number   // 0..2 (default 1)
  volume: number  // 0..1 (default 1)
  /** Voice-name keywords to prefer (e.g. ["Daniel", "Google US English"]) */
  prefer?: string[]
}

const DEFAULT_PROFILE: VoiceProfile = { rate: 1.05, pitch: 1.0, volume: 0.85 }

// Per-fighter profiles. Speech pitch is the strongest differentiator on
// browser default voices. Roughly: aggressive/old = lower pitch, glass/
// young = higher pitch. Female fighters use the system "female" voice
// when one is present.
const FIGHTER_PROFILES: Record<string, VoiceProfile> = {
  chesky:    { rate: 1.05, pitch: 1.0,  volume: 0.85, prefer: ['Daniel', 'Alex', 'Google US English'] },
  doshi:     { rate: 1.0,  pitch: 1.05, volume: 0.85, prefer: ['Rishi', 'Veena', 'Google UK English Male'] },
  catwu:     { rate: 1.1,  pitch: 1.4,  volume: 0.85, prefer: ['Tessa', 'Samantha', 'Google UK English Female'] },
  madhavan:  { rate: 1.0,  pitch: 1.1,  volume: 0.85, prefer: ['Rishi', 'Veena'] },
  spiegel:   { rate: 1.0,  pitch: 0.95, volume: 0.85, prefer: ['Alex', 'Daniel'] },
  turley:    { rate: 1.15, pitch: 1.15, volume: 0.85, prefer: ['Alex', 'Google US English'] },
  cagan:     { rate: 0.95, pitch: 0.9,  volume: 0.85, prefer: ['Daniel', 'Alex'] },
  altman:    { rate: 1.05, pitch: 1.0,  volume: 0.85, prefer: ['Alex'] },
  taylor:    { rate: 1.0,  pitch: 1.0,  volume: 0.85, prefer: ['Alex', 'Daniel'] },
  lazar:     { rate: 1.15, pitch: 1.05, volume: 0.85 },
  amjad:     { rate: 1.05, pitch: 1.05, volume: 0.85 },
  gokul:     { rate: 1.0,  pitch: 1.05, volume: 0.85, prefer: ['Rishi'] },
  dunford:   { rate: 1.0,  pitch: 1.3,  volume: 0.85, prefer: ['Samantha', 'Karen', 'Tessa'] },
  andreessen:{ rate: 0.95, pitch: 0.85, volume: 0.9,  prefer: ['Alex'] },
  tobi:      { rate: 1.05, pitch: 0.95, volume: 0.85, prefer: ['Daniel', 'Alex'] },
  drew:      { rate: 1.05, pitch: 1.0,  volume: 0.85, prefer: ['Alex'] },
  dylan:     { rate: 1.1,  pitch: 1.05, volume: 0.85, prefer: ['Alex'] },
  krieger:   { rate: 1.0,  pitch: 1.0,  volume: 0.85, prefer: ['Daniel', 'Alex'] },
  stewart:   { rate: 1.0,  pitch: 0.95, volume: 0.85, prefer: ['Daniel', 'Alex'] },
  jason:     { rate: 0.9,  pitch: 0.85, volume: 0.85, prefer: ['Alex'] },
  simon:     { rate: 1.0,  pitch: 1.0,  volume: 0.85, prefer: ['Daniel', 'Google UK English Male'] },
  seth:      { rate: 0.95, pitch: 1.05, volume: 0.85, prefer: ['Alex', 'Daniel'] },
  nikita:    { rate: 1.2,  pitch: 1.1,  volume: 0.85 },
  julie:     { rate: 1.0,  pitch: 1.25, volume: 0.85, prefer: ['Samantha', 'Tessa'] },
  annie:     { rate: 1.0,  pitch: 1.2,  volume: 0.85, prefer: ['Karen', 'Samantha'] },
  boris:     { rate: 1.1,  pitch: 1.05, volume: 0.85 },
  lenny:     { rate: 0.92, pitch: 0.8,  volume: 0.95, prefer: ['Daniel', 'Alex'] },  // Boss
}

function getSynth(): SpeechSynthesis | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null
  if (!synth) synth = window.speechSynthesis
  return synth
}

function loadVoices(): SpeechSynthesisVoice[] {
  const s = getSynth()
  if (!s) return []
  if (voicesCache.length > 0) return voicesCache
  voicesCache = s.getVoices()
  return voicesCache
}

// Voices load asynchronously in most browsers; refresh when they arrive.
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    voicesCache = window.speechSynthesis.getVoices()
  })
}

function pickVoice(profile: VoiceProfile): SpeechSynthesisVoice | null {
  const all = loadVoices()
  if (all.length === 0) return null
  if (profile.prefer) {
    for (const want of profile.prefer) {
      const m = all.find((v) => v.name.toLowerCase().includes(want.toLowerCase()))
      if (m) return m
    }
  }
  // Otherwise prefer an English voice
  const en = all.find((v) => v.lang.startsWith('en'))
  return en ?? all[0]
}

export const Voice = {
  say(text: string, fighterId?: string) {
    if (!enabled) return
    const s = getSynth()
    if (!s) return
    // Don't queue — speak the most recent line. Older speech gets cancelled.
    s.cancel()
    const profile = (fighterId && FIGHTER_PROFILES[fighterId]) || DEFAULT_PROFILE
    const utter = new SpeechSynthesisUtterance(text)
    const v = pickVoice(profile)
    if (v) utter.voice = v
    utter.rate = profile.rate
    utter.pitch = profile.pitch
    utter.volume = profile.volume
    try {
      s.speak(utter)
    } catch {
      // some browsers throw when called before user gesture — silently ignore
    }
  },
  stop() {
    getSynth()?.cancel()
  },
  isEnabled() {
    return enabled
  },
  setEnabled(v: boolean) {
    enabled = v
    if (!v) getSynth()?.cancel()
  },
  toggle() {
    Voice.setEnabled(!enabled)
  },
}
