/**
 * FOOT SKATE — does the drawn stride match the distance the sim actually moves?
 *
 * WHAT SKATE IS. A walk cycle is a contract between the art and the physics. If
 * the contact drawing puts the feet 114 cm apart but the simulation only carries
 * the body 38 cm before the next contact, the planted foot has to slide 76 cm
 * backward across the floor to reconcile them. The character appears to moonwalk
 * — feet cycling far faster than the ground they cover. It is the most legible
 * animation defect there is, because the floor gives the eye an absolute
 * reference that nothing else in the frame does.
 *
 * WHY THIS GATE EXISTS. Every locomotion gate in this repo counted cels. Cel
 * count cannot see skate at all: a four-cel walk and a twelve-cel walk skate
 * identically if the stride is wrong, and fixing the stride changes no count.
 * The defect was found by a blind critic, who described the swing foot as
 * jumping a near-full stride between planted contacts, and only then measured.
 * Every one of the six selectable fighters was skating 3.0x to 3.8x forward, in
 * the clip that is on screen more than every other clip combined.
 *
 * WHY IT IS A RATCHET AND NOT A PASS MARK. 1.0x is the physically correct
 * answer and nothing on the roster is close to it, so a gate set at 1.0 would
 * be red on arrival and instantly ignored. The bound below is set just above
 * today's worst reading. It exists to stop the number climbing while the art is
 * re-commissioned, and it is lowered — never raised — as fighters are redrawn.
 * A raise would be admitting a regression, which is the whole thing it is here
 * to prevent.
 *
 * THE POSITIVE CONTROL IS THE IMPORTANT PART. doshi's walk-BACK measures 1.06x
 * — very nearly perfect — from the same model, the same fighter and the same
 * run as its 2.97x walk-forward. That single number is what makes this gate
 * meaningful rather than a complaint about an unreachable ideal: it proves the
 * pipeline can draw a correct stride, so the 3x readings are a prompt defect
 * and not a limit. If that control ever drifts upward, the gate has lost its
 * evidence that the target is achievable and the bound below is unjustified.
 *
 * HOW STRIDE IS MEASURED. Take the two contact poses (`-1` and `-3`), find the
 * lowest opaque row, and take the horizontal extent of opaque pixels within the
 * bottom 6% of the sprite. That band is the feet and nothing else. Convert to
 * centimetres with the same scale the renderer uses — Fighter.ts sets
 * pxToWorld from `heightCm / <idle frame height>`, so the conversion here is
 * idle-referenced too, or the two would disagree about how big a centimetre is.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { WALK_BACK_SPEED, WALK_FWD_SPEED } from '../../../fight/constants'
import { ROSTER } from '../../../fighthud/select/roster'

const PUBLIC = join(process.cwd(), 'public')

/** Alpha above which a pixel counts as body. Matches the ghost scorer's floor. */
const OPAQUE = 40

/** Fraction of sprite height treated as "the feet" at the bottom of the cel. */
const FOOT_BAND = 0.06

/**
 * Ratchet. Today's worst reading is madhavan walk-fwd at 3.84x. Set just above
 * it so a regression trips while the re-draw is outstanding. LOWER THIS as art
 * lands; never raise it.
 */
const SKATE_CEILING = 3.9

/**
 * The positive control: doshi walk-back is the one measurement on the roster
 * near the physically correct 1.0x, and it is the evidence that the ceiling
 * above describes a fixable defect rather than an unreachable ideal.
 */
const CONTROL = { id: 'doshi', clip: 'walk-back' as const, max: 1.25 }

const SPEED: Record<string, number> = {
  'walk-fwd': WALK_FWD_SPEED,
  'walk-back': WALK_BACK_SPEED,
}

type Manifest = {
  atlas: string
  heightCm: number
  frames: { name: string; rect: { x: number; y: number; w: number; h: number } }[]
  clips: Record<string, { frames: number[]; durations: number[] }>
}

const cache = new Map<string, { m: Manifest; raw: Buffer; w: number }>()

async function load(id: string) {
  const hit = cache.get(id)
  if (hit) return hit
  const m: Manifest = JSON.parse(readFileSync(join(PUBLIC, 'fighters', id, 'assets.json'), 'utf8'))
  // manifest.atlas is a public-root-relative URL, not a path next to the manifest.
  const img = sharp(join(PUBLIC, m.atlas.replace(/^\//, '')))
  const meta = await img.metadata()
  const raw = await img.ensureAlpha().raw().toBuffer()
  const entry = { m, raw, w: meta.width as number }
  cache.set(id, entry)
  return entry
}

/** Horizontal extent of the foot band, in pixels; null when the frame is absent. */
function footSpanPx(raw: Buffer, atlasW: number, rect: { x: number; y: number; w: number; h: number }) {
  const at = (x: number, y: number) => raw[((rect.y + y) * atlasW + (rect.x + x)) * 4 + 3]
  let lowest = -1
  for (let y = rect.h - 1; y >= 0 && lowest < 0; y--) {
    for (let x = 0; x < rect.w; x++) if (at(x, y) > OPAQUE) { lowest = y; break }
  }
  if (lowest < 0) return null
  const band = Math.max(1, Math.round(rect.h * FOOT_BAND))
  let min = Infinity
  let max = -1
  for (let y = Math.max(0, lowest - band); y <= lowest; y++) {
    for (let x = 0; x < rect.w; x++) {
      if (at(x, y) > OPAQUE) {
        if (x < min) min = x
        if (x > max) max = x
      }
    }
  }
  return max < 0 ? null : max - min
}

/** Skate ratio for one clip: widest drawn contact stride ÷ distance travelled per step. */
async function skateRatio(id: string, clip: 'walk-fwd' | 'walk-back') {
  const { m, raw, w } = await load(id)
  const c = m.clips[clip]
  if (!c) return null
  const idle = m.frames.find((f) => f.name === 'idle-1')
  if (!idle) return null
  const cmPerPx = m.heightCm / idle.rect.h
  // A cycle is two steps, so the body covers speed × (total / 2) per step.
  const perStep = c.durations.reduce((a, b) => a + b, 0) / 2
  const travelledCm = SPEED[clip] * perStep
  let strideCm = 0
  for (const name of [`${clip}-1`, `${clip}-3`]) {
    const f = m.frames.find((x) => x.name === name)
    if (!f) continue
    const px = footSpanPx(raw, w, f.rect)
    if (px != null) strideCm = Math.max(strideCm, px * cmPerPx)
  }
  if (strideCm === 0 || travelledCm === 0) return null
  return { strideCm, travelledCm, ratio: strideCm / travelledCm }
}

const SELECTABLE = ROSTER.map((r) => r.skin)

describe('foot skate — drawn stride vs simulated travel', () => {
  it('the positive control still holds: a near-correct stride is achievable', async () => {
    const r = await skateRatio(CONTROL.id, CONTROL.clip)
    expect(r, `${CONTROL.id}/${CONTROL.clip} could not be measured — the control is the gate's only evidence that the ceiling is fixable`).not.toBeNull()
    expect(
      r!.ratio,
      `${CONTROL.id}/${CONTROL.clip} skate is ${r!.ratio.toFixed(2)}x (${r!.strideCm.toFixed(0)}cm drawn vs ${r!.travelledCm.toFixed(0)}cm travelled).\n` +
        'This is the ONE measurement near the physically correct 1.0x, and it is what justifies holding the\n' +
        'rest of the roster to a ceiling at all. If it has drifted, do not relax the ceiling — find out what\n' +
        'changed, because the claim "the pipeline can draw a correct stride" now has no evidence behind it.',
    ).toBeLessThan(CONTROL.max)
  })

  it('no selectable fighter skates worse than the ratchet', async () => {
    const over: string[] = []
    let measured = 0
    for (const id of SELECTABLE) {
      for (const clip of ['walk-fwd', 'walk-back'] as const) {
        const r = await skateRatio(id, clip)
        if (!r) continue
        measured++
        if (r.ratio >= SKATE_CEILING) {
          over.push(`${id}/${clip}: ${r.ratio.toFixed(2)}x (${r.strideCm.toFixed(0)}cm drawn vs ${r.travelledCm.toFixed(0)}cm travelled)`)
        }
      }
    }
    expect(measured, 'no walk clips measured — the skate gate is vacuous').toBeGreaterThanOrEqual(SELECTABLE.length * 2)
    expect(
      over,
      `foot skate regressed past the ratchet (${SKATE_CEILING}x):\n${over.join('\n')}\n\n` +
        'The planted foot slides this many times further than the body travels. Either the drawing took a\n' +
        'longer stride than the sim supports, or a walk speed / clip duration changed underneath the art.\n' +
        'Do NOT fix this by raising the ceiling.',
    ).toEqual([])
  })

  it('records what the roster measures today, so a redraw is visible as progress', async () => {
    // Characterization, not a target. These are the numbers that justified
    // re-commissioning the walk art; when a fighter is redrawn its entry here
    // drops and SKATE_CEILING can follow it down.
    const TODAY: Record<string, [number, number]> = {
      chesky: [3.09, 2.03],
      doshi: [2.97, 1.06],
      turley: [3.63, 3.82],
      lenny: [3.44, 3.5],
      spiegel: [3.32, 3.76],
      madhavan: [3.84, 3.54],
    }
    const drift: string[] = []
    for (const [id, [fwd, back]] of Object.entries(TODAY)) {
      const f = await skateRatio(id, 'walk-fwd')
      const b = await skateRatio(id, 'walk-back')
      if (!f || !b) { drift.push(`${id}: could not measure`); continue }
      // Improvement is welcome and must not fail the gate; only upward drift is
      // a regression. 0.15 absorbs re-encode noise in the atlas.
      if (f.ratio > fwd + 0.15) drift.push(`${id}/walk-fwd: ${f.ratio.toFixed(2)}x, was ${fwd}x`)
      if (b.ratio > back + 0.15) drift.push(`${id}/walk-back: ${b.ratio.toFixed(2)}x, was ${back}x`)
    }
    expect(drift, `foot skate got WORSE than the recorded characterization:\n${drift.join('\n')}`).toEqual([])
  })
})
