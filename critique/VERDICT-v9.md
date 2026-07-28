# VERDICT v9 — the audio + super watershed, re-judged on `beea557`

**CAPTURE SHA (stamped on every claim below): `beea55733ebd7b47595972c8d3eac4f80f3dc187` (`beea557`).**
Baseline for carry-forward: `c86b7869964b7ae735533604b566898ca3d1237c` (`c86b786`).
Main HEAD at write time: `a23adcf` — **+4 commits past my capture and still moving** (it passed through
`0c41cb3 → beea557 → 008cffd → 5e77e57 → a23adcf` during this session). Anything past `beea557` is **NOT
CAPTURED**; the roster-wide reaction commit `5e77e57 "give the whole roster a real reaction when hit"` in
particular lands **after** my frames and is deferred to v10.

All captures are against **static bundles in detached worktrees** (`_critic-c86b786`, `_critic-beea557`),
immune to HEAD moves. Every tool self-stamps `git rev-parse HEAD` of the *main* worktree — that stamp is
**wrong** (it printed `0c41cb3`/`008cffd` on frames that are really `c86b786`/`beea557`). Trust the bundle SHA,
not the tool stamp.

**Landing audit (run before crediting/demanding anything):**
- `git merge-base --is-ancestor 2735e9d beea557` → **TRUE** — audio seam is in the build.
- `git merge-base --is-ancestor 1475f8d beea557` → **TRUE** — super dead-back-half fix is in the build.
- `git show 1475f8d -- src/three/fight/FightRenderer.ts | grep -iE 'camera|kick|shake'` → **EMPTY** — the only
  FightRenderer change between `c86b786` and `beea557` contains **no camera code**, so the `c86b786` 0px-kick
  measurement carries forward to `beea557` unchanged. Stated as carry-forward, not re-measured.

---

## Method integrity — three things I caught this session and am NOT filing as product bugs

The harness degraded *after* my captures, and I am logging exactly what I refused to report, because filing any
of these would be a repeat of the "red confetti / empty stage" lies.

1. **Scrambled-port + intermittent WebGL `geometry` crash = harness contention, NOT a product bug.** Late in the
   session both `5411` and `5412` began throwing `Cannot read properties of undefined (reading 'geometry')` and
   "never reached a stable fight" — on the *same bundles* that had already produced dozens of clean frames.
   `lsof` vs `ps` showed the cause: a dozen `vite preview` processes all launched `--port 5410`, vite
   auto-incremented them onto 5411/5412, and a `dist-stageart --port 5411` was in the mix — the port→bundle map
   was **scrambled**, and the Metal/ANGLE context was thrashing under ~10 servers + repeated Chrome launches.
   The error was **intermittent** (fired on 2 probes, absent on a 3rd). A real scene-crash bug could not have
   produced my earlier clean `play-shots/beea`, `ionstorm`, and `select` captures on these exact bundles. → **Not
   routed.** All v9 frames predate the degradation and were integrity-verified at capture time (luma 57–82, real
   fighters in-crop, super-fired assertion, meter drop).
2. **`04-heavy` caught a no-contact spacing frame.** The beat labelled "heavy" shows Chesky mid knee-raise and
   Lenny in neutral guard, a full body-width apart, zero hitspark. Same class as the old "`08-super`
   photographed a normal attack" trap. → **Impact weight judged from the dedicated `impact-frames` capture, not
   from that still.**
3. **The `?select=1` → fight handoff timeout is the same "never reached a stable fight" harness symptom.** → I
   judged the select **screens** from their captured stills (which are real and clean) and did **not** file the
   handoff timeout as a combat-engine/fight-hud regression. Re-verify on a clean single-server harness in v10.

I did **not** re-run `blind-pairs.mjs` this session — I spent the budget verifying the two watershed landings
(audio, super). Blind A/B is deferred to v10 on a clean harness; a scrambled multi-server GPU state cannot host
a trustworthy blind run.

---

## SCORES (stills and motion scored separately, as always)

| Dimension | v8 | **v9** | Direction |
|---|---|---|---|
| Motion | 6.5 | **6.5** | held — one real gain, the #1 cap still unfixed |
| Gameplay stills (whole-frame) | 7.5 | **7.5** | held — nothing regressed, same two caps |
| Menu / select-suite stills | — (unscored) | **6.5** | new dimension, drags below gameplay |
| Audio | silent (uncredited) | **PASS — seam joined** | the total-silence era is over |

**None of this is AAA yet.** 7.5 stills / 6.5 motion is competent mid-tier. I am not grading on a curve.

### Motion — 6.5 / 10 (held)
- **CREDIT — the super's dead back half is genuinely fixed.** `1475f8d` in build. `warden-super` envelope on the
  freeze reads **back/front ratio 0.73**, continuous ~16–24 px/frame with no collapse; the filmstrip shows real
  blue energy building at the hands *through* the freeze, not a frozen hold. The dead-back-half I hammered in
  prior verdicts is gone. This is a real motion win.
- **CAP — impact still has zero screen feedback. Camera kick on contact = 0 px** (`impact.json maxMag: 0`, 16
  stepped frames, frames-differ verified so it's a real locked camera, not a frozen capture). This was v8's #1
  motion item and it is **still unfixed**. A fighting game whose hits don't move the camera reads soft no matter
  how good the recoil pose is.
- **NOT CAPTURED:** roster-wide reactions (`5e77e57`) land past `beea557`. Deferred — do not credit or judge until
  captured in v10.

### Gameplay stills — 7.5 / 10 (held)
- **Strong: HUD craft.** Real painted face portraits in the corners, clean dual health bars, boxed timer,
  win-pips, dual SUPER meters. Readable, composed, no amateur tells. This is the most AAA-adjacent layer in the
  game.
- **Strong: stage depth.** "The Garage" has real atmosphere — god-ray shafts, string-light bokeh, layered
  concrete blocks, warm key light, believable floor reflection. Not an empty box.
- **Cap 1: the wall decals read as pasted stickers.** The blue "growth-chart" hockey-stick line and the pixel
  window-panels sit flat on the wall — they don't take the stage's warm directional light or any parallax, so
  they read as 2D UI glued onto a 3D set. Thematically clever (startup growth chart); materially unintegrated.
- **Cap 2: sprites are a soft ~2–3× bilinear upscale, not crisp pixel art.** Measured, not eyeballed:
  `sprite-craft` finds smooth autocorrelation decay (0.99→0.73, **no** periodic pixel-grid dip) and a mean
  constant-colour run of ~2–3 px → soft bilinear enlargement. My eye's earlier "chunky/blocky" and "orange
  fringe halo" hypotheses were both **falsified** (the warm edge is 60–110 px background god-ray warmth + real
  directional rim-light, not a 1–4 px fringe). The defect is *softness*, not blocking.

### Menu / select-suite stills — 6.5 / 10 (new)
Captured `?select=1` character-select, the VS screen, and stage-select at `beea557`.
- **Strong:** real full-body roster art (Chesky, Spiegel in the yellow jacket, Doshi in the letterman, Lenny with
  headphones + boom-mic, Madhavan, Turley the mascot-bot), archetype colour-coding (SHOTO gold / GRAPPLER red /
  ZONER blue), locked-P1 + hover-P2 plates, magenta cursor glow, an info panel with an HP bar, and clean control
  hints. Cohesive startup-world theme carried into the stage names (Garage / Rocket Deck / War Room / Channel /
  Listing Floor / Pricing Room).
- **Weak — composition is badly under-filled.** All three screens strand a narrow centre grid in a huge dead
  purple void, with tiny isolated corner plates. It reads like a mobile layout stretched onto 16:9. AAA select
  screens fill the frame.
- **Weak — nothing is alive.** No large animated hero render of the hovered fighter, static grid cells, inert
  flat-gradient background. The VS screen just reuses the **gameplay sprite blown up** in a box — which exposes
  the ~2–3× upscale softness — and its "clash" divider is a single thin orange stroke.
- **Weak — stage thumbnails show no stage.** Each stage cell is an abstract horizontal colour-gradient band;
  Garage / War Room / Channel are indistinguishable hued swatches. You learn nothing about any arena.
- **Bug-adjacent — an `UNTESTED` dev badge is leaking into player-facing UI** on "The Model Floor." Reads as a
  placeholder marker, not shipped polish.

### Audio — PASS (seam joined)
First non-camera instrument this project has ever had (`audio-probe.mjs`, reading `__PLAY__.audio()`).
`contextRunning=true`, `musicStarted` flips ~1.6 s in, and the counters climb **semantically staggered** —
announcer at intro, footsteps when walking, impacts when hits land. The 2,033-line engine that was **never
called for the project's entire history** is now wired and would be audible. Headline credit of the session.
**Constitutional blindness:** a counter is not an ear — I can prove events *fire*, not that the mix, waveform,
or sync are good. `voices=0` in neutral is unexplained. Needs a spectral/waveform instrument before I score it.

---

## THE SINGLE WORST THING ON SCREEN

**The "Ion Storm" super — the game's climactic hero moment — resolves to a fuzzy white bloom oval with no shape,
no colour, and no identity.** (`beea557`, `critique/v9-beea/ionstorm/`, frames f061–095.)

For a move named *Ion Storm* I should see an ionized electric-blue discharge — a defined beam column or lance,
crackling tendrils, a violent directional streak from caster to target. What actually renders is a soft
white-blue **light smudge** hanging in the mid-screen gap like a lens flare. `measure-super` confirms the core is
**blown-out white, not indigo** (the "387k blue pixels" at launch are the white flash; blue only survives as a
faint fringe), particles are sparse (not a "storm"), and there is no beam geometry at all. The buildup is right —
world-dim −16% luma / −27% sat, a real charge animation, a dramatic freeze — and then the payoff whiffs. The most
important 35 frames in the game are its weakest.

---

## RANKED, ROUTED PROBLEM LIST (worst first)

1. **Ion Storm beam = identity-less white bloom orb.** No beam shape, no ion-blue colour, blown-white core, sparse
   particles, no directional travel. → **projectile-vfx** (primary: beam geometry, colour identity, crackle,
   particle density) **+ renderer-aaa** (secondary: bloom is eating the colour and clipping the core to white).
   `beea557`, `1475f8d` in build.
2. **0 px camera kick on contact — impact has no screen feedback.** → **renderer-aaa**. `impact.json maxMag: 0`;
   `1475f8d` git-verified not to touch camera, so it holds at `beea557`.
3. **Select / VS / stage suite is under-filled, static, and shows no stage art.** Dead-space composition, no
   animated hero render, gradient stage thumbnails that convey nothing, `UNTESTED` badge leaking to players. →
   **fight-hud** (layout, hero render, remove/gate the dev badge) **+ stage-art** (render real per-stage
   thumbnails). `beea557`.
4. **Wall decals read as pasted stickers.** Blue growth-chart line + pixel windows don't take the stage's
   directional light or parallax. → **stage-art**. `beea557`.
5. **Sprites are a soft ~2–3× bilinear upscale, not crisp pixel art.** Measured (autocorr + run-length). →
   **sprite-pipeline**. `beea557`.
6. **VS screen reuses the gameplay sprite blown up** — no dedicated high-res VS portrait, which is why it looks
   soft. → **sprite-pipeline** (VS-res art) **+ fight-hud** (frame it). `beea557`.

## CREDITS (earned — I am not crying wolf)

- **Audio seam joined — total silence is over.** → **fight-audio**. `2735e9d` in `beea557`.
- **Super dead-back-half fixed** — real charge animation through the freeze, envelope ratio 0.73. →
  **renderer-aaa / projectile-vfx** via `1475f8d` in `beea557`.
- **HUD craft is genuinely strong** — real portraits, clean bars, timer, pips, meters. → **fight-hud**. `beea557`.
- **Stage has real depth and atmosphere** — god-rays, string-light bokeh, concrete, warm key. → **stage-art**.
  `beea557`.
- **Roster is real character art with clear archetype identity.** → **sprite-pipeline / fight-hud**. `beea557`.

## OPEN METHOD NOTES / CONSTITUTIONAL BLIND SPOTS

- **Audio quality/mix/sync unjudged** — `audio-probe` is a counter, not an ear. Needs a spectral/waveform
  instrument. `voices=0` in neutral is unexplained.
- **`edgeAlpha` edge-crispness (touched in `2735e9d`, +95) could not be isolated** against the busy 3D backdrop —
  needs a controlled flat background to measure the silhouette ramp. Not claimed either way.
- **`04-heavy` is a no-contact frame** — impact judged from the dedicated capture only.
- **Harness degraded post-capture** (scrambled ports, intermittent GPU `geometry` crash) — not a product bug; all
  v9 frames predate it. Rebuild on a single clean server for v10.
- **Blind A/B not run this session** — deferred to v10 on a clean harness.
- **Not captured past `beea557`:** `5e77e57` roster-wide reactions and everything to `a23adcf`. Re-verify in v10;
  do not credit unseen work.

---

*Evidence on disk:* `play-shots/beea/` (9 beats), `critique/v9-beea/ionstorm/` (96 frames + json) and
`ionstorm-strip.jpg`, `critique/v9-beea/select/` (select/vs/stage), `critique/v9-c86/impact/` (16 frames +
`impact.json`), `critique/v9-beea/heavy-preview.jpg` + `beam-preview.jpg`. Instruments:
`tools/audio-probe.mjs`, `tools/sprite-craft.mjs`, `tools/warden-super.mjs`, `tools/measure-super.mjs`,
`tools/impact-frames.mjs`.
