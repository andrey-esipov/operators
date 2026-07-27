/**
 * The full animation frame set for a fighter.
 *
 * The probe proved one thing: gpt-image-2 can redraw the stance sprite into a
 * new pose without losing the character, and the segmentation + foot-anchor
 * maths re-seat those poses on a common origin. This file scales that from a
 * five-frame proof to a real fighter's worth of animation — enough frames that
 * a walk cycle reads as walking and a punch reads as startup → contact →
 * recovery rather than a single held drawing.
 *
 * A `FrameSpec` is one generated drawing. Frames are generated ONCE each,
 * always edited from the neutral stance so identity cannot drift down a
 * sequence, then referenced by name from `CLIPS`. Clips are the named
 * animations the renderer plays; several clips can share a frame (the idle
 * loop bounces off its middle key, block and throw-tech reuse the same guard),
 * which keeps the generation bill down without making the motion look cheap.
 */

/**
 * One drawing to generate.
 *
 * `heightRatio` carries a deliberate posture change through registration: a
 * crouch is genuinely shorter than a stance, so without this every pose would
 * be stretched back to the same height and the crouch would pop up onto its
 * feet. `aspect` is the rough width:height the silhouette should land in for
 * this pose — the validator uses it as an off-model tripwire (a "crouch" that
 * comes back tall and thin was drawn wrong), so the ranges are wide on
 * purpose and only catch gross mistakes.
 */
export interface FrameSpec {
  name: string
  heightRatio: number
  /** [min, max] silhouette width / height. Undefined = don't check. */
  aspect?: [number, number]
  pose: string
}

/**
 * The neutral stance is frame 0 and is never generated — it is the untouched
 * reference sprite, so it is guaranteed on-model and gives the validator a
 * ground truth to measure every generated frame against.
 */
export const STANCE_FRAME = 'idle-1'

export const FRAMES: FrameSpec[] = [
  // ── Idle: a slow breathing loop, not a frozen pose ──────────────────────
  // idle-1 is the stance reference itself (see STANCE_FRAME); 2 and 3 are the
  // top and settle of the breath. Played 1→2→3→2 the chest rises and falls.
  {
    name: 'idle-2',
    heightRatio: 1.02,
    aspect: [0.28, 0.62],
    pose:
      'the top of a calm breathing cycle in a neutral fighting guard — standing tall, chest expanded and ' +
      'lifted slightly, shoulders raised a touch, both fists held up loosely in guard, weight even on both feet.',
  },
  {
    name: 'idle-3',
    heightRatio: 0.99,
    aspect: [0.28, 0.62],
    pose:
      'the settle of a breathing cycle in a neutral fighting guard — shoulders relaxed and dropped slightly, ' +
      'chest lowered as the breath goes out, knees softly bent, both fists up in a loose guard, weight even.',
  },

  // ── Walk forward: a four-key cycle (contact, passing, contact, passing) ──
  {
    name: 'walk-fwd-1',
    heightRatio: 1.0,
    aspect: [0.34, 0.7],
    pose:
      'a forward walk contact frame in a fighting guard — front foot planted flat and heel just landing, back ' +
      'leg extended behind with heel lifted, torso upright, both fists held up in guard, moving toward the target.',
  },
  {
    name: 'walk-fwd-2',
    heightRatio: 0.98,
    aspect: [0.26, 0.55],
    pose:
      'a forward walk passing frame in a fighting guard — feet close together directly under the hips as the ' +
      'back leg swings through, body at its lowest point of the stride, both fists up in guard, upright.',
  },
  {
    name: 'walk-fwd-3',
    heightRatio: 1.0,
    aspect: [0.34, 0.7],
    pose:
      'a forward walk contact frame with the opposite leg leading — the other foot now planted forward with ' +
      'heel landing, trailing leg extended back with heel raised, both fists up in guard, torso upright.',
  },
  {
    name: 'walk-fwd-4',
    heightRatio: 1.01,
    aspect: [0.26, 0.55],
    pose:
      'a forward walk passing frame at the top of the stride — legs passing close, body lifting slightly, ' +
      'weight rolling forward onto the ball of the front foot, both fists up in guard, upright.',
  },

  // ── Walk back: shuffling away while still facing the opponent ────────────
  {
    name: 'walk-back-1',
    heightRatio: 1.0,
    aspect: [0.34, 0.7],
    pose:
      'a backward shuffle-step while still facing right — the rear foot reaching back to take weight, front ' +
      'foot sliding back toward it, body leaning back slightly, both fists held high in a careful guard.',
  },
  {
    name: 'walk-back-2',
    heightRatio: 0.98,
    aspect: [0.26, 0.55],
    pose:
      'a backward shuffle passing frame while facing right — feet drawn close together under the hips mid-retreat, ' +
      'weight settling onto the back foot, body compact and low, both fists held high in guard.',
  },
  {
    name: 'walk-back-3',
    heightRatio: 1.0,
    aspect: [0.34, 0.7],
    pose:
      'a backward shuffle-step with the front foot pushing off while facing right — rear foot planted behind ' +
      'taking the weight, front foot lifting to slide back, body leaning away, both fists held high in guard.',
  },
  {
    name: 'walk-back-4',
    heightRatio: 1.01,
    aspect: [0.26, 0.55],
    pose:
      'a backward shuffle passing frame at the top of the retreat while facing right — legs close, body rising ' +
      'slightly as weight transfers backward, both fists held high in a defensive guard.',
  },

  // ── Crouch ──────────────────────────────────────────────────────────────
  {
    name: 'crouch',
    heightRatio: 0.68,
    aspect: [0.55, 1.1],
    pose:
      'crouching low in a defensive stance — knees deeply bent so the whole body is much lower to the ground, ' +
      'thighs near horizontal, hips dropped, both forearms raised in front of the chest and face to guard, chin tucked.',
  },

  // ── Jump: rise (tucked), apex (peak), fall (reaching down) ───────────────
  {
    name: 'jump-rise',
    heightRatio: 0.82,
    aspect: [0.5, 1.0],
    pose:
      'the rising phase of a jump, airborne with both feet off the ground — knees tucked up toward the chest, ' +
      'body compact and curled, arms drawn in, momentum clearly upward, no ground contact at all.',
  },
  {
    name: 'jump-apex',
    heightRatio: 0.85,
    aspect: [0.5, 1.0],
    pose:
      'the floating apex of a jump, fully airborne — body at the peak of the arc, legs tucked and slightly ' +
      'spread for balance, arms out for control, hanging weightless for a moment, no ground contact.',
  },
  {
    name: 'jump-fall',
    heightRatio: 0.9,
    aspect: [0.4, 0.9],
    pose:
      'the falling phase of a jump, airborne — legs beginning to extend downward reaching for the ground, ' +
      'body straightening, arms coming up to guard on landing, momentum clearly downward, feet not yet planted.',
  },

  // ── Dashes ────────────────────────────────────────────────────────────
  {
    name: 'dash',
    heightRatio: 0.94,
    aspect: [0.55, 1.05],
    pose:
      'an explosive forward dash — body pitched low and forward over a deeply bent front leg, back leg driving ' +
      'out straight behind, both fists pulled in tight, lunging toward the target with committed forward momentum.',
  },
  {
    name: 'backdash',
    heightRatio: 0.96,
    aspect: [0.5, 1.0],
    pose:
      'an evasive backward hop while facing right — pushing off the front foot, body leaning back and away from ' +
      'the target, both feet low off the ground, fists held in tight, retreating quickly.',
  },

  // ── Normals: light / medium / heavy, punches and kicks ──────────────────
  {
    name: 'lp-startup',
    heightRatio: 0.99,
    aspect: [0.3, 0.62],
    pose:
      'the startup of a quick light jab — lead fist just beginning to leave the guard toward the target, elbow ' +
      'still bent, shoulders barely rotated, weight centred, a small fast movement not yet extended.',
  },
  {
    name: 'lp-active',
    heightRatio: 0.99,
    aspect: [0.5, 0.95],
    pose:
      'the contact frame of a quick light jab — lead arm snapped straight forward at head height, fist clenched, ' +
      'only a short crisp extension, rear fist still guarding the chin, feet planted, minimal body commitment.',
  },
  {
    name: 'mp-active',
    heightRatio: 0.99,
    aspect: [0.55, 1.0],
    pose:
      'the contact frame of a solid straight punch — lead arm fully extended horizontally forward at shoulder ' +
      'height, fist clenched at full reach, shoulders squared into it, hips rotating in, rear hand guarding.',
  },
  {
    name: 'hp-startup',
    heightRatio: 0.98,
    aspect: [0.35, 0.7],
    pose:
      'the wind-up of a heavy power punch — rear fist cocked all the way back past the hip, torso coiled and ' +
      'rotated away from the target, weight loaded onto the back foot, front arm guarding, whole body wound like a spring.',
  },
  {
    name: 'hp-active',
    heightRatio: 0.98,
    aspect: [0.6, 1.15],
    pose:
      'the contact frame of a heavy power punch — rear arm driven fully across and extended forward, fist at ' +
      'maximum reach, hips and shoulders violently rotated into the blow, back leg straight and braced, whole body committed.',
  },
  {
    name: 'lk-active',
    heightRatio: 0.99,
    aspect: [0.55, 1.05],
    pose:
      'the contact frame of a quick low kick — lead leg snapping out forward at shin height, foot pointed at ' +
      'the target, knee only partly extended, arms kept up in guard, a short fast poke of a kick, upright balance.',
  },
  {
    name: 'mk-active',
    heightRatio: 1.0,
    aspect: [0.6, 1.15],
    pose:
      'the contact frame of a mid-level side kick — lead leg extended straight forward at waist height, foot ' +
      'driving into the target, supporting leg bent, arms held out for balance and guard, hips turned into the kick.',
  },
  {
    name: 'hk-startup',
    heightRatio: 1.02,
    aspect: [0.3, 0.62],
    pose:
      'the chamber of a heavy roundhouse kick — rear knee lifted high and cocked across the body, hips loading ' +
      'to swing the leg, supporting leg bent, arms wound across for counter-rotation, about to unleash a big kick.',
  },
  {
    name: 'hk-active',
    heightRatio: 1.05,
    aspect: [0.65, 1.3],
    pose:
      'the contact frame of a heavy roundhouse kick — rear leg swung all the way up and extended forward at head ' +
      'height, foot slicing across at the target, hips fully rotated, arms flung out for balance, huge committed arc.',
  },

  // ── Specials ────────────────────────────────────────────────────────────
  {
    name: 'special-fireball-charge',
    heightRatio: 0.9,
    aspect: [0.4, 0.9],
    pose:
      'gathering energy for a projectile — both hands cupped together drawn back to the hip, knees bent into a ' +
      'wide braced stance, body coiled and leaning back, concentrating force between the palms, about to thrust forward.',
  },
  {
    name: 'special-fireball-release',
    heightRatio: 0.95,
    aspect: [0.6, 1.2],
    pose:
      'releasing a projectile — both palms thrust fully forward together at chest height toward the target, arms ' +
      'extended, body driving forward off the back leg into the push, hands open pushing energy out ahead.',
  },
  {
    name: 'special-uppercut',
    heightRatio: 1.08,
    aspect: [0.3, 0.62],
    pose:
      'a rising uppercut launch — lead arm punching straight up overhead, body stretched fully vertical and ' +
      'rising up onto the toes of the front foot, other arm trailing down, exploding upward off the ground.',
  },

  // ── Hit reactions ────────────────────────────────────────────────────────
  {
    name: 'hit-high',
    heightRatio: 0.97,
    aspect: [0.35, 0.75],
    pose:
      'snapping back from a blow to the head — head and torso whipped backward, chin up, arms flying out loosely ' +
      'to the sides, one foot sliding back to catch the weight, staggered off balance by the impact.',
  },
  {
    name: 'hit-low',
    heightRatio: 0.86,
    aspect: [0.5, 1.0],
    pose:
      'doubling over from a blow to the gut — torso folded sharply forward, both arms clutching in toward the ' +
      'stomach, knees buckling and dropping the body lower, head bowed, winded and hunched by the impact.',
  },

  // ── Blocks ────────────────────────────────────────────────────────────
  {
    name: 'block-stand',
    heightRatio: 0.99,
    aspect: [0.3, 0.62],
    pose:
      'standing block — both forearms stacked tightly across the front of the face and chest forming a tight ' +
      'vertical guard, shoulders hunched behind the arms, weight braced on a slightly back-leaning stance, bracing for impact.',
  },
  {
    name: 'block-crouch',
    heightRatio: 0.66,
    aspect: [0.6, 1.15],
    pose:
      'crouching block — squatting low with both forearms pulled in tight across the face and body as a compact ' +
      'shield, knees fully bent, body curled small behind the guard low to the ground, bracing for a low hit.',
  },

  // ── Knockdown & wakeup ─────────────────────────────────────────────────
  {
    name: 'knockdown',
    heightRatio: 0.42,
    aspect: [1.3, 2.6],
    pose:
      'knocked flat on the ground — lying on the back along the floor, legs and arms sprawled out limp, head down, ' +
      'the whole body horizontal and low against the bottom of the frame, completely floored.',
  },
  {
    name: 'wakeup',
    heightRatio: 0.72,
    aspect: [0.55, 1.1],
    pose:
      'rising from a knockdown — pushing up off one hand and a bent knee, torso lifting off the ground and ' +
      'twisting back upright, other arm coming up to guard, halfway back to standing, gathering the feet under the body.',
  },

  // ── Ceremony ────────────────────────────────────────────────────────────
  {
    name: 'victory',
    heightRatio: 1.02,
    aspect: [0.3, 0.75],
    pose:
      'a triumphant victory pose after winning the match — one fist raised confidently, chest out, chin up, a ' +
      'proud grin, weight settled on a relaxed confident stance, celebrating the win, both feet planted.',
  },
  {
    name: 'ko',
    heightRatio: 0.4,
    aspect: [1.3, 2.6],
    pose:
      'knocked out cold on the ground — collapsed flat on the back, limbs splayed limp and motionless, head ' +
      'lolled to one side, completely unconscious and horizontal against the bottom of the frame, defeated.',
  },
]

/** All frame names, in generation order, with the free stance frame first. */
export const FRAME_ORDER: string[] = [STANCE_FRAME, ...FRAMES.map((f) => f.name)]

export function frameIndex(name: string): number {
  const i = FRAME_ORDER.indexOf(name)
  if (i < 0) throw new Error(`unknown frame ${name}`)
  return i
}

/**
 * Named animations the renderer plays, each a list of frame indices with a
 * per-key duration in 60fps sim frames. Keys cover every `Stance` in the
 * contract so the renderer always resolves a clip, plus the individual attack
 * and reaction clips a move can point a `MoveFrame.sprite` at.
 *
 * Durations are hand-tuned for feel: idle breathes slowly, walks cycle at a
 * brisk ~10 frames/key, attack startups are short and snappy. `loop` is true
 * for anything that holds on screen (locomotion, guards) and false for
 * one-shot actions (attacks, reactions, ceremony).
 */
export interface ClipSpec {
  frames: string[]
  durations: number[]
  loop: boolean
}

const clip = (loop: boolean, ...pairs: [string, number][]): ClipSpec => ({
  frames: pairs.map((p) => p[0]),
  durations: pairs.map((p) => p[1]),
  loop,
})

// Per-move clips a MoveFrame / attack stance can index into. Defined as named
// consts so the sim's move ids (st.LP, cr.HP, qcf.P …) can alias straight onto
// them below without re-specifying frames and durations.
const LP = clip(false, ['lp-startup', 3], ['lp-active', 4], ['lp-startup', 4])
const MP = clip(false, ['idle-1', 3], ['mp-active', 5], ['idle-1', 6])
const HP = clip(false, ['hp-startup', 5], ['hp-active', 5], ['hp-startup', 8])
const LK = clip(false, ['lk-active', 4], ['idle-1', 5])
const MK = clip(false, ['mk-active', 5], ['idle-1', 7])
const HK = clip(false, ['hk-startup', 6], ['hk-active', 6], ['idle-1', 10])
const FIREBALL = clip(false, ['special-fireball-charge', 8], ['special-fireball-release', 6], ['idle-1', 8])
const UPPERCUT = clip(false, ['crouch', 4], ['special-uppercut', 6], ['jump-fall', 6])
const SUPER = clip(false, ['special-fireball-charge', 6], ['special-uppercut', 8], ['special-fireball-release', 8])

export const CLIPS: Record<string, ClipSpec> = {
  // ── Stance-enum clips ────────────────────────────────────────────────────
  // Keyed by the exact names AnimationDriver.clipCandidates() looks up for each
  // FighterState.stance. Getting a key wrong here does not error — the driver
  // silently falls back to `idle`, so the fighter just never plays that stance.
  // In particular `blockstun` resolves to `['block','guard','idle']` and
  // `hitstun` to `['hurt','hit','idle']`, so those clips MUST be named `block`
  // and `hurt`, not after the stance. (An earlier cut named them after the
  // stance and block/hitstun animation silently vanished.)
  idle: clip(true, ['idle-1', 12], ['idle-2', 12], ['idle-3', 12], ['idle-2', 12]),
  'walk-fwd': clip(true, ['walk-fwd-1', 9], ['walk-fwd-2', 9], ['walk-fwd-3', 9], ['walk-fwd-4', 9]),
  'walk-back': clip(true, ['walk-back-1', 9], ['walk-back-2', 9], ['walk-back-3', 9], ['walk-back-4', 9]),
  crouch: clip(true, ['crouch', 8]),
  'jump-rise': clip(false, ['jump-rise', 6], ['jump-apex', 8]),
  'jump-fall': clip(false, ['jump-fall', 8]),
  dash: clip(false, ['dash', 10]),
  backdash: clip(false, ['backdash', 10]),
  attack: clip(false, ['mp-active', 8]),
  block: clip(true, ['block-stand', 6]),
  hurt: clip(false, ['hit-high', 10]),
  juggle: clip(false, ['hit-high', 10]),
  knockdown: clip(false, ['knockdown', 20]),
  wakeup: clip(false, ['wakeup', 14]),
  'throw-tech': clip(false, ['block-stand', 8]),
  ko: clip(false, ['ko', 30]),

  // ── Generic per-button clips ─────────────────────────────────────────────
  lp: LP, mp: MP, hp: HP, lk: LK, mk: MK, hk: HK,
  'special-fireball': FIREBALL,
  'special-uppercut': UPPERCUT,
  super: SUPER,
  'hit-low': clip(false, ['hit-low', 12]),
  'block-crouch': clip(true, ['block-crouch', 6]),
  victory: clip(false, ['victory', 40], ['idle-2', 20]),

  // ── Sim move-id aliases ──────────────────────────────────────────────────
  // AnimationDriver resolves an attack as [moveId, 'attack', 'idle'], so a clip
  // named after the sim's move id lets each button play its own animation
  // instead of every attack collapsing onto the generic `attack` frame. Ids are
  // the ones authored in src/fight/fighters/operator.ts.
  'st.LP': LP, 'cr.LP': LP, 'j.LP': LP,
  'st.MP': MP, 'cr.MP': MP, 'f.MP': MP,
  'st.HP': HP, 'j.HP': HP,
  'cr.HP': UPPERCUT, // Rising Uppercut
  'st.LK': LK, 'cr.LK': LK,
  'st.MK': MK, 'cr.MK': MK, 'j.MK': MK,
  'st.HK': HK, 'cr.HK': HK, 'j.HK': HK, 'f.HK': HK,
  'qcf.P': FIREBALL, // Surge Palm
  'dp.P': UPPERCUT, // Rising Dragon
  'qcb.K': HK, // Tornado Kick
  'charge.P': FIREBALL, // Cannon
  'super.P': SUPER, // Palm Barrage
}

/**
 * The edit prompt, lifted from the probe where it was proven to hold identity.
 * It leans hard on "same character, only the pose changes" and pins the
 * framing (side view, facing right, feet at the bottom, flat #808080 field)
 * that the segmentation and registration downstream depend on.
 */
export function buildPrompt(pose: string): string {
  return `Redraw the EXACT SAME CHARACTER from the reference image in a new body pose.

This is one frame of a 2D fighting game animation, so the character MUST be identical to the reference in every way except the pose.

IDENTITY — must match the reference image exactly:
- Same face, same hairstyle, same hair colour, same skin tone
- Same outfit: identical shirt, trousers, jacket, shoes and colours
- Same accessories (glasses, watch, lanyard, props)
- Same body build, same height, same proportions

NEW POSE: ${pose}

STYLE — identical to the reference:
- 16-bit pixel art, Street Fighter II / King of Fighters '98 arcade style
- HARD CRISP pixel edges, NO anti-aliasing, NO blur, NO soft gradients
- Same limited colour palette and same hard cel-shaded shadows
- Strong dark outline around the character

FRAMING — critical for animation:
- Full body, side view, character facing RIGHT
- Character standing on the BOTTOM of the frame, feet near the lower edge
- Same scale as the reference — the character must be the SAME HEIGHT
- Flat solid mid-grey (#808080) background, nothing else in frame

NEGATIVE: no anti-aliasing, no 3D render look, no photorealism, no text, no watermark, no motion blur, no speed lines, no background scenery, no shadow on the ground.`
}
