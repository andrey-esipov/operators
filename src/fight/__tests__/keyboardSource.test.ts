/**
 * The input layer's one job is to never lose a press. These tests exercise the
 * timing that breaks a naive implementation: a tap that begins and ends between
 * two polls.
 *
 * `KeyboardSource` touches exactly three things on `window` — addEventListener,
 * removeEventListener, and the event's `code`/`repeat`. Stubbing that surface
 * is a few lines and keeps these tests in the default node environment, which
 * is cheaper than pulling in a DOM implementation for one file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

class FakeKeyboardEvent extends Event {
  code: string
  repeat: boolean
  constructor(type: string, init: { code: string; repeat?: boolean }) {
    super(type)
    this.code = init.code
    this.repeat = init.repeat ?? false
  }
}

const fakeWindow = new EventTarget()
;(globalThis as unknown as { window: EventTarget }).window = fakeWindow

const { KeyboardSource, DEFAULT_KEYMAP } = await import('../input/sources')

function key(type: 'keydown' | 'keyup', code: string, repeat = false) {
  fakeWindow.dispatchEvent(new FakeKeyboardEvent(type, { code, repeat }))
}

describe('KeyboardSource', () => {
  let src: InstanceType<typeof KeyboardSource>

  beforeEach(() => {
    src = new KeyboardSource(DEFAULT_KEYMAP)
  })
  afterEach(() => {
    src.dispose()
  })

  it('registers a button held across polls', () => {
    src.poll()
    key('keydown', 'KeyU')
    const f = src.poll()
    expect(f.held.has('lp')).toBe(true)
    expect(f.pressed.has('lp')).toBe(true)
  })

  it('does not repeat the press while the button stays held', () => {
    key('keydown', 'KeyU')
    src.poll()
    const second = src.poll()
    expect(second.held.has('lp')).toBe(true)
    expect(second.pressed.has('lp')).toBe(false)
  })

  it('registers a tap that starts and ends between two polls', () => {
    // The case a poll-diff implementation drops: by the time poll() runs the
    // key is already back up, so it was never observed as held.
    src.poll()
    key('keydown', 'KeyU')
    key('keyup', 'KeyU')
    const f = src.poll()
    expect(f.pressed.has('lp')).toBe(true)
    expect(f.held.has('lp')).toBe(true)
  })

  it('releases a sub-frame tap on the very next poll', () => {
    src.poll()
    key('keydown', 'KeyU')
    key('keyup', 'KeyU')
    src.poll()
    const after = src.poll()
    expect(after.held.has('lp')).toBe(false)
    expect(after.pressed.has('lp')).toBe(false)
  })

  it('ignores OS auto-repeat so a held button does not re-trigger', () => {
    key('keydown', 'KeyU')
    src.poll()
    key('keydown', 'KeyU', true)
    key('keydown', 'KeyU', true)
    const f = src.poll()
    expect(f.pressed.has('lp')).toBe(false)
  })

  it('keeps distinct buttons independent', () => {
    src.poll()
    key('keydown', 'KeyU')
    key('keyup', 'KeyU')
    key('keydown', 'KeyJ')
    const f = src.poll()
    expect(f.pressed.has('lp')).toBe(true)
    expect(f.pressed.has('lk')).toBe(true)
    expect(f.pressed.has('mp')).toBe(false)
  })

  it('composes directions from the cardinal holds', () => {
    key('keydown', 'KeyD')
    expect(src.poll().dir).toBe(6)
    key('keydown', 'KeyW')
    expect(src.poll().dir).toBe(9)
    key('keyup', 'KeyD')
    key('keyup', 'KeyW')
    expect(src.poll().dir).toBe(5)
  })
})
