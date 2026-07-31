import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Reachability half of the finding-#4 gate (quarantined here because it reads
 * source files — the repo's `*.node.test.ts` convention). meterPower.test.ts
 * proves the model is CORRECT; this proves it is CONSUMED. Presence is not
 * reachability: a correct affordability model that no component reads would
 * still leave the power readout withheld, so this scans the shipped gauge and
 * its CSS directly, and pins that EX stays forward-declared (never surfaced as
 * spendable while no EX move exists in the engine).
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const HUD = resolve(HERE, '..')
const gauge = readFileSync(resolve(HUD, 'SuperGauge.tsx'), 'utf8')
const css = readFileSync(resolve(HUD, 'hud.css'), 'utf8')

describe('meterModel reachability — reaches the shipped gauge, EX stays unwired', () => {
  it('proves it is reading real source (non-vacuity)', () => {
    expect(gauge.length).toBeGreaterThan(200)
    expect(css.length).toBeGreaterThan(200)
  })

  it('SuperGauge imports and calls powerTier (model is consumed, not just authored)', () => {
    expect(gauge).toContain("from './meterModel'")
    expect(gauge).toMatch(/powerTier\(/)
    // It toggles the graded classes the CSS styles.
    expect(gauge).toContain("'maxed'")
    expect(gauge).toContain('fhud-superlabel-max')
  })

  it('the classes the gauge toggles are actually styled (no dead CSS class)', () => {
    expect(css).toContain('.fhud-superrow.maxed')
    expect(css).toContain('.fhud-superlabel-max')
  })

  it('EX is NOT surfaced in the gauge (forward-declared, not a consumed-lie)', () => {
    // The honesty invariant: EX exists as a spec in the model, but the shipped
    // component must not pretend it is spendable. If someone wires an EX pip
    // before an EX move exists in the engine, this reddens on purpose.
    expect(gauge).not.toContain('affordableEx')
    expect(gauge).not.toContain('EX_COST')
  })
})
