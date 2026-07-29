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
  {
    // The living sway the breath-only keys lack. A great idle shifts weight and
    // drifts the guard, not just rises and falls. Feet stay planted so the foot
    // anchor is stable; only the hips, shoulder and lead hand move.
    name: 'idle-4',
    heightRatio: 1.0,
    aspect: [0.3, 0.64],
    pose:
      'a small living weight-shift in a neutral fighting guard — weight easing onto the back foot with both feet ' +
      'still planted flat, lead shoulder dropping a touch and the front guard hand drifting slightly outward and ' +
      'down, chest still lifted, a calm idle sway, poised and ready.',
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
  {
    // The exhale of a crouching idle — players sit in crouch, so it must breathe.
    // Same planted stance, a touch lower and looser as the breath settles.
    name: 'crouch-2',
    heightRatio: 0.66,
    aspect: [0.56, 1.12],
    pose:
      'crouching low in a defensive stance at the settle of a breath — knees deeply bent and hips sunk a little ' +
      'lower, shoulders dropping and chest easing down as the breath goes out, both forearms still raised guarding ' +
      'the face and chest, chin tucked, feet planted flat.',
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
    // Mid-ascent, so the fully-visible rise isn't a single held drawing. Still
    // airborne and climbing — a distinct keyframe (the tuck->apex morph smears).
    name: 'jump-rise-2',
    heightRatio: 0.84,
    aspect: [0.5, 1.0],
    pose:
      'still ascending in the middle of a jump, fully airborne with both feet off the ground — the body beginning ' +
      'to uncurl out of the tuck, knees dropping away from the chest, arms starting to come out from the body, ' +
      'momentum still clearly upward, no ground contact.',
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
  {
    // Touchdown. Without it the long, fully-visible jump arc hard-cuts from
    // airborne to standing. A knee-bend absorb gives the landing weight.
    name: 'jump-land',
    heightRatio: 0.8,
    aspect: [0.5, 1.05],
    pose:
      'landing from a jump with both feet just planted on the ground — knees bending deeply to absorb the impact, ' +
      'body compressing downward and hips sinking low, arms swinging out for balance, weight driving hard into the ' +
      'ground on touchdown.',
  },

  // ── Dashes ────────────────────────────────────────────────────────────
  {
    // Anticipation. A dash is explosive, so it keyframes (coil -> burst ->
    // settle) rather than morphing — an idle->dash tween double-images because
    // the pose change is large. This coil doubles as the recovery frame.
    name: 'dash-ready',
    heightRatio: 0.9,
    aspect: [0.5, 1.0],
    pose:
      'the coiled instant before an explosive forward dash — knees bending and weight loading down and back over ' +
      'the rear leg, torso dropping and coiling slightly forward, both fists pulled in tight, gathering to spring ' +
      'forward, feet planted flat on the ground.',
  },
  {
    name: 'dash',
    heightRatio: 0.94,
    aspect: [0.55, 1.35],
    pose:
      'an explosive forward dash — body pitched low and forward over a deeply bent front leg, back leg driving ' +
      'out straight behind, both fists pulled in tight, lunging toward the target with committed forward momentum.',
  },
  {
    // Anticipation for the backward hop; also its recovery frame.
    name: 'backdash-ready',
    heightRatio: 0.94,
    aspect: [0.5, 1.0],
    pose:
      'the coiled instant before an evasive backward hop while facing right — weight loading onto the front foot, ' +
      'knees bending and body compressing slightly, fists tucked in tight, about to push off and spring backward, ' +
      'feet planted flat on the ground.',
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

  // ── Super ─────────────────────────────────────────────────────────────────
  // Bespoke keys for the showcase move — the ONE attack that previously shipped
  // with zero art of its own (the old SUPER const stitched fireball-charge +
  // uppercut + fireball-release into a formless recycle). These three read as a
  // single coherent super arc: gather a huge charge, unleash it in a deep
  // committed lunge, wind down. Shared by BOTH energy-projection supers —
  // operator's Palm Barrage (super.P) and warden's Ion Storm (super.storm) —
  // because each is redrawn from its own skin's stance, so the same "channel and
  // blast" pose reads as that character's own super. The vanguard grappler's
  // Backbreaker is NOT a projectile and must NOT borrow these; it needs its own
  // grab/slam keys + archetype routing before any vanguard skin is generated
  // (see the note on ATTACK_SHAPES.super below). The release is drawn
  // deliberately distinct from special-fireball-release (deeper lunge, arms
  // angled up, whole-body commitment) so the super cannot read as a bigger
  // fireball — accept-poses enforces that divergence mechanically.
  {
    name: 'super-charge',
    heightRatio: 1.0,
    aspect: [0.45, 1.05],
    pose:
      'the wind-up of a super attack — both arms sweeping back and outward to gather a massive surge of energy, ' +
      'chest thrown open and the whole torso torqued and coiled back over a deeply braced back leg, weight loaded ' +
      'low and ready to explode forward, a huge dramatic gathering far bigger and wider than a normal fireball ' +
      'wind-up, clearly summoning a super not a small projectile. The FIGHTER\u2019S BODY is the dominant, instantly ' +
      'readable shape — a bold silhouette of arms, open chest and braced legs that reads on its own even with the ' +
      'glow removed, because in engine the energy aura is drawn BEHIND the fighter and hidden; the gathered energy ' +
      'hugs and is framed by the body, never a free-floating disc or orb in front that swallows the figure.',
  },
  {
    name: 'super-release',
    heightRatio: 0.96,
    aspect: [0.8, 1.65],
    pose:
      'the release of a super attack — driving into a deep committed forward lunge off the back leg, BOTH arms ' +
      'thrust fully forward and angled slightly upward hurling a torrent of energy ahead, hands open and blasting, ' +
      'the torso driven low and far forward behind the blast, a huge full-body commitment far larger, deeper and ' +
      'lower than a normal two-palm chest-height fireball push — the unmistakable money-shot pose of a super, not ' +
      'a bigger fireball. The hurled energy has bold INTERNAL STRUCTURE — a bright hard-edged core wrapped in ' +
      'crackling darker striations and layered concentric edges, high internal contrast rather than a smooth soft ' +
      'gradient, so it stays legible under heavy bloom instead of washing to a featureless glow; the fighter\u2019s ' +
      'lunging body stays clearly readable through and beside the blast, never dissolved into it.',
  },
  {
    name: 'super-recovery',
    heightRatio: 0.98,
    aspect: [0.4, 0.95],
    pose:
      'the recovery of a super attack — the huge forward commitment now spent, both arms sweeping down and out to ' +
      'the sides as the last of the energy disperses, weight settling forward onto the bent front leg, torso ' +
      'rising back up out of the deep lunge toward a neutral guard, winding down from the super.',
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
  {
    // The settle of a hitstun: the snap-back has peaked and the body is coming
    // back toward guard. Played after hit-high it turns a single frozen recoil
    // into a snap → recover beat.
    name: 'hit-settle',
    heightRatio: 0.99,
    aspect: [0.3, 0.7],
    pose:
      'recovering balance just after a blow to the head — head and torso swinging back forward toward centre and ' +
      'nearly upright again, both hands drawing back in toward a raised guard, weight resettling onto both feet, still a little rattled.',
  },
  {
    // The middle of the recovery, between the extreme snap-back and the near-
    // guard settle. Without it the recoil collapses straight to a composed
    // stance in a single tween; this gives the body a clean half-recovered beat
    // to decelerate through, and halves the change each morph must cover.
    name: 'hit-reel',
    heightRatio: 0.96,
    aspect: [0.4, 0.85],
    pose:
      'still reeling from a blow to the head, only beginning to recover — head still tipped back and off to one side, ' +
      'torso still leaning away from the hit, arms loose and swinging back in from wide, weight caught on the rear ' +
      'foot, clearly still rattled and not yet steady.',
  },

  // ── Juggle: an airborne tumble arc, launch → apex → fall ─────────────────
  {
    name: 'juggle-launch',
    heightRatio: 1.1,
    aspect: [0.45, 1.15],
    pose:
      'just launched off the ground by an uppercut — the body jackknifed backward and both feet lifting clear of ' +
      'the floor, spine arched, head and arms thrown back loosely, completely airborne and helpless, rising fast.',
  },
  {
    name: 'juggle-apex',
    heightRatio: 0.72,
    aspect: [1.0, 2.4],
    pose:
      'at the very top of a juggle, tumbling in mid-air — the body turned almost horizontal and rotating, arms and ' +
      'legs trailing loosely behind the motion, head tipped back and limp, fully airborne with no control, floating at the peak.',
  },
  {
    // The hinge between the horizontal apex and the head-down fall. Without it
    // the morph has to swing ~90deg of rotation in a single tween and smears;
    // this diagonal mid-somersault halves the rotation each tween must cover.
    name: 'juggle-spin',
    heightRatio: 0.9,
    aspect: [0.7, 1.75],
    pose:
      'mid-tumble in the air, rotating past horizontal toward upside-down — the body tilted steeply on a diagonal, ' +
      'head dropping down and to one side, legs swinging up overhead, arms trailing loosely, fully airborne and limp, ' +
      'caught halfway through the backward somersault.',
  },
  {
    name: 'juggle-fall',
    heightRatio: 1.05,
    aspect: [0.5, 1.35],
    pose:
      'dropping out of a juggle, upside-down — the body inverted with the head falling toward the ground and the ' +
      'legs kicked up overhead, arms dangling down loosely, plummeting helplessly head-first, mid-fall.',
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
    // The recoil of a hit landing on the guard. A held pose during a blocked hit
    // is a tell; this absorbs the blow — pushed back, braced, shoulders driven in.
    name: 'block-absorb',
    heightRatio: 0.98,
    aspect: [0.32, 0.66],
    pose:
      'absorbing a blocked hit while standing — both forearms clamped tight across the face and chest taking the ' +
      'blow, the whole body shoved backward and braced against the impact, rear foot sliding back to hold ground, ' +
      'shoulders driven hard into the guard, head tucked down behind the arms.',
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
    // The instant of crashing down — the body still partly off the floor as it
    // slams and bounces. Played before the flat rest it turns a static prone
    // frame into a real impact.
    name: 'knockdown-impact',
    heightRatio: 0.52,
    aspect: [1.1, 2.5],
    pose:
      'crashing down onto the ground on the back and shoulders — the body slamming flat and bouncing slightly, ' +
      'limbs flung out from the impact, still a little off the floor mid-bounce, hitting the ground hard and low in the frame.',
  },
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
  {
    // The last beat of the get-up, so wakeup isn't one held pose that undoes the
    // knockdown. Nearly stood, legs straightening, guard coming up — hard-cuts to
    // idle. Morphing kneel->stand double-images, so it keyframes.
    name: 'wakeup-rise',
    heightRatio: 0.92,
    aspect: [0.4, 0.85],
    pose:
      'the last of getting up from a knockdown — nearly back to standing, legs straightening under the body and ' +
      'torso lifting upright, both fists coming up into a guard, still a touch low and braced, about to settle ' +
      'into the fighting stance, both feet under the body.',
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

  // ── Crouch/air kick keys (Tier C, art-deficit: too few unique poses + wrong
  //    stance) ─────────────────────────────────────────────────────────────
  // cr.LK/cr.MK are the #5/#2 most-landed attacks in a 108-fight census yet drew
  // a SINGLE standing cel; cr.HK is a SWEEP drawn upright; j.MK a grounded cel
  // mid-air. Each family gets a stance-correct chamber (anticipation) + contact
  // (follow-through settles to the existing `crouch`/`jump-fall` cel — a fifth
  // KEY, not a tween). heightRatio sits in the measured crouch band (0.62–0.72)
  // / jump band (0.85–0.88); the accept-poses gate rejects any that come back
  // standing (silhouette height) or grounded (foot gap).
  {
    name: 'crlk-chamber',
    heightRatio: 0.7,
    aspect: [0.5, 1.0],
    pose:
      'the chamber of a crouching light kick — staying low in a deep crouch with knees bent and hips dropped near ' +
      'the ground, the lead leg drawn back and cocked low at ankle height ready to flick out, forearms up guarding ' +
      'the face, body kept compact and close to the floor, clearly crouched not standing.',
  },
  {
    name: 'crlk-active',
    heightRatio: 0.68,
    aspect: [0.6, 1.15],
    pose:
      'the contact frame of a crouching light kick — still crouched low with hips sunk and the supporting knee ' +
      'deeply bent, the lead leg snapping straight out forward at ankle-to-shin height low along the ground, foot ' +
      'pointed at the target, a short fast low poke, forearms kept up, torso staying low, clearly a crouching kick.',
  },
  {
    name: 'crmk-chamber',
    heightRatio: 0.72,
    aspect: [0.45, 0.95],
    pose:
      'the chamber of a crouching medium kick — held low in a deep crouch, hips dropped and thighs near horizontal, ' +
      'the lead knee lifted and cocked across in front of the body loading the kick, supporting leg folded beneath, ' +
      'arms wound in to guard, staying low to the ground about to extend, clearly crouched not standing.',
  },
  {
    name: 'crmk-active',
    heightRatio: 0.7,
    aspect: [0.65, 1.25],
    pose:
      'the contact frame of a crouching medium kick — crouched low with hips sunk and the supporting leg deeply ' +
      'bent, the lead leg driving straight forward at shin-to-knee height, foot spearing into the target low to the ' +
      'ground, torso leaned low over the planted leg, arms out for balance, clearly a low crouching kick not a standing one.',
  },
  {
    name: 'crhk-chamber',
    heightRatio: 0.66,
    aspect: [0.4, 0.9],
    pose:
      'the chamber of a crouching heavy sweep — sunk into the lowest crouch with hips almost at the floor and the ' +
      'supporting knee folded right down, the rear leg coiled underneath and cocked to swing along the ground, torso ' +
      'dropped low and turned to load the sweep, arm braced across the lead knee, about to sweep the leg out low.',
  },
  {
    name: 'crhk-active',
    heightRatio: 0.62,
    aspect: [0.9, 1.8],
    pose:
      'the contact frame of a crouching heavy leg sweep — body dropped extremely low with the hips near the ground ' +
      'and the supporting knee braced low, the sweeping leg swung all the way out straight along the floor at ankle ' +
      'height in a long low arc, foot slicing across at the target’s feet, torso low and extended over the planted ' +
      'leg, the classic low sweep skimming the ground.',
  },
  {
    name: 'jmk-chamber',
    heightRatio: 0.85,
    aspect: [0.5, 1.05],
    pose:
      'the chamber of a jumping medium kick — fully airborne with both feet off the ground and no ground contact at ' +
      'all, body compact in the air, the kicking knee tucked up and cocked ready to snap out, the other leg folded, ' +
      'arms drawn in for balance, clearly mid-air well above the floor.',
  },
  {
    name: 'jmk-active',
    heightRatio: 0.88,
    aspect: [0.6, 1.3],
    pose:
      'the contact frame of a jumping medium kick — fully airborne with both feet off the ground and no ground ' +
      'contact at all, the kicking leg extended down and forward driving the foot into the target below, the ' +
      'supporting leg tucked, torso leaned into the jump-in kick, arms out for balance, clearly a mid-air attack.',
  },
]

/**
 * Inbetweens, synthesised by optical-flow morph from two neighbouring key
 * frames (see scripts/lib/inbetween.ts) rather than generated. An inbetween is
 * defined by its endpoints, so deriving it from them keeps it on-model and,
 * crucially, temporally coherent — the axis a fighting game lives or dies on.
 * These are the highest-screen-time clips: hit reactions (on screen every few
 * seconds), the juggle arc, and the walk cycle.
 */
export interface TweenSpec {
  name: string
  from: string
  to: string
  /** 0..1 position between `from` and `to`. */
  t: number
}

export const TWEENS: TweenSpec[] = [
  // Idle breathing + sway loop. Four keys (neutral → inhale → sway → exhale)
  // with a morph inbetween each edge, wrapping back to neutral. The motion is
  // small and continuous — the flow-morph's best case — so no key jitters and
  // the last tween lands adjacent to idle-1 for a seamless loop.
  { name: 'tw-i1-i2', from: 'idle-1', to: 'idle-2', t: 0.5 },
  { name: 'tw-i2-i4', from: 'idle-2', to: 'idle-4', t: 0.5 },
  // The two edges around idle-3 (the exhale/settle) carry the largest silhouette
  // excursion, so they get two inbetweens each (t=1/3, 2/3) rather than one at
  // the midpoint — this keeps every per-frame delta even across the loop and
  // clears the temporal spike the validator caught on lenny's settle.
  { name: 'tw-i4-i3a', from: 'idle-4', to: 'idle-3', t: 0.34 },
  { name: 'tw-i4-i3b', from: 'idle-4', to: 'idle-3', t: 0.67 },
  { name: 'tw-i3-i1a', from: 'idle-3', to: 'idle-1', t: 0.34 },
  { name: 'tw-i3-i1b', from: 'idle-3', to: 'idle-1', t: 0.67 },
  // Hitstun: snap-back → settle → back toward guard.
  { name: 'tw-hh-hr', from: 'hit-high', to: 'hit-reel', t: 0.5 },
  { name: 'tw-hr-hs', from: 'hit-reel', to: 'hit-settle', t: 0.5 },
  // Juggle arc: launch → apex → fall, a body tumbling through the air.
  { name: 'tw-jl-ja', from: 'juggle-launch', to: 'juggle-apex', t: 0.5 },
  { name: 'tw-ja-js', from: 'juggle-apex', to: 'juggle-spin', t: 0.5 },
  { name: 'tw-js-jf', from: 'juggle-spin', to: 'juggle-fall', t: 0.5 },
  // Knockdown: the bounce settling to the floor.
  { name: 'tw-ki-kd', from: 'knockdown-impact', to: 'knockdown', t: 0.5 },
  // Walk cycles: an inbetween between every contact/passing key, wrapping.
  { name: 'tw-wf-12', from: 'walk-fwd-1', to: 'walk-fwd-2', t: 0.5 },
  { name: 'tw-wf-23', from: 'walk-fwd-2', to: 'walk-fwd-3', t: 0.5 },
  { name: 'tw-wf-34', from: 'walk-fwd-3', to: 'walk-fwd-4', t: 0.5 },
  { name: 'tw-wf-41', from: 'walk-fwd-4', to: 'walk-fwd-1', t: 0.5 },
  { name: 'tw-wb-12', from: 'walk-back-1', to: 'walk-back-2', t: 0.5 },
  { name: 'tw-wb-23', from: 'walk-back-2', to: 'walk-back-3', t: 0.5 },
  { name: 'tw-wb-34', from: 'walk-back-3', to: 'walk-back-4', t: 0.5 },
  { name: 'tw-wb-41', from: 'walk-back-4', to: 'walk-back-1', t: 0.5 },
  // Attack anticipation + recovery-settle. The active frames are already
  // extreme; these fill the snap INTO contact (wind-up) and, more importantly,
  // the snap back to guard (recovery) so a punch doesn't hard-cut to idle.
  // Only the punches get tweens — they extend along a line so the flow-morph is
  // clean. The kicks sweep a wide arc (morph's weak case) and stay snappy at
  // 2-3 extreme frames, which reads fine for a fast normal.
  { name: 'tw-lp-rec', from: 'lp-active', to: 'idle-1', t: 0.5 },
  { name: 'tw-mp-rec', from: 'mp-active', to: 'idle-1', t: 0.5 },
  { name: 'tw-hp-wind', from: 'hp-startup', to: 'hp-active', t: 0.5 },
  { name: 'tw-hp-rec', from: 'hp-active', to: 'idle-1', t: 0.5 },
  // Neutral-game density. Crouch and block get a subtle morph inbetween — small,
  // continuous motion where the flow-morph is clean. Dash, the jump arc and the
  // get-up are large pose changes that double-image under morph, so they keyframe
  // instead (distinct AI poses, hard cuts) — the SF/Tekken way for fast actions.
  { name: 'tw-cr-c2', from: 'crouch', to: 'crouch-2', t: 0.5 },
  { name: 'tw-ba-bs', from: 'block-absorb', to: 'block-stand', t: 0.5 },
]

/** All frame names, in generation order: free stance, generated keys, then synthesised tweens. */
export const FRAME_ORDER: string[] = [STANCE_FRAME, ...FRAMES.map((f) => f.name), ...TWEENS.map((t) => t.name)]

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

/**
 * Remap a clip spec's frame *names* to indices into one fighter's packed frames.
 * Returns null if the fighter is missing any pose the clip references, so the
 * caller can try a fallback rather than emit a clip that points at a hole.
 *
 * Lives here (a zero-dependency module) and is shared by the atlas builder and
 * the reaction-fallback patch so the two cannot diverge — the same discipline as
 * the shared footAnchorX: pipeline logic re-derived in a second place drifts and
 * eventually lies.
 */
export function resolveClip(
  spec: ClipSpec | undefined,
  nameToIndex: Map<string, number>,
): { frames: number[]; durations: number[]; loop: boolean } | null {
  if (!spec) return null
  const frames: number[] = []
  const durations: number[] = []
  for (let i = 0; i < spec.frames.length; i++) {
    const idx = nameToIndex.get(spec.frames[i])
    if (idx === undefined) return null
    frames.push(idx)
    durations.push(spec.durations[i])
  }
  if (!frames.length) return null
  return { frames, durations, loop: spec.loop }
}

// Per-move clips a MoveFrame / attack stance can index into. Defined as named
// consts so the sim's move ids (st.LP, cr.HP, qcf.P …) can alias straight onto
// them below without re-specifying frames and durations. For a PLAYABLE fighter
// every one of these that a move maps to is re-laid-out per move from that move's
// own startup/active/recovery (see `deriveAttackClip`/`ATTACK_SHAPES`); the fixed
// durations here are the fallback for skins with NO moveset (the unplayable card
// art) and the seed of each family's cel ORDER, which `shapeFrom` reads to learn
// which cel is startup, which is contact, which is recovery.
const LP = clip(false, ['lp-startup', 3], ['lp-active', 4], ['tw-lp-rec', 4])
const MP = clip(false, ['idle-1', 3], ['mp-active', 5], ['tw-mp-rec', 5])
const HP = clip(false, ['hp-startup', 5], ['tw-hp-wind', 3], ['hp-active', 5], ['tw-hp-rec', 6])
// Kick statics specifically CANNOT align to a real active window with fixed
// durations — the `*-active` cel is spent during startup and has snapped back to
// idle by the frame the kick connects (LK/MK reserve NO startup cel; HK's 6f
// startup only happens to cover operator's 10f-startup active window and misses
// vanguard/warden's 12f). That is what forced the derived layout; the punches and
// specials below have the same failure at the END of the window (mp-active
// covers 3-7 but vanguard st.MP is active 6-8; the fireball release expires at 13
// but qcf.P is active 11-14), so they are derived too.
const LK = clip(false, ['lk-active', 4], ['idle-1', 5])
const MK = clip(false, ['mk-active', 5], ['idle-1', 7])
const HK = clip(false, ['hk-startup', 6], ['hk-active', 6], ['idle-1', 10])
const FIREBALL = clip(false, ['special-fireball-charge', 8], ['special-fireball-release', 6], ['idle-1', 8])
const UPPERCUT = clip(false, ['crouch', 4], ['special-uppercut', 6], ['jump-fall', 6])
// Recycled-cel FALLBACK ONLY. A playable skin that has generated the bespoke
// super cels derives its super from the `super` ATTACK_SHAPE (super-charge ->
// super-release -> super-recovery); this stitched-together recycle is what a
// skin WITHOUT those cels falls back to (unplayable card art, and any playable
// skin whose super cels have not been generated yet). Do not point a generated
// skin at this — it is the "formless super" the bespoke arc replaces.
const SUPER = clip(false, ['special-fireball-charge', 6], ['special-uppercut', 8], ['special-fireball-release', 8])

// ── Timing-derived attack layout ────────────────────────────────────────────
/**
 * An attack clip laid out from the move's OWN startup/active/recovery, so the
 * contact cel is on screen exactly while the hitbox is live — per archetype, by
 * construction. One shared clip with hand-tuned durations cannot satisfy the
 * three archetypes' different startups at once (st.LK startup is 4 for operator
 * but 5 for vanguard/warden; st.HK 10 vs 12), which is exactly how the kick
 * ladder shipped freezing on the idle breathing cel. The active window is the
 * single parameter the layout reads — never a second number that can drift out
 * of sync with it, the same discipline as SUPER_FREEZE_FRAMES and its envelope.
 */
export interface AttackShape {
  /** Cels covering the startup window [0, startup). Empty ⇒ hold `neutral`:
   *  a two-cel kick has no windup drawing, so it holds the neutral pose and
   *  extends only at contact (extended-at-contact beats telegraphing startup). */
  startup: string[]
  /** The contact cel, held across the whole active window [startup, startup+active). */
  active: string
  /** Cels covering the recovery tail. Empty ⇒ hold `neutral`. */
  recovery: string[]
  /** Filler pose for a phase with no dedicated cel. */
  neutral: string
  /**
   * Optional recycled shape to derive from when a skin has NOT generated this
   * shape's bespoke `active` cel. Lets a bespoke arc roll over PER-SKIN while
   * keeping every un-generated skin byte-identical to its pre-bespoke manifest
   * (same recycled cels, same per-move timing) instead of dropping to a
   * differently-timed static clip. Used by `super`: its bespoke shape is authored
   * AFTER the roster's manifests were built from the old recycled derivation, so
   * without this a commit of the bespoke shape would silently retime every
   * not-yet-generated skin's super (recovery 30→8). The fallback's own `active`
   * cel is itself gated by `has`, so unplayable card art (which lacks even that)
   * still bails to the static CLIPS entry.
   */
  fallback?: AttackShape
}

export interface MoveTiming {
  startup: number
  active: number
  recovery: number
}

/**
 * Tile `dur` sim frames across `cels` (even split, remainder to the earlier
 * cels), merging into a trailing identical hold so the clip stays minimal. An
 * empty cel list emits one `neutral` hold spanning the whole duration.
 */
function tilePhase(
  cels: string[],
  dur: number,
  neutral: string,
  outFrames: string[],
  outDurations: number[],
): void {
  if (dur <= 0) return
  const list = cels.length ? cels : [neutral]
  const base = Math.floor(dur / list.length)
  let rem = dur - base * list.length
  for (const cel of list) {
    const d = base + (rem > 0 ? 1 : 0)
    if (rem > 0) rem--
    if (d <= 0) continue
    if (outFrames.length && outFrames[outFrames.length - 1] === cel) {
      outDurations[outDurations.length - 1] += d
    } else {
      outFrames.push(cel)
      outDurations.push(d)
    }
  }
}

/**
 * Lay an AttackShape out against a move's timing. The active cel is emitted as
 * its own key with duration EXACTLY `t.active`, placed right after a startup
 * phase of EXACTLY `t.startup` frames, so it spans the whole active window
 * [t.startup, t.startup + t.active) = [active[0], active[active.length-1]] — not
 * merely its first frame. That is the fix's core invariant: aligning only the
 * START of the active cel (as a hand-tuned duration accidentally can) leaves the
 * cel free to expire one frame early and drop the LAST active frame back onto the
 * recovery/idle pose. Because contact can latch on any active frame (a defender
 * who walks into a later active frame freezes THAT frame), every frame in the
 * window must be the contact cel, so the active cel's duration is bound to the
 * window length by construction — never a second number that can drift.
 *
 * `has`, when given, is the skin's available-cel predicate: a startup/recovery
 * cel the skin never generated (a partial fighter missing a `tw-*` inbetween) is
 * substituted with `neutral` rather than left dangling, so `resolveClip` — which
 * is all-or-nothing — does not drop the entire clip over one missing tween. The
 * active cel is never substituted; a skin lacking it bails in `deriveAttackClip`
 * to the static/fallback path instead.
 */
export function layoutAttack(shape: AttackShape, t: MoveTiming, has?: (cel: string) => boolean): ClipSpec {
  const avail = (cels: string[]): string[] =>
    has ? cels.map((c) => (has(c) ? c : shape.neutral)) : cels
  const frames: string[] = []
  const durations: number[] = []
  tilePhase(avail(shape.startup), t.startup, shape.neutral, frames, durations)
  frames.push(shape.active)
  durations.push(Math.max(1, t.active))
  tilePhase(avail(shape.recovery), t.recovery, shape.neutral, frames, durations)
  return { frames, durations, loop: false }
}

/**
 * Derive an AttackShape from a static clip spec by naming its contact cel: the
 * cels before it are the startup/windup, the cels after it the recovery. This
 * keeps ONE source of truth for each attack's poses — the very static const the
 * no-moveset card art still falls back to — and adds only the single fact the
 * layout needs that a bare frame list cannot carry: WHICH cel is the contact
 * pose. The authored durations are discarded and re-derived per move from timing.
 */
function shapeFrom(spec: ClipSpec, active: string, neutral: string = STANCE_FRAME): AttackShape {
  const i = spec.frames.indexOf(active)
  if (i < 0) throw new Error(`shapeFrom: '${active}' not in [${spec.frames.join(', ')}]`)
  return { startup: spec.frames.slice(0, i), active, recovery: spec.frames.slice(i + 1), neutral }
}

/**
 * Every attacking clip family, keyed to its contact cel and laid out per move
 * from that move's own startup/active/recovery. LK/MK keep NO windup drawing —
 * a two-cel kick holds the neutral pose through startup and extends only at
 * contact (extended-at-contact beats telegraphing startup); everything else
 * keeps its authored startup/windup and recovery cels. Only the DURATIONS are
 * derived, so the contact cel spans exactly the active window for any archetype
 * — one shared clip with hand-tuned durations cannot, which is how the kick
 * ladder shipped freezing on idle AND how the punches/specials shipped dropping
 * the LAST active frame back onto idle (st.MP active[6..8] but mp-active only
 * covered 3-7; qcf.P active[11..14] but the release cel expired at 13).
 */
const ATTACK_SHAPES = {
  lp: shapeFrom(LP, 'lp-active'),
  mp: shapeFrom(MP, 'mp-active'),
  hp: shapeFrom(HP, 'hp-active'),
  lk: { startup: [], active: 'lk-active', recovery: [], neutral: STANCE_FRAME },
  mk: { startup: [], active: 'mk-active', recovery: [], neutral: STANCE_FRAME },
  hk: shapeFrom(HK, 'hk-active'),
  // Stance-correct crouch/air kick families (Tier C). cr.LK/cr.MK/cr.HK and j.MK
  // previously aliased the STANDING lk/mk/hk shapes — a crouching kick drawn
  // upright, a jumping kick drawn grounded. Each gets a dedicated crouch/air
  // chamber + contact key and settles to a crouch (or falling) neutral, not the
  // standing STANCE_FRAME. A skin that has not yet generated the contact cel
  // bails in deriveAttackClip to the static standing clip, so the roster rolls
  // over per-skin as each atlas gains the cels.
  crlk: { startup: ['crlk-chamber'], active: 'crlk-active', recovery: [], neutral: 'crouch' },
  crmk: { startup: ['crmk-chamber'], active: 'crmk-active', recovery: [], neutral: 'crouch' },
  crhk: { startup: ['crhk-chamber'], active: 'crhk-active', recovery: [], neutral: 'crouch' },
  jmk: { startup: ['jmk-chamber'], active: 'jmk-active', recovery: [], neutral: 'jump-fall' },
  fireball: shapeFrom(FIREBALL, 'special-fireball-release'),
  uppercut: shapeFrom(UPPERCUT, 'special-uppercut'),
  // Bespoke super arc — charge -> release -> recovery, none recycled (the old
  // shapeFrom(SUPER, 'special-uppercut') stitched fireball/uppercut cels into
  // a formless super; visual-critic v12 named it the single worst thing on
  // screen). A skin that has not generated `super-release` bails in
  // deriveAttackClip to the static CLIPS.super (still the recycled SUPER), so
  // the roster rolls over per-skin as each atlas gains the bespoke cels — the
  // same rollover the crouch/air kicks use.
  //
  // CORRECT FOR the two energy-projection supers only: operator's Palm Barrage
  // (super.P) and warden's Ion Storm (super.storm) both DERIVED_ATTACKS-map to
  // `super`. The vanguard grappler's Backbreaker is ALSO id `super.P` but is a
  // command grab, not a projectile — it must route to a separate grab/slam
  // shape (archetype-keyed) with its own cels BEFORE any vanguard skin is
  // generated, or a full-roster gen would draw a grappler blasting a fireball.
  // Until that shape+cels land, vanguard skins have no `super-release` cel and
  // stay on the recycled fallback, so nothing ships wrong in the meantime.
  super: {
    startup: ['super-charge'], active: 'super-release', recovery: ['super-recovery'], neutral: STANCE_FRAME,
    // Un-generated skins derive the OLD recycled arc (fireball-charge → uppercut
    // → fireball-release) at the SAME per-move timing, so committing this bespoke
    // shape is byte-identical for every skin that has not generated `super-release`
    // yet — the roster rolls over one atlas at a time with no silent retiming.
    // (The crouch/air kick families bail to their static CLIPS entry instead;
    // they can, because those manifests were rebuilt WITH the bespoke shape
    // already committed. The super's is authored here, after the WebP repack, and
    // only chesky is regenerated in this batch, so it must reproduce the recycled
    // clip exactly for the other five.)
    fallback: shapeFrom(SUPER, 'special-uppercut'),
  },
} satisfies Record<string, AttackShape>

type AttackShapeKey = keyof typeof ATTACK_SHAPES

/**
 * Sim move-ids whose clip is DERIVED from the move's own timing rather than
 * taken from a fixed CLIPS entry — EVERY attacking move with a dedicated clip,
 * not just the kick ladder. A CPU-landing census put cr.MK at 22.7% of all
 * connecting hits and the strike-specials (qcf.P/charge.P/qcb.K) among the
 * highest-hitstop, most-deliberately-landed moves; a fixed duration table cannot
 * hold every one of them on its contact cel across three archetypes' differing
 * startups AND active lengths, so the layout is derived for all of them. Move-ids
 * not listed here (the generic per-button clips, and vanguard's command specials
 * that have no dedicated clip — art-deficit #7) use the static CLIPS entry.
 */
export const DERIVED_ATTACKS: Record<string, AttackShapeKey> = {
  'st.LP': 'lp', 'cr.LP': 'lp', 'j.LP': 'lp',
  'st.MP': 'mp', 'cr.MP': 'mp', 'f.MP': 'mp',
  'st.HP': 'hp', 'j.HP': 'hp', 'throw.f': 'hp',
  'cr.HP': 'uppercut', 'dp.P': 'uppercut',
  'st.LK': 'lk', 'cr.LK': 'crlk',
  'st.MK': 'mk', 'cr.MK': 'crmk', 'j.MK': 'jmk',
  'st.HK': 'hk', 'cr.HK': 'crhk', 'j.HK': 'hk', 'f.HK': 'hk', 'qcb.K': 'hk',
  'qcf.P': 'fireball', 'charge.P': 'fireball', 'qcf.slow': 'fireball', 'qcf.fast': 'fireball',
  'super.P': 'super', 'super.storm': 'super',
}

/**
 * The timing-derived clip for a move-id, or null when the move-id is not a
 * derived attack (the caller then falls back to the static CLIPS entry). `has`,
 * when given, is the skin's available-cel predicate: if the skin never generated
 * the contact cel itself, bail to the static/fallback path; missing
 * startup/recovery cels degrade to `neutral` inside `layoutAttack`.
 */
export function deriveAttackClip(
  moveId: string,
  t: MoveTiming,
  has?: (cel: string) => boolean,
): ClipSpec | null {
  const key = DERIVED_ATTACKS[moveId]
  if (!key) return null
  const shape: AttackShape = ATTACK_SHAPES[key]
  if (has && !has(shape.active)) {
    // Skin never generated this shape's bespoke contact cel. If the shape
    // declares a recycled fallback whose OWN contact cel this skin DOES have,
    // derive from it with the same timing — the pre-bespoke clip, unchanged — so
    // the roster rolls over per-skin without retiming un-generated skins. Only
    // when the fallback's contact cel is also absent (unplayable card art) do we
    // bail to the static CLIPS entry.
    const fb = shape.fallback
    if (fb && has(fb.active)) return layoutAttack(fb, t, has)
    return null
  }
  return layoutAttack(shape, t, has)
}

export const CLIPS: Record<string, ClipSpec> = {
  // ── Stance-enum clips ────────────────────────────────────────────────────
  // Keyed by the exact names AnimationDriver.clipCandidates() looks up for each
  // FighterState.stance. Getting a key wrong here does not error — the driver
  // silently falls back to `idle`, so the fighter just never plays that stance.
  // In particular `blockstun` resolves to `['block','guard','idle']` and
  // `hitstun` to `['hurt','hit','idle']`, so those clips MUST be named `block`
  // and `hurt`, not after the stance. (An earlier cut named them after the
  // stance and block/hitstun animation silently vanished.)
  idle: clip(
    true,
    ['idle-1', 8],
    ['tw-i1-i2', 4],
    ['idle-2', 7],
    ['tw-i2-i4', 4],
    ['idle-4', 7],
    ['tw-i4-i3a', 3],
    ['tw-i4-i3b', 3],
    ['idle-3', 7],
    ['tw-i3-i1a', 3],
    ['tw-i3-i1b', 3],
  ),
  'walk-fwd': clip(
    true,
    ['walk-fwd-1', 5], ['tw-wf-12', 3], ['walk-fwd-2', 5], ['tw-wf-23', 3],
    ['walk-fwd-3', 5], ['tw-wf-34', 3], ['walk-fwd-4', 5], ['tw-wf-41', 3],
  ),
  'walk-back': clip(
    true,
    ['walk-back-1', 5], ['tw-wb-12', 3], ['walk-back-2', 5], ['tw-wb-23', 3],
    ['walk-back-3', 5], ['tw-wb-34', 3], ['walk-back-4', 5], ['tw-wb-41', 3],
  ),
  // Crouch breathes — players sit in it. Ping-pong crouch<->crouch-2 (subtle,
  // morph-clean).
  crouch: clip(true, ['crouch', 8], ['tw-cr-c2', 4], ['crouch-2', 8], ['tw-cr-c2', 4]),
  // Jump arc keyframes through its phases (hard cuts — morph smears the airborne
  // pose changes): rise -> apex, then apex -> fall -> land absorb.
  'jump-rise': clip(false, ['jump-rise', 5], ['jump-rise-2', 5], ['jump-apex', 8]),
  'jump-fall': clip(false, ['jump-apex', 4], ['jump-fall', 6], ['jump-land', 6]),
  // Dash keyframes coil -> burst -> settle; the coil doubles as the recovery.
  dash: clip(false, ['dash-ready', 3], ['dash', 6], ['dash-ready', 4]),
  backdash: clip(false, ['backdash-ready', 3], ['backdash', 6], ['backdash-ready', 4]),
  attack: clip(false, ['mp-active', 8]),
  // Block absorbs the hit then settles back to guard rather than holding a pose.
  block: clip(true, ['block-absorb', 3], ['tw-ba-bs', 3], ['block-stand', 8]),
  // Hitstun: a snap-back that settles back toward guard, not one frozen recoil.
  hurt: clip(false, ['hit-high', 3], ['tw-hh-hr', 3], ['hit-reel', 4], ['tw-hr-hs', 3], ['hit-settle', 5]),
  // Juggle: a real airborne tumble through the arc — launch, apex, fall.
  juggle: clip(false, ['juggle-launch', 3], ['tw-jl-ja', 3], ['juggle-apex', 4], ['tw-ja-js', 3], ['juggle-spin', 4], ['tw-js-jf', 3], ['juggle-fall', 5]),
  // Knockdown: crash and bounce, then settle flat.
  knockdown: clip(false, ['knockdown-impact', 4], ['tw-ki-kd', 3], ['knockdown', 16]),
  // Wakeup: rise off the floor through to the stance (hard cuts — kneel->stand
  // smears under morph). kneel -> nearly up -> stance.
  wakeup: clip(false, ['wakeup', 6], ['wakeup-rise', 6], ['idle-1', 4]),
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

  // ── Warden (zoner) move-ids ──────────────────────────────────────────────
  // Ids from src/fight/fighters/warden.ts. AnimationDriver resolves a fireball
  // as [moveId, 'attack', 'idle'], so these MUST be the exact move ids or the
  // bolt silently plays the generic `attack` frame instead of a throw. Both
  // bolt speeds share the throw pose; the super gets the fuller cast.
  'qcf.slow': FIREBALL, // Ion Bolt
  'qcf.fast': FIREBALL, // Ion Bolt (Charged)
  'super.storm': SUPER, // Ion Storm
  'throw.f': HP, // Repel Toss — no dedicated grab pose; the heavy lunge reads closest
}

/**
 * Shallow reaction clips for a partially-generated fighter that never got the
 * deep reaction poses (hit-reel, hit-settle, juggle-*, knockdown-impact,
 * wakeup-rise) and so drops the rich CLIPS entry above. Built ONLY from the core
 * poses every fighter generates — hit-high, hit-low, knockdown, ko, wakeup, idle
 * — as HARD CUTS between distinct poses. No `tw-*` inbetween exists for these
 * edges, and that is deliberate: a big pose delta must be a fifth KEY, never a
 * fifth tween (a morph across this much rotation double-images).
 *
 * `buildAssets` uses one of these ONLY when the matching rich clip drops, so a
 * complete fighter keeps its authored 5-/7-key reaction and a partial one plays
 * a real multi-key reel instead of `AnimationDriver` silently resolving the
 * stance to `idle` — the exact defect ("the body registers nothing") that the
 * clipCandidates idle fallback hides. Frames are reused from the fighter's own
 * already-registered atlas cells, so there is no new pose, no re-segmentation
 * and no foot-anchor drift to introduce.
 *
 * No `juggle` here on purpose: the core set has no airborne-hit pose, and faking
 * one from a neutral jump would read as a jump, not a launch. clipCandidates
 * resolves the `juggle` STANCE to `['juggle','hurt','idle']`, so a juggled
 * partial fighter degrades to this `hurt` reel — a real reaction, not a lie.
 */
export const FALLBACK_CLIPS: Record<string, ClipSpec> = {
  // Reduced breathing idle for a shallow skin that never got the deep idle keys
  // (idle-4 and its sway tweens tw-i2-i4 / tw-i4-i3a / tw-i4-i3b). turley shipped
  // with NO idle clip at all: CLIPS.idle references those missing cels, so
  // resolveClip dropped it and the fighter STATUED on frame 0 while the rest of
  // the cast breathed — art-deficit #9, with idle-3 and the idle tweens sitting
  // unreferenced in turley's own atlas. This loop breathes from the cels a
  // shallow skin DOES carry, on the SAME per-key cadence as the full loop
  // (8/4/7 … 7/3/3): neutral -> inhale (idle-1 -> tw-i1-i2 -> idle-2) -> exhale
  // settle (idle-3) -> ease back to neutral (tw-i3-i1a -> tw-i3-i1b) -> loop. The
  // one hard cut the absent idle-4 forces, idle-2 -> idle-3, is a small breath
  // delta that reads clean as a key. Reuses existing cells only, so the patch
  // adds no pose and repacks no atlas. A skin missing even these tweens resolves
  // to null and is caught RED by the idle-presence gate, never silently statued.
  idle: clip(
    true,
    ['idle-1', 8],
    ['tw-i1-i2', 4],
    ['idle-2', 7],
    ['idle-3', 7],
    ['tw-i3-i1a', 3],
    ['tw-i3-i1b', 3],
  ),
  // Snap-back (the impact, held through hitstop) -> double over -> recover to guard.
  hurt: clip(false, ['hit-high', 5], ['hit-low', 3], ['idle-1', 6]),
  // Hit the ground rigid -> limbs settle and crumple. Two distinct grounded poses.
  knockdown: clip(false, ['knockdown', 5], ['ko', 16]),
  // Kneel-and-push-up -> stood in guard. (The core set has no mid-rise pose.)
  wakeup: clip(false, ['wakeup', 8], ['idle-1', 4]),
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
