import { describe, it, expect } from 'vitest'
import { HitFlashBox, FLASH_SECONDS } from '../Fighter'

/**
 * The hit flash is the effect that erased the juggle pose: a launcher's white
 * strobe, held for the whole multi-frame juggle/hitstun state, desaturated the
 * victim to a featureless white silhouette (channels within 2 of each other,
 * saturation ~0.01). The fix is that the flash is BOXED from the contact event
 * and hard-cuts after ~3 frames, so the rest of the beat shows the true albedo.
 *
 * These are the guards the failure mode cannot satisfy: a flash bound to a hurt
 * stance would still be lit dozens of frames after contact, so we assert it is
 * exactly zero well before a juggle ends — and that it does light on contact,
 * so a probe can't pass by simply never flashing at all.
 */
describe('HitFlashBox — the flash is boxed from contact, not the hurt stance', () => {
  const dt = 1 / 60 // one fixed frame at 60fps, matching the capture clock

  it('lights on the contact frame (a probe cannot pass by never flashing)', () => {
    const box = new HitFlashBox()
    box.arm(1)
    expect(box.step(dt)).toBeGreaterThan(0)
  })

  it('hard-cuts to exactly zero once the box expires', () => {
    const box = new HitFlashBox()
    box.arm(1)
    // Step past FLASH_SECONDS. The value must be exactly 0 — a hard cut, not a
    // lingering fade.
    let v = 1
    const frames = Math.ceil(FLASH_SECONDS / dt) + 1
    for (let i = 0; i < frames; i++) v = box.step(dt)
    expect(v).toBe(0)
  })

  it('is DARK for the rest of a juggle — the white-silhouette regression guard', () => {
    const box = new HitFlashBox()
    box.arm(1) // a launcher, full strength
    // A juggle runs ~40+ frames. The flash must be long gone by, say, frame 8 —
    // the exact window a capture tool settles into. Anything keyed off the hurt
    // stance would still read full intensity here.
    let v = 0
    for (let i = 0; i < 8; i++) v = box.step(dt)
    expect(v).toBe(0)
  })

  it('never exceeds the readable-silhouette cap even at full strength', () => {
    const box = new HitFlashBox()
    box.arm(1)
    expect(box.step(dt)).toBeLessThanOrEqual(0.45)
  })

  it('scales the lit value with hit weight', () => {
    const light = new HitFlashBox()
    light.arm(0.2)
    const heavy = new HitFlashBox()
    heavy.arm(0.9)
    expect(light.step(dt)).toBeLessThan(heavy.step(dt))
  })

  it('re-arms on a follow-up hit (a fresh flashbulb per combo connect)', () => {
    const box = new HitFlashBox()
    box.arm(1)
    // Let it fully expire.
    for (let i = 0; i < 8; i++) box.step(dt)
    expect(box.step(dt)).toBe(0)
    // A second hit lands — it must light again, not stay dead.
    box.arm(1)
    expect(box.step(dt)).toBeGreaterThan(0)
  })

  it('holds a constant value while lit rather than fading frame-to-frame', () => {
    const box = new HitFlashBox()
    box.arm(0.8)
    const a = box.step(dt)
    const b = box.step(dt)
    // Constant hold (fighting-game cut), not a per-frame decay.
    expect(a).toBe(b)
  })
})
