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
let currentAudio: HTMLAudioElement | null = null

/**
 * Map of (fighterId, lineKey) → "available on server" so we don't 404 every time.
 * Lazily populated by the first probe.
 */
const audioFileExists = new Map<string, boolean>()

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

/**
 * Strongly prefer high-quality voices over default robotic ones.
 *
 * Quality hierarchy (highest first):
 *   1. Per-fighter preferred name + "(Premium)" or "(Enhanced)" suffix
 *   2. Per-fighter preferred name (base — still works)
 *   3. ANY voice with "Premium" / "Enhanced" / "Neural" / "Natural" markers
 *   4. Cloud voices: "Google US English", "Microsoft Aria Online", etc.
 *   5. Fallback to first English voice
 *
 * On macOS the user has to download Enhanced/Premium voices in System
 * Settings → Accessibility → Spoken Content. Once they do, the picker
 * upgrades automatically.
 */
function pickVoice(profile: VoiceProfile): SpeechSynthesisVoice | null {
  const all = loadVoices()
  if (all.length === 0) return null

  const isHighQuality = (name: string) =>
    /\b(premium|enhanced|neural|natural|online|wavenet)\b/i.test(name) ||
    /^google /i.test(name) ||
    /^microsoft .+ online/i.test(name)

  // 1. Per-fighter preference, upgraded with Premium/Enhanced suffix
  if (profile.prefer) {
    for (const want of profile.prefer) {
      const upgraded = all.find(
        (v) => v.name.toLowerCase().includes(want.toLowerCase()) && isHighQuality(v.name),
      )
      if (upgraded) return upgraded
    }
    for (const want of profile.prefer) {
      const base = all.find((v) => v.name.toLowerCase().includes(want.toLowerCase()))
      if (base) return base
    }
  }

  // 2. Any high-quality English voice
  const hqEnglish = all.find((v) => v.lang.startsWith('en') && isHighQuality(v.name))
  if (hqEnglish) return hqEnglish

  // 3. Plain English fallback
  const en = all.find((v) => v.lang.startsWith('en'))
  return en ?? all[0]
}

/**
 * Smooth-out trick: add a tiny per-utterance pitch variance to break the
 * monotone, and a slight rate slowdown so we don't sound like a sportscaster.
 */
function applyHumanization(profile: VoiceProfile): VoiceProfile {
  const jitter = (Math.random() - 0.5) * 0.06  // ±0.03 on pitch
  return {
    ...profile,
    rate: Math.max(0.7, profile.rate * 0.95),   // slightly slower → less robotic
    pitch: Math.max(0.4, Math.min(1.8, profile.pitch + jitter)),
  }
}

/**
 * Try to play a pre-rendered audio file from public/audio/voices/{id}/{key}.m4a.
 * Returns true if playback was kicked off, false if no file exists.
 */
function tryPlayPrerendered(fighterId: string, lineKey: string): boolean {
  const url = `/audio/voices/${fighterId}/${lineKey}.mp3`
  const cacheKey = `${fighterId}:${lineKey}`
  if (audioFileExists.get(cacheKey) === false) return false  // known missing

  // Stop the current clip before starting a new one
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
    currentAudio = null
  }

  const a = new Audio(url)
  a.volume = 0.85
  a.addEventListener('error', () => {
    // First load failed — remember it for future calls so we don't keep
    // probing the network for missing files.
    audioFileExists.set(cacheKey, false)
  })
  a.addEventListener('canplay', () => {
    audioFileExists.set(cacheKey, true)
  })
  a.play().catch(() => {
    audioFileExists.set(cacheKey, false)
  })
  currentAudio = a
  return true
}

export const Voice = {
  say(text: string, fighterId?: string, lineKey?: string) {
    if (!enabled) return

    // Path 1: pre-rendered macOS-say audio file (sounds way better than TTS).
    // Falls through to SpeechSynthesis if the file isn't there.
    if (fighterId && lineKey) {
      const cacheKey = `${fighterId}:${lineKey}`
      const known = audioFileExists.get(cacheKey)
      if (known !== false) {
        if (tryPlayPrerendered(fighterId, lineKey)) {
          // If file exists (cached or first-try), we're done. If first-try
          // fails, the error handler flips the cache flag false and the
          // next call falls through to TTS.
          if (known === true) return
          // Optimistic: return early. If file was missing, next call will TTS.
          return
        }
      }
    }

    const s = getSynth()
    if (!s) return  // SpeechSynthesis unavailable — silently no-op
    // Cancel any in-flight speech to avoid overlap, but ONLY if currently
    // speaking — calling cancel() during paused/idle state on some macOS
    // Chrome versions can leave the engine in a stuck state where the next
    // .speak() does nothing.
    if (s.speaking || s.pending) s.cancel()

    const baseProfile = (fighterId && FIGHTER_PROFILES[fighterId]) || DEFAULT_PROFILE
    const profile = applyHumanization(baseProfile)
    const utter = new SpeechSynthesisUtterance(text)
    const v = pickVoice(profile)
    if (v) utter.voice = v
    // Explicit lang fixes iOS Safari which won't speak without it set.
    utter.lang = v?.lang ?? 'en-US'
    utter.rate = profile.rate
    utter.pitch = profile.pitch
    utter.volume = profile.volume
    try {
      s.speak(utter)
    } catch {
      // SpeechSynthesis can throw on some browsers when the synth is in a
      // bad state. Swallow — voice lines are non-critical flavor.
    }
  },
  stop() {
    getSynth()?.cancel()
    if (currentAudio) {
      currentAudio.pause()
      currentAudio.currentTime = 0
      currentAudio = null
    }
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
