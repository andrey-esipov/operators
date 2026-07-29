import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROSTER } from '../../../fighthud/select/roster'

/**
 * MANIFEST/SPEC DRIFT GATE — the detector for this project's stale-manifest
 * landmine.
 *
 * THE DEFECT THIS EXISTS TO PREVENT. Every fighter's `assets.json` is a BAKED
 * ARTIFACT of whatever `scripts/lib/frame-spec.ts` looked like on the day that
 * skin was last generated. Nothing re-derives it afterwards. So the spec and the
 * shipped manifests drift silently, and the drift is invisible until someone
 * regenerates a skin — at which point they get a surprise diff that has nothing
 * to do with their change.
 *
 * It is not hypothetical. The Tier C crouch/air kick families (`crlk`/`crmk`/
 * `crhk`/`jmk`) were added with a bespoke contact cel and NO fallback shape, on
 * the reasoning that a skin lacking the cel would "bail to the static standing
 * clip". But the static kick clips are hand-tuned `['lk-active',4],['idle-1',5]`
 * — fixed durations that put IDLE-1 on the contact frames. Only chesky ever got
 * the Tier C cels, so the other ten skins were one regeneration away from
 * re-acquiring the exact "kick ladder freezes on the standing idle pose" defect
 * that `contactCel.test.ts` was written to kill, on cr.LK/cr.MK/cr.HK/j.MK —
 * ~30% of all connecting attacks by the traffic census.
 *
 * WHY THE EXISTING GATE CANNOT SEE IT. `contactCel.test.ts` reads the SHIPPED
 * manifests, which is the right question for "what does a buyer see today" — and
 * those manifests predate the crouch family, so they still hold the good derived
 * layout. The suite was green while the generator was primed to regress. The
 * manifest's staleness was hiding the defect: a gate that reads only the baked
 * artifact is blind to a spec that would bake a worse one.
 *
 * WHAT THIS ASSERTS. `rebuild-manifest-clips --check` re-derives every playable
 * skin's derived-attack clips from the CURRENT spec and exits 1 if any differs
 * from what is committed. Green here means "regenerating any fighter today would
 * not silently change its attack clips" — so the spec and the artifacts agree,
 * and the surprise diff cannot happen.
 *
 * It runs the tool through its own documented invocation rather than
 * re-implementing the derivation, because a forked copy of the resolution logic
 * is exactly the drift this file exists to detect, one level up.
 *
 * NOT A SUBSTITUTE FOR `contactCel.test.ts`, and deliberately so. This gate
 * asserts spec == artifact; that one asserts the artifact is CORRECT. Both can
 * be satisfied at once by a spec and a manifest that agree on something wrong,
 * which is why the pair is kept rather than collapsed.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../../..')
const TOOL = 'scripts/rebuild-manifest-clips.ts'

const PLAYABLE = [...new Set(ROSTER.map((r) => r.skin))]

describe('committed manifests are not stale artifacts of an older frame-spec', () => {
  const res = spawnSync(process.execPath, ['--import', 'tsx', TOOL, '--check'], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 110_000,
  })
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`

  it('spawns the checker at all (instrument liveness)', () => {
    expect(res.error, `failed to spawn ${TOOL}: ${res.error?.message}`).toBeUndefined()
    expect(res.signal, `${TOOL} was killed by signal ${res.signal} (timeout?)`).toBeNull()
  })

  // Vacuity guard, and the one that matters most here. `--check` exits 0 when it
  // finds nothing to check, so a roster it failed to load, a moved public/
  // directory, or a silently-empty skin list would all produce a confident green.
  // Requiring every playable skin to be NAMED in the output makes "it ran" and
  // "it looked at the fighters" two separate, separately-provable claims.
  it(`names every playable skin in its report (${PLAYABLE.length} skins)`, () => {
    expect(PLAYABLE.length).toBeGreaterThan(0)
    const unnamed = PLAYABLE.filter((s) => !out.includes(s))
    expect(unnamed, `skins absent from --check output:\n${out.slice(-1500)}`).toEqual([])
  })

  it('reports zero drift between the frame-spec and every committed manifest', () => {
    const detail =
      `exit=${res.status}\n` +
      `Run \`npx tsx ${TOOL}\` to re-derive, then review the diff and commit it\n` +
      `together with the frame-spec change that caused it.\n` +
      `--- checker output (tail) ---\n${out.slice(-2500)}`
    expect(res.status, detail).toBe(0)
  })
})
