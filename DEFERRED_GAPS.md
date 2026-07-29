# Deferred-Gap Register & Vacuity Sweep

**Scope:** all 101 tracked test files (seeded from `git ls-files -- src`, never a disk
walk). **Method:** three read-only sweep passes (fight/fighthud, three/fight+vfx,
screens/play/core) with verbatim-quote gathering, then source re-verification of every
flag; all cel/tween counts below were re-derived directly from the per-fighter
`public/fighters/<skin>/assets.json` (+ `.hero.json`) manifests, not relayed.

Two artifacts:

1. **Deferred-gap register** — places where a test *documents a known-wrong or
   incomplete current state it deliberately does not fail on*. These are the
   highest-value defects in the project: simultaneously **known to the codebase** and
   **invisible to the green suite**, and several are things a buyer sees.
2. **Vacuity sweep** — assertions that cannot fail in the current state. Result is a
   valuable **negative**: zero cannot-fail assertions found across 909 tests.

A finding is **defended** when a synthetic violator, a positive control, an iteration/
population counter, or a sibling assertion on the same value proves the check can fail.
`contactCel.test.ts`, `heroClipFidelity.node.test.ts`, and `atlasCostBake.node.test.ts`
are **defended reference examples**, not findings.

---

## 1. Deferred-gap register

### GAP-1 — Static locomotion: turley + madhavan (cross-archetype)
- **Where:** `src/three/fight/__tests__/locomotionCoverage.test.ts` — the `LOCOMOTION`
  array + the `frames.length >= 1` floor (the block header explicitly states the bar is
  *"never idle"* and defers multi-cel richness to "Stage 2, real-art").
- **Deferred:** the gate asserts a stance resolves to its own clip and isn't the idle
  breathing loop; it does **not** require >1 cel. A single-cel held pose passes.
- **On screen today:** turley and madhavan play static held poses for
  crouch/block/dash/backdash/jump while the four complete skins animate (e.g.
  `turley.crouch = [11]` one cel vs `lenny.crouch = [12,76,13,76]`).
- **Covered by a commission?** Yes — the Stage-2 locomotion art (turley +11, madhavan
  +12 across crouch/block/dash/backdash/jump-rise/jump-fall).
- **Gate status:** pinned & defended (roster vacuity guard asserts `FIGHTABLE.size >= 6`).
  This is the **richness** axis the coverage gate defers by design, not a gate bug.

### GAP-2 — madhavan is a half-density skin: 15 missing tween cels 🔴 (largest, mostly UNCOMMISSIONED at time of writing)
Manifest-verified tween inventory (`tw-*` cels, identical in full and hero variants):

| skin | tw-* cels | idle | walk-fwd | walk-back |
|------|-----------|------|----------|-----------|
| lenny / chesky / spiegel | 26 | 10 | 8 | 8 |
| doshi | 23 | 10 | 8 | 8 |
| turley | 18 | 6 | 8 | 8 |
| **madhavan** | **3** | **4** | **4** | **4** |

- **Universal across the five complete skins: 18 tweens. Missing from madhavan: 15.**
  - walk-fwd (4): `tw-wf-12`, `tw-wf-23`, `tw-wf-34`, `tw-wf-41`
  - walk-back (4): `tw-wb-12`, `tw-wb-23`, `tw-wb-34`, `tw-wb-41`
  - idle (3): `tw-i1-i2`, `tw-i3-i1a`, `tw-i3-i1b`
  - punches (4): `tw-lp-rec`, `tw-mp-rec`, `tw-hp-wind`, `tw-hp-rec`
- **On screen today:**
  - madhavan **walks and idles at half the frame density of every fighter on the
    roster** — including turley, which is 8/8 on both walks. Walking and idling are on
    screen continuously in every bout, including the attract reel before any input.
  - madhavan idle is `idle-1 idle-2 idle-3 idle-2` — it never reaches `idle-4` and
    bounces back through `idle-2`.
  - madhavan's medium/heavy **punches snap to the neutral breathing pose** on wind-up
    and recovery (`st.HP = [hp-startup, idle-1, hp-active, idle-1]` vs
    `lenny = [hp-startup, tw-hp-wind, hp-active, tw-hp-rec]`) — the same *"resets to
    neutral"* symptom as the original locomotion P0, via a different mechanism.
- **Where the suite knows but stays green:**
  - `animationCadence.test.ts` header (the paragraph beginning *"madhavan is a partial
    skin missing its hp tween cels…"*) documents the idle-1 substitution; its cadence
    policy (median-hold + on-ones fraction) passes because idle-1 is a **held** key.
  - **walk-fwd, walk-back and idle are outside `locomotionCoverage`'s `LOCOMOTION`
    population entirely** — so the *biggest* instance of the defect that gate exists to
    catch sits outside the set it enumerates. A richness gate that seeds from those six
    clips goes green while madhavan walks and idles at half rate.
- **Whole-set caveat (prevents a mislabel):** `idle-1` as a **held startup/recovery
  anchor** appears in *all six* skins' kick clips (`st.LK/MK/HK` are byte-identical
  across the roster) — that is deliberate roster-wide **style**, not a defect. The
  defect is narrowly the 15 `tw-*` cels madhavan alone lacks; **punches diverge, kicks
  do not.**
- **Covered by a commission?** **Not originally.** The initial 35-cel scope (locomotion
  + super-grab) did not include these. The revised commission adds madhavan
  walk (+4), walk-back (+4), idle (+3), punch (+4) = **+15**, raising the roster total to
  ≈50 cels. By dwell-time exposure the **walk/idle tweens outrank even the super-grab
  cels** (a super fires a few times per match; walking and idling are continuous).

### GAP-3 — Recycled vanguard super: spiegel + madhavan (grappler archetype)
- **Where:** `src/three/fight/__tests__/contactCel.test.ts` — the `ENERGY_SUPER_SKINS`
  exact-set pin (`[chesky, doshi, lenny, turley]`) with the comment block naming spiegel
  and madhavan as deliberately absent until a bespoke grab-super shape exists.
- **Deferred:** both vanguards' super rolls over to the recycled cel trio
  `['special-fireball-charge', 'special-uppercut', 'special-fireball-release']`. The
  routing (`deriveAttackClip`) flips to the bespoke grab arc automatically once the
  `super-grab-*` cels exist — zero further code.
- **On screen today (source-corrected — read the render path, not the cel names):**
  **No projectile renders, and none can.** `vanguard.ts` declares no `projectiles` field,
  and `combat.ts` (`const specs = defs[ai].projectiles; if (!specs) continue`) skips the
  spawn loop for it. The vanguard super is `Backbreaker` (`tag:'super'`, `guard:'throw'`,
  360 damage) — a **command grab**. What renders is **body poses**: a fireball-windup
  and an uppercut motion (cels authored for the operator's projectile move, recycled)
  while lunging into an unblockable grab. **Sharpest incoherence: a vertical uppercut
  pose during a horizontal grab.** The claim *"a grappler throws a fireball"* is false —
  the accurate defect is **wrong body language on the most-watched move.**
- **Covered by a commission?** Yes — 12 `super-grab-*` cels (spiegel +6, madhavan +6).
- **Instrument note:** the `RECYCLED` array at `contactCel.test.ts:~305` holds **real
  frame IDs** (`special-fireball-*`), i.e. asset provenance — it must **not** be reworded
  when the misleading "fireball" prose in surrounding comments is softened, or the cel
  lookup breaks.

### Deliberate non-assertions (labeled, NOT buyer-visible gaps)
- `whiffPunishCensus.node.test.ts` (*"deliberately NOT asserted > 0"* / *"DELIBERATELY
  assert no super threshold"*) and `spacingCharFrac.node.test.ts` decline to render a
  verdict on <20-sample super data. This is **instrument humility** (refusing a verdict
  it cannot support) — the opposite of a lying harness. Not a finding.

---

## 2. Vacuity sweep — the negative result

Across all 101 tracked test files:

- **71 empty-array/object assert sites across 19 files — all DEFENDED** by a synthetic
  violator, a positive control, an iteration/population counter, or a paired
  precondition. Representative: `instrumentRouting` synthetic mutant; `captureCoverage`
  `.not.toEqual([])` bad-input control; `qualityAdaptor` tier-preservation on no-op
  frames; `shellNav`/`audioShell`/`fontDeliveryBudget` positive controls proving the
  detector fires.
- **0** `it.skip` / `describe.skip` / `test.skip` / `.todo` / `it.only` / `xit` /
  `xdescribe` anywhere in the tracked suite.
- **13 files with `toBeGreaterThan(0)` / `toBeGreaterThanOrEqual(1)` pop-only guards —
  all defended**, either as purposeful anti-vacuity liveness teeth
  (`determinism.test.ts` asserts a byte-identical replay *and* `hits > 5 / dmg > 0 /
  meter > 0` to prove it replayed a real fight) or as can-fail precondition gates whose
  correctness is pinned by sibling bounds on the same value (`knockback.coherence`
  connect-check ↔ monotonic + shove-floor + poke-ceiling; `superreachability` per-match
  `>= 1` ↔ aggregate band).
- **1 labeled false positive:** `attractDirector.node.test.ts:290` `expect(missing)
  .toEqual([])` is **defended**, not vacuous — guarded by three explicit vacuity checks
  (`seq.length === BOUTS`, distinct-skin per pairing, and `reelsChecked` /
  `windowsChecked` counters asserted to exact expected totals).

**Conclusion: zero cannot-fail assertions found across 909 tests.** Every finding this
project reports rests on instruments that bite.

*No consolidating meta-register gate was built:* each register entry is already
individually pinned by its own gate's comment; a second gate over the same property
would drift, then require litigating which one lies.

---

_Provenance: derived at branch tip `6342478`; `tsc -b --force` 0, 909 passed / 101 files,
zero deletions, tracked-test-file census 101 == 101. Numbers re-derived from manifests._
