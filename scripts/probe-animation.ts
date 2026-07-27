/**
 * De-risk probe for the animation pipeline.
 *
 * Answers the one question that decides whether a real-time 2D fighter is
 * buildable here: can gpt-image-2 turn a single stance sprite into a set of
 * frames that (a) stay the same character and (b) register to a stable ground
 * origin so they animate instead of swim?
 *
 * Generates a 5-frame light-punch sequence for one fighter, segments and
 * registers every frame, then writes a contact sheet, an animated GIF, and a
 * drift report. Cheap enough to run before committing to ~1000 generations.
 *
 *   npx tsx scripts/probe-animation.ts chesky
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { editPose, removeFlatBackground, findAnchor, registerFrame, mapLimit } from './lib/sprite-pipeline'

const FIGHTER = process.argv[2] || 'chesky'
const OUT = path.resolve(process.cwd(), '.sprite-probe', FIGHTER)

/**
 * A real fighting-game attack is startup → active → recovery, and the frames
 * have to read as one continuous motion. `heightRatio` carries deliberate
 * posture changes through registration so a lunge stays lower than a stance.
 */
const FRAMES = [
  {
    name: '1-startup',
    heightRatio: 0.99,
    pose:
      'the very first frame of winding up a punch — rear fist pulled back to the hip, ' +
      'shoulders coiled and rotated slightly away from the target, weight shifted onto the back foot, ' +
      'front arm still guarding, knees bent. The body is loaded like a spring, nothing extended yet.',
  },
  {
    name: '2-active',
    heightRatio: 0.98,
    pose:
      'the peak contact frame of a straight punch — lead arm fully extended horizontally forward at ' +
      'shoulder height, fist clenched at maximum reach, shoulders squared and driven forward, hips rotated ' +
      'into the strike, back leg straight and braced, front knee bent taking the weight.',
  },
  {
    name: '3-recovery',
    heightRatio: 0.99,
    pose:
      'the recovery frame just after a punch lands — the punching arm is halfway retracted back toward the ' +
      'body with the elbow bending, torso beginning to rotate back to neutral, weight settling between both feet.',
  },
  {
    name: '4-walk-fwd',
    heightRatio: 1.0,
    pose:
      'mid stride walking forward in a fighting guard — back leg pushing off with heel raised, front leg ' +
      'stepping forward with the foot about to plant, both fists held up in guard, torso upright and centred.',
  },
  {
    name: '5-crouch',
    heightRatio: 0.72,
    pose:
      'crouching low in a defensive block — knees deeply bent so the whole body is much lower to the ground, ' +
      'thighs near horizontal, both forearms raised tight in front of the face and chest to guard, chin tucked.',
  },
]

const PROMPT = (pose: string) => `Redraw the EXACT SAME CHARACTER from the reference image in a new body pose.

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

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const stancePath = path.resolve(process.cwd(), 'public/sprites', FIGHTER, 'stance.png')
  if (!fs.existsSync(stancePath)) throw new Error(`no stance sprite for ${FIGHTER}`)
  const stance = fs.readFileSync(stancePath)

  console.log(`\n=== animation probe: ${FIGHTER} ===`)

  // Generate off the same reference every time so identity drift cannot
  // compound frame-to-frame. Concurrency 2 — the endpoint rate-limits hard.
  const results = await mapLimit(FRAMES, 2, async (f) => {
    try {
      const raw = await editPose(stance, PROMPT(f.pose), { label: f.name })
      fs.writeFileSync(path.join(OUT, `raw-${f.name}.png`), raw)
      console.log(`  generated ${f.name}`)
      return { ...f, raw: raw as Buffer | null }
    } catch (e) {
      console.log(`  FAILED ${f.name}: ${(e as Error).message.slice(0, 100)}`)
      return { ...f, raw: null as Buffer | null }
    }
  })

  // Include the untouched stance as frame 0 so drift is measured against the
  // actual reference, not against another generation.
  const all = [{ name: '0-stance', heightRatio: 1, raw: stance as Buffer | null }, ...results]

  const CANVAS = 512
  const TARGET_H = 380
  const ORIGIN_X = 256
  const ORIGIN_Y = 470

  const registered: { name: string; buf: Buffer }[] = []
  console.log('\n--- segmentation + registration ---')
  for (const f of all) {
    if (!f.raw) continue
    const cut = await removeFlatBackground(f.raw)
    const a = await findAnchor(cut)
    const coverage = ((a.width * a.height) / (1024 * 1024)) * 100
    console.log(
      `  ${f.name.padEnd(12)} bbox ${String(a.width).padStart(4)}x${String(a.height).padStart(4)}` +
      `  footX ${a.footX.toFixed(0).padStart(4)}  fill ${coverage.toFixed(1)}%`,
    )
    const reg = await registerFrame(cut, {
      canvasW: CANVAS, canvasH: CANVAS,
      targetHeight: TARGET_H, originX: ORIGIN_X, originY: ORIGIN_Y,
      heightRatio: f.heightRatio,
    })
    fs.writeFileSync(path.join(OUT, `reg-${f.name}.png`), reg)
    registered.push({ name: f.name, buf: reg })
  }

  // Drift report: after registration the feet should sit on the same origin
  // every frame. Large residuals mean the sequence will visibly swim.
  console.log('\n--- post-registration drift (should be ~0) ---')
  for (const r of registered) {
    const a = await findAnchor(r.buf)
    console.log(
      `  ${r.name.padEnd(12)} footX ${(a.footX - ORIGIN_X).toFixed(1).padStart(6)}px` +
      `  bottom ${(a.bottom - ORIGIN_Y).toFixed(1).padStart(6)}px`,
    )
  }

  // Contact sheet on a dark field so the alpha cut is visible.
  const sheet = await sharp({
    create: {
      width: CANVAS * registered.length, height: CANVAS, channels: 4,
      background: { r: 24, g: 26, b: 34, alpha: 1 },
    },
  })
    .composite(registered.map((r, i) => ({ input: r.buf, left: i * CANVAS, top: 0 })))
    .png()
    .toBuffer()
  fs.writeFileSync(path.join(OUT, 'contact-sheet.png'), sheet)

  console.log(`\nwrote ${registered.length} registered frames -> ${OUT}`)
  console.log(`contact sheet: ${path.join(OUT, 'contact-sheet.png')}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
