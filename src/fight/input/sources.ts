/**
 * Turning real hardware into the sim's InputFrame. Two sources — keyboard and
 * Gamepad API — implement the same tiny interface so the game loop can poll
 * whichever is plugged in without caring which. The sim itself never touches
 * these; they run in the browser, the sim runs anywhere.
 *
 * Everything is guarded so importing this module in a headless test is inert:
 * nothing is read from `window`/`navigator` until you actually construct a
 * source.
 */

import type { Button, Direction, InputFrame } from '../types'

export interface InputSource {
  /** Sample the current physical state and produce one frame of input. */
  poll(): InputFrame
  dispose?(): void
}

/** Compose a numpad direction from the four cardinal holds. */
export function toNumpad(left: boolean, right: boolean, up: boolean, down: boolean): Direction {
  const h = (right ? 1 : 0) - (left ? 1 : 0)
  const v = (up ? 1 : 0) - (down ? 1 : 0)
  if (v > 0) return (h < 0 ? 7 : h > 0 ? 9 : 8) as Direction
  if (v < 0) return (h < 0 ? 1 : h > 0 ? 3 : 2) as Direction
  return (h < 0 ? 4 : h > 0 ? 6 : 5) as Direction
}

/** Diff two held-sets into the buttons that went down this frame. */
function pressedFrom(prev: ReadonlySet<Button>, now: ReadonlySet<Button>): Set<Button> {
  const p = new Set<Button>()
  for (const b of now) if (!prev.has(b)) p.add(b)
  return p
}

export interface KeyMap {
  left: string[]
  right: string[]
  up: string[]
  down: string[]
  buttons: Record<Button, string[]>
}

/** WASD to move, U/I/O + J/K/L for the six attacks — a comfortable default that
 *  also accepts the arrow keys for direction. */
export const DEFAULT_KEYMAP: KeyMap = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  buttons: {
    lp: ['KeyU'], mp: ['KeyI'], hp: ['KeyO'],
    lk: ['KeyJ'], mk: ['KeyK'], hk: ['KeyL'],
  },
}

export class KeyboardSource implements InputSource {
  private held = new Set<string>()
  private prevButtons = new Set<Button>()
  private readonly map: KeyMap
  private readonly onDown: (e: KeyboardEvent) => void
  private readonly onUp: (e: KeyboardEvent) => void

  constructor(map: KeyMap = DEFAULT_KEYMAP) {
    this.map = map
    this.onDown = (e) => this.held.add(e.code)
    this.onUp = (e) => this.held.delete(e.code)
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onDown)
      window.addEventListener('keyup', this.onUp)
    }
  }

  private any(codes: string[]): boolean {
    return codes.some((c) => this.held.has(c))
  }

  poll(): InputFrame {
    const dir = toNumpad(
      this.any(this.map.left), this.any(this.map.right),
      this.any(this.map.up), this.any(this.map.down),
    )
    const now = new Set<Button>()
    for (const b of Object.keys(this.map.buttons) as Button[]) {
      if (this.any(this.map.buttons[b])) now.add(b)
    }
    const pressed = pressedFrom(this.prevButtons, now)
    this.prevButtons = now
    return { dir, held: now, pressed }
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onDown)
      window.removeEventListener('keyup', this.onUp)
    }
  }
}

/** Which physical gamepad button drives which attack. Defaults follow the
 *  common fightpad layout: the face buttons and right shoulders. */
export const DEFAULT_PAD_BUTTONS: Record<Button, number> = {
  lp: 2, // X
  mp: 3, // Y
  hp: 5, // RB
  lk: 0, // A
  mk: 1, // B
  hk: 7, // RT
}

export class GamepadSource implements InputSource {
  private prevButtons = new Set<Button>()
  private readonly index: number
  private readonly deadzone: number
  private readonly map: Record<Button, number>

  constructor(index = 0, map: Record<Button, number> = DEFAULT_PAD_BUTTONS, deadzone = 0.5) {
    this.index = index
    this.map = map
    this.deadzone = deadzone
  }

  private pad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null
    return navigator.getGamepads()[this.index] ?? null
  }

  poll(): InputFrame {
    const pad = this.pad()
    if (!pad) {
      this.prevButtons = new Set()
      return { dir: 5, held: new Set(), pressed: new Set() }
    }
    const ax = pad.axes[0] ?? 0
    const ay = pad.axes[1] ?? 0
    const b = pad.buttons
    const left = ax < -this.deadzone || b[14]?.pressed
    const right = ax > this.deadzone || b[15]?.pressed
    const up = ay < -this.deadzone || b[12]?.pressed
    const down = ay > this.deadzone || b[13]?.pressed
    const dir = toNumpad(!!left, !!right, !!up, !!down)

    const now = new Set<Button>()
    for (const btn of Object.keys(this.map) as Button[]) {
      if (b[this.map[btn]]?.pressed) now.add(btn)
    }
    const pressed = pressedFrom(this.prevButtons, now)
    this.prevButtons = now
    return { dir, held: now, pressed }
  }
}

/** A neutral frame — no direction, no buttons. Useful as a default/idle input. */
export function neutralInput(): InputFrame {
  return { dir: 5, held: new Set(), pressed: new Set() }
}
