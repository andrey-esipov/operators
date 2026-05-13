/**
 * Procedural chiptune music engine.
 *
 * No external audio assets — every track is a sequence of notes scheduled
 * directly against the WebAudio clock. Each track is a (loopable) bar with
 * lead + bass + drums voices.
 *
 * Public API:
 *   Music.play(track)   — start (or switch to) a track. Idempotent if same track.
 *   Music.stop()        — kill the current track and any scheduled notes
 *   Music.setVolume(v)  — 0..1 master gain (persists across track changes)
 *   Music.isOn()        — true if any track is playing
 *   Music.toggle()      — convenience for the menu CRT-style on/off toggle
 *
 * Tracks: 'menu' | 'fight' | 'fight-b' | 'boss' | 'victory' | 'defeat'
 */

export type TrackId = 'menu' | 'fight' | 'fight-b' | 'boss' | 'victory' | 'defeat'

let ctx: AudioContext | null = null
let masterGain: GainNode | null = null
let currentTrack: TrackId | null = null
let pendingTrack: TrackId | null = null  // remembered when context is suspended at play()-time
let stopFlag = 0  // incremented to cancel pending scheduled callbacks
let userVolume = 0.35  // 0..1 — kept modest; chiptune is loud
let unlockListenerAttached = false

function getCtx(): AudioContext {
  if (!ctx) {
    ctx = new (window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)()
    masterGain = ctx.createGain()
    masterGain.gain.value = userVolume
    masterGain.connect(ctx.destination)
  }
  return ctx
}

/**
 * Browsers gate WebAudio playback behind a user gesture (autoplay policy).
 * We can call ctx.resume() — but only inside a click/keydown/touch handler
 * will it actually transition from 'suspended' → 'running'. Attach a one-
 * time global listener that fires on the first gesture, resumes the
 * context, and if a track was queued earlier, kicks it off.
 */
function attachUnlockListener() {
  if (unlockListenerAttached || typeof window === 'undefined') return
  unlockListenerAttached = true
  const unlock = () => {
    const c = getCtx()
    if (c.state === 'suspended') {
      c.resume().then(() => {
        // If music was requested before the user clicked, start it now.
        if (pendingTrack && !currentTrack) {
          const t = pendingTrack
          pendingTrack = null
          Music.play(t)
        }
      }).catch(() => {})
    }
    // Keep this lightweight; remove ourselves now that we've resumed once.
    window.removeEventListener('click', unlock)
    window.removeEventListener('keydown', unlock)
    window.removeEventListener('touchstart', unlock)
    window.removeEventListener('pointerdown', unlock)
  }
  window.addEventListener('click', unlock, { once: false })
  window.addEventListener('keydown', unlock, { once: false })
  window.addEventListener('touchstart', unlock, { once: false })
  window.addEventListener('pointerdown', unlock, { once: false })
}

/** MIDI-style note name → frequency in Hz (4th octave is the reference). */
const NOTE: Record<string, number> = {
  C3:  130.81, 'C#3': 138.59, D3:  146.83, 'D#3': 155.56, E3:  164.81, F3:  174.61, 'F#3': 185.00,
  G3:  196.00, 'G#3': 207.65, A3:  220.00, 'A#3': 233.08, B3:  246.94,
  C4:  261.63, 'C#4': 277.18, D4:  293.66, 'D#4': 311.13, E4:  329.63, F4:  349.23, 'F#4': 369.99,
  G4:  392.00, 'G#4': 415.30, A4:  440.00, 'A#4': 466.16, B4:  493.88,
  C5:  523.25, 'C#5': 554.37, D5:  587.33, 'D#5': 622.25, E5:  659.25, F5:  698.46, 'F#5': 739.99,
  G5:  783.99, 'G#5': 830.61, A5:  880.00, 'A#5': 932.33, B5:  987.77,
  C6: 1046.50, D6: 1174.66, E6: 1318.51, G6: 1567.98,
}

interface Note {
  /** Note name from NOTE table; null = rest */
  n: keyof typeof NOTE | null
  /** Duration in 16th-notes */
  d: number
}

interface Track {
  bpm: number
  /** Number of 16ths per loop (typically 32 = 2 bars 4/4) */
  loopSixteenths: number
  lead: Note[]
  bass: Note[]
  /** Drum pattern: each char is a 16th — K=kick, S=snare, H=hat, '-' = rest */
  drums: string
  /** Master volume scaling for this track */
  vol: number
  /** Lead waveform */
  leadType?: OscillatorType
}

// ─── Track definitions ────────────────────────────────────────────────

// MENU: cool synth-wave loop, A minor arpeggio + steady bass. Hopeful.
const MENU: Track = {
  bpm: 92,
  loopSixteenths: 32,
  lead: [
    { n: 'A4', d: 2 }, { n: 'C5', d: 2 }, { n: 'E5', d: 2 }, { n: 'C5', d: 2 },
    { n: 'A4', d: 2 }, { n: 'C5', d: 2 }, { n: 'E5', d: 2 }, { n: 'G5', d: 2 },
    { n: 'F4', d: 2 }, { n: 'A4', d: 2 }, { n: 'C5', d: 2 }, { n: 'A4', d: 2 },
    { n: 'F4', d: 2 }, { n: 'A4', d: 2 }, { n: 'C5', d: 2 }, { n: 'E5', d: 2 },
  ],
  bass: [
    { n: 'A3', d: 4 }, { n: 'A3', d: 4 }, { n: 'A3', d: 4 }, { n: 'A3', d: 4 },
    { n: 'F3', d: 4 }, { n: 'F3', d: 4 }, { n: 'F3', d: 4 }, { n: 'F3', d: 4 },
  ],
  drums: 'K---H---S---H---K-H-K---S---H---',
  vol: 0.8,
  leadType: 'square',
}

// FIGHT A: driving punchy fight loop. C minor.
const FIGHT_A: Track = {
  bpm: 132,
  loopSixteenths: 32,
  lead: [
    { n: 'G4', d: 1 }, { n: 'C5', d: 1 }, { n: 'D#5', d: 1 }, { n: 'G5', d: 1 },
    { n: 'D#5', d: 1 }, { n: 'C5', d: 1 }, { n: 'G4', d: 2 },
    { n: 'A#4', d: 1 }, { n: 'C5', d: 1 }, { n: 'D5', d: 1 }, { n: 'F5', d: 1 },
    { n: 'D5', d: 1 }, { n: 'C5', d: 1 }, { n: 'A#4', d: 2 },
    { n: 'F4', d: 1 }, { n: 'A#4', d: 1 }, { n: 'C5', d: 1 }, { n: 'F5', d: 1 },
    { n: 'C5', d: 1 }, { n: 'A#4', d: 1 }, { n: 'F4', d: 2 },
    { n: 'G4', d: 1 }, { n: 'A#4', d: 1 }, { n: 'C5', d: 1 }, { n: 'D#5', d: 1 },
    { n: 'G5', d: 1 }, { n: 'F5', d: 1 }, { n: 'D#5', d: 2 },
  ],
  bass: [
    { n: 'C3', d: 2 }, { n: 'C3', d: 2 }, { n: 'G3', d: 2 }, { n: 'C3', d: 2 },
    { n: 'A#3', d: 2 }, { n: 'A#3', d: 2 }, { n: 'F3', d: 2 }, { n: 'A#3', d: 2 },
    { n: 'F3', d: 2 }, { n: 'F3', d: 2 }, { n: 'C3', d: 2 }, { n: 'F3', d: 2 },
    { n: 'G3', d: 2 }, { n: 'G3', d: 2 }, { n: 'D#3', d: 2 }, { n: 'G3', d: 2 },
  ],
  drums: 'K-H-S-H-K-K-S-H-K-H-S-H-K-K-S-HH',
  vol: 0.85,
  leadType: 'square',
}

// FIGHT B: variation — minor-key syncopated.
const FIGHT_B: Track = {
  bpm: 138,
  loopSixteenths: 32,
  lead: [
    { n: 'E4', d: 1 }, { n: 'G4', d: 1 }, { n: 'B4', d: 1 }, { n: 'E5', d: 1 },
    { n: 'B4', d: 1 }, { n: 'G4', d: 1 }, { n: 'A4', d: 2 },
    { n: 'B4', d: 1 }, { n: 'D5', d: 1 }, { n: 'F5', d: 1 }, { n: 'B5', d: 1 },
    { n: 'F5', d: 1 }, { n: 'D5', d: 1 }, { n: 'B4', d: 2 },
    { n: 'E5', d: 1 }, { n: 'B4', d: 1 }, { n: 'G4', d: 1 }, { n: 'E4', d: 1 },
    { n: 'G4', d: 1 }, { n: 'B4', d: 1 }, { n: 'D5', d: 2 },
    { n: 'C5', d: 1 }, { n: 'B4', d: 1 }, { n: 'A4', d: 1 }, { n: 'G4', d: 1 },
    { n: 'A4', d: 1 }, { n: 'B4', d: 1 }, { n: 'E5', d: 2 },
  ],
  bass: [
    { n: 'E3', d: 4 }, { n: 'B3', d: 4 }, { n: 'A3', d: 4 }, { n: 'E3', d: 4 },
    { n: 'C3', d: 4 }, { n: 'G3', d: 4 }, { n: 'D3', d: 4 }, { n: 'E3', d: 4 },
  ],
  drums: 'K---S---K-K-S---K---S-K-K---S---',
  vol: 0.85,
  leadType: 'square',
}

// BOSS: heavy, slower, ominous. D minor.
const BOSS: Track = {
  bpm: 110,
  loopSixteenths: 32,
  lead: [
    { n: 'D4', d: 2 }, { n: 'F4', d: 2 }, { n: 'A4', d: 2 }, { n: 'D5', d: 2 },
    { n: 'A4', d: 2 }, { n: 'F4', d: 2 }, { n: 'D4', d: 4 },
    { n: 'C4', d: 2 }, { n: 'E4', d: 2 }, { n: 'G4', d: 2 }, { n: 'C5', d: 2 },
    { n: 'G4', d: 2 }, { n: 'E4', d: 2 }, { n: 'C4', d: 4 },
  ],
  bass: [
    { n: 'D3', d: 8 }, { n: 'D3', d: 8 },
    { n: 'C3', d: 8 }, { n: 'C3', d: 8 },
  ],
  drums: 'K-------S-------K-K-----S---K---',
  vol: 0.95,
  leadType: 'sawtooth',
}

// VICTORY: short ascending fanfare — 4 bars then auto-stops
const VICTORY: Track = {
  bpm: 120,
  loopSixteenths: 16,
  lead: [
    { n: 'C5', d: 2 }, { n: 'E5', d: 2 }, { n: 'G5', d: 2 }, { n: 'C6', d: 4 },
    { n: 'G5', d: 2 }, { n: 'C6', d: 4 },
  ],
  bass: [{ n: 'C4', d: 8 }, { n: 'G3', d: 4 }, { n: 'C4', d: 4 }],
  drums: 'K-H-S-K-K-S-K-K-',
  vol: 0.9,
  leadType: 'square',
}

// DEFEAT: descending stinger
const DEFEAT: Track = {
  bpm: 80,
  loopSixteenths: 16,
  lead: [
    { n: 'A4', d: 4 }, { n: 'G4', d: 4 }, { n: 'F4', d: 4 }, { n: 'D4', d: 4 },
  ],
  bass: [{ n: 'A3', d: 4 }, { n: 'G3', d: 4 }, { n: 'F3', d: 4 }, { n: 'D3', d: 4 }],
  drums: '----S-------S---',
  vol: 0.85,
  leadType: 'sawtooth',
}

const TRACKS: Record<TrackId, Track> = {
  menu: MENU,
  fight: FIGHT_A,
  'fight-b': FIGHT_B,
  boss: BOSS,
  victory: VICTORY,
  defeat: DEFEAT,
}

// ─── Scheduler ────────────────────────────────────────────────────────

function scheduleNote(
  startAt: number,
  freq: number,
  duration: number,
  type: OscillatorType,
  vol: number,
) {
  // Defensive: a typo in a track table can pass undefined frequency or duration
  // here. WebAudio throws "non-finite value" which becomes a React error and
  // crashes the entire app. Skip the note instead.
  if (!Number.isFinite(freq) || !Number.isFinite(duration) || !Number.isFinite(startAt) || duration <= 0) {
    return
  }
  const c = getCtx()
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, startAt)
  g.gain.setValueAtTime(0, startAt)
  g.gain.linearRampToValueAtTime(vol, startAt + 0.005)
  g.gain.linearRampToValueAtTime(vol * 0.6, startAt + duration * 0.6)
  g.gain.linearRampToValueAtTime(0, startAt + duration)
  o.connect(g)
  if (masterGain) g.connect(masterGain)
  o.start(startAt)
  o.stop(startAt + duration)
}

function scheduleNoise(startAt: number, duration: number, vol: number) {
  const c = getCtx()
  const len = Math.max(1, Math.floor(c.sampleRate * duration))
  const buffer = c.createBuffer(1, len, c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  }
  const src = c.createBufferSource()
  src.buffer = buffer
  const g = c.createGain()
  g.gain.value = vol
  src.connect(g)
  if (masterGain) g.connect(masterGain)
  src.start(startAt)
}

function scheduleKick(startAt: number, vol = 0.4) {
  const c = getCtx()
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = 'sine'
  o.frequency.setValueAtTime(140, startAt)
  o.frequency.exponentialRampToValueAtTime(40, startAt + 0.12)
  g.gain.setValueAtTime(vol, startAt)
  g.gain.exponentialRampToValueAtTime(0.001, startAt + 0.12)
  o.connect(g)
  if (masterGain) g.connect(masterGain)
  o.start(startAt)
  o.stop(startAt + 0.14)
}

function scheduleSnare(startAt: number, vol = 0.25) {
  scheduleNoise(startAt, 0.08, vol)
  const c = getCtx()
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = 'square'
  o.frequency.setValueAtTime(200, startAt)
  g.gain.setValueAtTime(vol * 0.5, startAt)
  g.gain.exponentialRampToValueAtTime(0.001, startAt + 0.06)
  o.connect(g)
  if (masterGain) g.connect(masterGain)
  o.start(startAt)
  o.stop(startAt + 0.08)
}

function scheduleHat(startAt: number, vol = 0.12) {
  scheduleNoise(startAt, 0.04, vol)
}

function scheduleLoop(track: Track, loopStart: number, myStopFlag: number) {
  if (stopFlag !== myStopFlag || currentTrack === null) return
  const sixteenth = 60 / track.bpm / 4

  // LEAD
  let t = loopStart
  for (const note of track.lead) {
    if (note.n) {
      scheduleNote(t, NOTE[note.n], note.d * sixteenth * 0.95, track.leadType ?? 'square', 0.07 * track.vol)
    }
    t += note.d * sixteenth
  }

  // BASS
  t = loopStart
  for (const note of track.bass) {
    if (note.n) {
      scheduleNote(t, NOTE[note.n], note.d * sixteenth * 0.9, 'triangle', 0.12 * track.vol)
    }
    t += note.d * sixteenth
  }

  // DRUMS
  for (let i = 0; i < track.drums.length; i++) {
    const time = loopStart + i * sixteenth
    const ch = track.drums[i]
    if (ch === 'K') scheduleKick(time, 0.35 * track.vol)
    else if (ch === 'S') scheduleSnare(time, 0.22 * track.vol)
    else if (ch === 'H') scheduleHat(time, 0.10 * track.vol)
  }

  // Schedule next loop (victory and defeat are one-shot — don't reschedule)
  if (currentTrack === 'victory' || currentTrack === 'defeat') return
  const loopDuration = track.loopSixteenths * sixteenth
  const next = loopStart + loopDuration
  const delay = (next - getCtx().currentTime) * 1000 - 200  // schedule next loop 200ms early
  setTimeout(() => scheduleLoop(track, next, myStopFlag), Math.max(0, delay))
}

// ─── Public API ───────────────────────────────────────────────────────

export const Music = {
  play(track: TrackId) {
    if (currentTrack === track) return
    Music.stop()
    const c = getCtx()
    attachUnlockListener()

    // If the AudioContext is still suspended (no user gesture yet), queue
    // this track and abort scheduling — the unlock listener will replay
    // when the first click/key/touch arrives. Scheduling notes against a
    // suspended context wastes them: the clock advances past their start
    // times silently.
    if (c.state === 'suspended') {
      pendingTrack = track
      c.resume().catch(() => {})
      return
    }

    currentTrack = track
    stopFlag++
    const myStopFlag = stopFlag
    scheduleLoop(TRACKS[track], c.currentTime + 0.05, myStopFlag)
  },
  stop() {
    stopFlag++  // cancels in-flight setTimeout reschedules
    currentTrack = null
    // Note: already-scheduled WebAudio nodes will play out their remaining
    // envelope (≤1 loop). This avoids audible clicks from sudden silencing.
  },
  setVolume(v: number) {
    userVolume = Math.max(0, Math.min(1, v))
    if (masterGain) masterGain.gain.value = userVolume
  },
  getVolume() {
    return userVolume
  },
  isOn() {
    return currentTrack !== null
  },
  current() {
    return currentTrack
  },
  toggle() {
    if (currentTrack === null) Music.play('menu')
    else Music.stop()
  },
}
