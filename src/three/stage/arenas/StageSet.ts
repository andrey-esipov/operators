import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { QualityFlags } from '../../core/QualityManager'
import type { StageConfig } from '../StageRegistry'
import {
  StageBuild,
  structureMat,
  glowMat,
  makeScreen,
  trussBeam,
  lightShaft,
  mulberry,
  type ScreenMode,
} from '../StageKit'

/**
 * Per-arena set composition.
 *
 * Every stage is assembled from the shared kit but with a distinct silhouette,
 * palette and animated "life" so the eight arenas feel authored, not recolored.
 * Depth is physical: architecture sits at real z between the far backdrop plate
 * (~z=-30) and the play space (z=0); overhead trusses frame the top; foreground
 * occluders sit in front of the camera to be blurred into bokeh by DOF.
 */

export const SHAFT_ON = (f: QualityFlags) => f.volumetricLight

export type OverheadStyle =
  | 'garage' | 'gantry' | 'plateau' | 'server'
  | 'gold' | 'alarm' | 'atrium' | 'yard'

// -- shared sub-assemblies ---------------------------------------------------

/** Volumetric downlight shafts. `tilt(x)` splays them per-stage so no two
 *  arenas share the identical "converging cone" god-ray signature. */
export function ceilingShafts(
  b: StageBuild, flags: QualityFlags, color: number,
  xs: number[], y: number, z: number, w: number, h: number, intensity: number,
  tilt: (x: number) => number,
) {
  if (!SHAFT_ON(flags)) return
  xs.forEach((x, i) => {
    const shaft = lightShaft(w * 0.42, w, h, color, intensity)
    shaft.position.set(x, y, z)
    shaft.rotation.z = tilt(x)
    b.add(shaft)
    b.onUpdate((t) => {
      const m = shaft.material as THREE.ShaderMaterial
      m.uniforms.uTime.value = t
      m.uniforms.uOpacity.value = intensity * (0.82 + 0.18 * Math.sin(t * 1.1 + i * 1.7))
    })
  })
}

/**
 * Per-stage overhead treatment. Each arena gets a *motivated*, distinct ceiling
 * (timber rafters, launch catwalk, dead soffit, cable trays, gilded coffers,
 * alarm strips, glazed atrium, flood masts) plus its own shaft pattern, so the
 * eight stages never read as one recoloured room.
 */
export function overhead(b: StageBuild, cfg: StageConfig, flags: QualityFlags, style: OverheadStyle) {
  const s = cfg.structure
  switch (style) {
    case 'garage': {
      // exposed timber rafters running front-to-back; the dawn door owns the light
      for (let i = -2; i <= 2; i++) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.52, 20), structureMat({ color: 0x5a3f28, roughness: 0.96, metalness: 0.02 }))
        beam.position.set(i * 3.0, 9.3, -7)
        b.add(beam)
      }
      const ridge = new THREE.Mesh(new THREE.BoxGeometry(15.4, 0.4, 0.4), structureMat({ color: 0x4a3320, roughness: 0.95 }))
      ridge.position.set(0, 9.75, -7)
      b.add(ridge)
      break
    }
    case 'gantry': {
      // launch service catwalk + glowing rail; a pair of cool floods vent light
      const cat = trussBeam(20, 0.6, s); cat.position.set(0, 9.6, -9); b.add(cat)
      const rail = new THREE.Mesh(new THREE.BoxGeometry(20, 0.08, 0.08), glowMat(0x66e6ff, 0.5)); rail.position.set(0, 10.0, -8.7); b.add(rail)
      ceilingShafts(b, flags, 0xbfe8ff, [-3.6, 3.6], 5.2, -9, 1.05, 9.2, cfg.shaftIntensity * 0.26, (x) => -x * 0.02)
      break
    }
    case 'plateau': {
      // a flat dead soffit and a single wan grey shaft — the stall made ceiling
      const soffit = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), structureMat({ color: 0x1a1226, roughness: 0.92 }))
      soffit.rotation.x = Math.PI / 2; soffit.position.set(0, 9.6, -8); b.add(soffit)
      ceilingShafts(b, flags, 0x6a5a8a, [0], 4.6, -8, 1.6, 9.4, cfg.shaftIntensity * 0.16, () => 0)
      break
    }
    case 'server': {
      // cable trays + a dead-even row of PARALLEL vertical downlight shafts
      for (const zt of [-8, -12]) {
        const tray = new THREE.Mesh(new THREE.BoxGeometry(22, 0.2, 0.6), structureMat({ color: s, roughness: 0.5, metalness: 0.7 }))
        tray.position.set(0, 9.4, zt); b.add(tray)
      }
      ceilingShafts(b, flags, 0x59d8ff, [-6, -2, 2, 6], 5.0, -9, 0.68, 9.0, cfg.shaftIntensity * 0.19, () => 0)
      break
    }
    case 'gold': {
      // coffered gold ribs + hanging pendant globes; warm wide shafts
      for (let i = -2; i <= 2; i++) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 16), structureMat({ color: 0x6a4c12, roughness: 0.3, metalness: 0.9, emissive: 0x2a1c04, emissiveIntensity: 0.5 }))
        rib.position.set(i * 3.2, 9.6, -8); b.add(rib)
      }
      for (const px of [-4, 0, 4]) {
        const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 6), structureMat({ color: 0x2a2010, roughness: 1 })); wire.position.set(px, 9.3, -6); b.add(wire)
        const pend = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 12), glowMat(0xffd479, 0.9)); pend.position.set(px, 8.4, -6); b.add(pend)
        const halo = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 12), glowMat(0xffbf5a, 0.22)); halo.position.set(px, 8.4, -6); b.add(halo)
      }
      ceilingShafts(b, flags, 0xffcf6a, [-4.2, 0, 4.2], 5.0, -8, 1.35, 9.0, cfg.shaftIntensity * 0.24, (x) => x * 0.01)
      break
    }
    case 'alarm': {
      // pulsing red strip lights + an exposed conduit; harsh angular red shafts
      for (const zt of [-7, -11]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(20, 0.12, 0.12), glowMat(0xef233c, 0.7)); strip.position.set(0, 9.5, zt); b.add(strip)
        b.onUpdate((t) => { (strip.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.4 * Math.abs(Math.sin(t * 3.0)) })
      }
      const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 20, 8), structureMat({ color: s, roughness: 0.6, metalness: 0.6 })); conduit.rotation.z = Math.PI / 2; conduit.position.set(0, 9.85, -9); b.add(conduit)
      ceilingShafts(b, flags, 0xff3a3a, [-4.6, 4.6], 5.0, -8, 0.9, 9.2, cfg.shaftIntensity * 0.3, (x) => x * 0.05)
      break
    }
    case 'atrium': {
      // glazed skylight coffers — broad bright PARALLEL daylight shafts, grand
      for (let i = -2; i <= 2; i++) {
        const mull = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 16), structureMat({ color: 0x3a4658, roughness: 0.4, metalness: 0.5 }))
        mull.position.set(i * 3.0, 10.2, -8); b.add(mull)
        const glo = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 15), glowMat(0xfff2d0, 0.26)); glo.position.set(i * 3.0 - 1.5, 10.0, -8); b.add(glo)
      }
      ceilingShafts(b, flags, 0xfff0cf, [-5, -1.6, 1.6, 5], 5.4, -8, 1.45, 9.6, cfg.shaftIntensity * 0.28, () => 0)
      break
    }
    case 'yard': {
      // floodlight mast heads throwing cool sodium light, wide and angled
      for (const sign of [-1, 1]) {
        const head = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.8), structureMat({ color: 0x14181c, roughness: 0.6, metalness: 0.6 }))
        head.position.set(sign * 8, 9.6, -6); head.rotation.z = -sign * 0.2; b.add(head)
        for (let k = -1; k <= 1; k++) {
          const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.28, 12), glowMat(0xdfeaff, 0.9)); lamp.position.set(sign * 8 + k * 0.7, 9.28, -5.55); lamp.rotation.x = Math.PI / 2.4; b.add(lamp)
        }
      }
      ceilingShafts(b, flags, 0xbcd0ff, [-7, 7], 5.0, -6.5, 1.5, 9.0, cfg.shaftIntensity * 0.24, (x) => -x * 0.03)
      break
    }
  }
}

/** A wall of stacked animated panels (control-room / trading-floor feel). */
export function screenWall(
  b: StageBuild,
  cols: number,
  rows: number,
  cellW: number,
  cellH: number,
  center: THREE.Vector3,
  modes: ScreenMode[],
  hue: number,
  hue2: number,
  seedBase = 1,
) {
  const gap = 0.12
  const totalW = cols * cellW + (cols - 1) * gap
  const totalH = rows * cellH + (rows - 1) * gap
  const rnd = mulberry(seedBase * 97 + 3)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const mode = modes[(r * cols + c) % modes.length]
      const { mesh, mat } = makeScreen(cellW, cellH, mode, hue, hue2, 0.9 + rnd() * 0.5, seedBase + r * 13 + c * 7)
      mesh.position.set(
        center.x - totalW / 2 + cellW / 2 + c * (cellW + gap),
        center.y + totalH / 2 - cellH / 2 - r * (cellH + gap),
        center.z,
      )
      b.add(mesh)
      // bezel
      const bez = new THREE.Mesh(
        new THREE.PlaneGeometry(cellW + gap * 0.9, cellH + gap * 0.9),
        structureMat({ color: 0x05070a, roughness: 0.6, metalness: 0.4 }),
      )
      bez.position.copy(mesh.position).add(new THREE.Vector3(0, 0, -0.03))
      b.add(bez)
      b.onUpdate((t) => (mat.uniforms.uTime.value = t))
    }
  }
}

/** Foreground occluders — the third depth plane a fighting-game frame needs.
 *
 *  The camera sits at z=+11.4 with a 32° FOV, so the visible frame at a given
 *  depth is narrow: at z=4.8 only ~±3.4 of x reads. Earlier framing lived at
 *  x=±6..7 / z=7.2 — entirely OUTSIDE the frustum, which is why the foreground
 *  was dead. These sit at the true in-frame edges (x≈±3.2, z≈4.8) and in the
 *  bottom corners (z≈6.3, heavy DOF bokeh), themed per stage, dark but rim-lit
 *  with a thin emissive accent so they frame without covering the fighters. */
export function foreground(b: StageBuild, style: OverheadStyle, cfg: StageConfig) {
  // Route every occluder built below into the camera-pinned frame group. The
  // authoring is left exactly as drawn against the neutral pose; the stage
  // subsystem re-anchors the whole group to the live camera each frame.
  b.beginForeground()
  try {
  // Occluder albedo. These were 0.72/0.52 and read as "featureless black
  // silhouettes" to three independent blind critics. A five-arm blind ranking
  // (ctrl / hidden / brighter / smaller / brighter+smaller, labels shuffled, key
  // sealed outside the repo) was scored by three critics on three model
  // families; the two whose reports survived verification ranked the BRIGHTER
  // arm first, unanimously, on all four stages. The ratio between the two tones
  // is preserved so the tonal separation the styles below rely on is unchanged.
  //
  // Why brightness is a real lever here and texture is NOT: these surfaces are
  // already textured (structureMat -> the 'paintedMetal' bakery preset), and
  // measured local gradient energy inside the eroded occluder interior is
  // 0.69-1.16x the painted scene's. The detail was always present -- albedo is
  // MULTIPLIED by it, so at a near-black base the variation spans ~2 of 255
  // levels and is invisible while remaining measurable. Same mechanism the
  // fighter shadow-lift work hit: an albedo-multiplied signal vanishes exactly
  // where the surface is darkest. Adding texture here would have bought nothing.
  const dark = new THREE.Color(cfg.structure).multiplyScalar(1.05).getHex()
  const darker = new THREE.Color(cfg.structure).multiplyScalar(0.78).getHex()
  const Z = 4.8   // edge-pylon depth (in-frame, moderate bokeh)
  const ZC = 6.4  // corner-mass depth (closer, heavy bokeh)

  const box = (w: number, h: number, d: number, x: number, y: number, z: number, col: number, rz = 0, ry = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), structureMat({ color: col, roughness: 0.82, metalness: 0.28 }))
    m.position.set(x, y, z); m.rotation.z = rz; m.rotation.y = ry
    b.add(m); return m
  }
  // thin self-lit accent strip (the rim-light read that says "authored framing")
  const accent = (w: number, h: number, x: number, y: number, z: number, color: number, op = 0.7) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glowMat(color, op))
    m.position.set(x, y, z + 0.06); b.add(m); return m
  }
  const cyl = (r: number, h: number, x: number, y: number, z: number, col: number, rz = 0) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), structureMat({ color: col, roughness: 0.7, metalness: 0.5 }))
    m.position.set(x, y, z); m.rotation.z = rz; b.add(m); return m
  }

  switch (style) {
    case 'gantry': {
      // launch-deck safety railing + a heavy tower leg framing left, a slim
      // umbilical strut right; warning-striped handrail across the lower lip.
      box(0.62, 4.6, 0.62, -3.25, 1.9, Z, darker)
      accent(0.1, 4.2, -2.98, 1.9, Z, cfg.trim, 0.6)
      for (let i = 0; i < 3; i++) box(0.7, 0.16, 0.6, -3.25, 0.4 + i * 1.5, Z, dark)
      box(0.34, 3.8, 0.34, 3.3, 1.5, Z, darker)
      accent(0.08, 3.4, 3.08, 1.5, Z, cfg.trim, 0.55)
      // DELETED: a 9.5-wide "warning-striped handrail" (y=0.35), three posts
      // (y=-0.1) and a cyan accent strip, all at `ZC`. They drew NOTHING.
      //
      // The foreground rides a camera-pinned frame whose matrix is
      // `cam.matrixWorld * neutralView` (StageSubsystem.updateFrame), so an
      // occluder's VIEW-space position is constant and its NDC position is
      // fixed by the projection alone. Vertical NDC is also aspect-independent
      // (fov is vertical). Measured: the handrail projects to NDC y = -1.26 and
      // the posts to -1.91..-1.20, against a frame that ends at -1.0. So this
      // assembly was off the bottom of the screen on every device, at every
      // aspect ratio, for its whole life -- unconditionally, not situationally.
      //
      // I nearly "fixed" this instead of deleting it. A blind critic said a
      // foreground element cuts across the fighters' legs HERE, and this bar
      // was the widest thing at the nearest depth, so it looked like the
      // culprit. It is not: I was reading world-space geometry and inferring
      // what renders. Measuring each mesh's clipped on-screen box instead puts
      // this stage's widest VISIBLE foreground element at 9.6% of frame width,
      // hugging x <= -0.81 -- nothing here crosses a fighter at all. The critic
      // was right about `ipo-prep` (the one genuine 100%-width case) and wrong
      // about this stage. Weight a blind ranking; verify its prose.
      break
    }
    case 'garage': {
      // a hanging chain + shelving upright left, a stacked-crate corner mass right
      box(0.5, 5.0, 0.5, -3.2, 2.0, Z, darker)
      for (let i = 0; i < 5; i++) box(0.6, 0.14, 0.5, -3.2, 0.4 + i * 1.0, Z, dark)
      cyl(0.05, 3.0, 3.2, 3.0, Z, 0x0a0a0a)
      box(1.9, 1.7, 1.5, 2.7, 0.5, ZC, dark, 0.04, 0.2)
      box(1.5, 1.3, 1.3, -2.5, 0.35, ZC, darker, -0.03, -0.15)
      accent(1.4, 0.05, 2.7, 1.36, ZC, 0xffb968, 0.4)
      break
    }
    case 'server': {
      // rack uprights both edges with cable bundles + a low blade-server mass.
      //
      // This style measured the WORST occluder coverage of the four stages
      // sampled -- 33% of the frame, against 13% on the lightest -- from two
      // unbroken 0.55x5.2 slabs plus a 2.4-wide corner mass. Racks are the one
      // subject where the fix is also the truth: a real rack is a stack of
      // discrete units with gaps, not a monolith. Segmenting buys the broken
      // profile the critics asked for AND drops coverage, and the cyan unit
      // accents (which all three reports singled out as the part that reads as
      // authored) now sit in the gaps where they belong.
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          box(0.44, 1.02, 0.56, sx * 3.52, 0.62 + i * 1.24, Z, darker)
        }
        accent(0.08, 4.4, sx * 3.27, 2.1, Z, cfg.trim, 0.5)
        for (let i = 0; i < 4; i++) accent(0.4, 0.05, sx * 3.52, 0.6 + i * 1.24, Z, 0x59d8ff, 0.4)
      }
      box(1.7, 1.05, 1.4, 3.0, 0.34, ZC, dark, 0, 0.12)
      break
    }
    case 'gold': {
      // fluted stanchions at both edges + short velvet ropes draping into the
      // bottom CORNERS (never across the centre, so nothing crosses the
      // fighters) + gilded corner plinths on both sides.
      cyl(0.22, 4.4, -3.25, 2.0, Z, 0x2a2010)
      cyl(0.22, 4.4, 3.25, 2.0, Z, 0x2a2010)
      accent(0.12, 3.8, -3.02, 2.0, Z, cfg.trim, 0.7)
      accent(0.12, 3.8, 3.02, 2.0, Z, cfg.trim, 0.7)
      const ropeMat = structureMat({ color: 0x4a1414, roughness: 0.9, metalness: 0.1 })
      const ropeL = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-3.25, 2.5, Z), new THREE.Vector3(-2.5, 1.0, ZC - 0.4), new THREE.Vector3(-1.6, 1.7, ZC)]), 20, 0.075, 8, false), ropeMat)
      b.add(ropeL)
      const ropeR = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(3.25, 2.5, Z), new THREE.Vector3(2.5, 1.0, ZC - 0.4), new THREE.Vector3(1.6, 1.7, ZC)]), 20, 0.075, 8, false), ropeMat)
      b.add(ropeR)
      box(1.6, 1.2, 1.4, 2.7, 0.35, ZC, darker)
      box(1.6, 1.2, 1.4, -2.7, 0.35, ZC, darker)
      accent(1.5, 0.06, 2.7, 1.02, ZC, cfg.trim, 0.6)
      accent(1.5, 0.06, -2.7, 1.02, ZC, cfg.trim, 0.6)
      break
    }
    case 'alarm': {
      // angular command-console wings low at both edges + a conduit riser
      box(3.0, 1.5, 0.9, -2.9, 0.7, ZC, dark, 0.08, 0.22)
      box(3.0, 1.5, 0.9, 2.9, 0.7, ZC, dark, -0.08, -0.22)
      accent(2.6, 0.06, -2.9, 1.45, ZC, 0xef233c, 0.7)
      accent(2.6, 0.06, 2.9, 1.45, ZC, 0xef233c, 0.7)
      cyl(0.13, 5.0, -3.3, 2.2, Z, darker)
      accent(0.09, 4.2, -3.06, 2.2, Z, 0xef233c, 0.6)
      break
    }
    case 'atrium': {
      // A grand marble balustrade framing the lower edge -- now as two runs with
      // an open centre, at the mid foreground depth.
      //
      // This style was ranked WORST of eight by two blind critics on different
      // model families, independently, both naming the same element: "a massive
      // horizontal black slab covering the ground plane" / "a near-black apron
      // spanning the bottom ~25-30%, reading as a dead bar, not a floor".
      //
      // Measured cause. A per-band luminance profile over all eight stages shows
      // every arena dipping in its bottom 10% (that is the floor, and it is
      // correct). `ipo-prep` is the only one that also collapses in the band
      // ABOVE it: 32.5 mean at 80-90% of frame height, against 61.8-101.1 for
      // the other seven. The 70-80% -> 80-90% step is a 57% cliff.
      //
      // The discriminator, measured in SCREEN space by projecting every
      // foreground mesh and clipping it to the frame: this stage's balustrade
      // rail spanned x[-1, 1] -- 100% of frame width -- at y[-0.73, -0.47],
      // straddling the ground line the fighters stand on (y = -0.55). It was
      // the ONLY full-width visible foreground element in the game. Next widest
      // anywhere is 38% (plateau, up in the sky corner), then 25.5% (crisis,
      // two corner masses with the centre open, which both critics passed as
      // "frames, doesn't maim"). After this fix: 16.9% per side with x in
      // (-0.66, 0.66) clear, i.e. below the known-good case.
      //
      // Do NOT re-derive this from world-space widths. I did that first and it
      // is wrong: it ranked `gantry`'s 9.5-wide handrail as the worst element
      // in the game, when that bar projects to NDC y = -1.26 and has never been
      // on screen at all. Same trap here -- the sub-floor bar this case used to
      // carry at y=-0.25 lands at -1.65, also invisible. Only the clipped
      // on-screen box tells you what a player sees.
      //
      // Why the existing span gate stayed green, which is the part worth
      // recording: `measureForegroundSpan` scores an occluder's VERTICAL run
      // down a body. A horizontal bar spans almost nothing vertically -- this
      // one covered the body's lowest ~8% of NDC and scored 8.93% against a
      // 40% ceiling, a comfortable pass, while two blind critics ranked it the
      // single worst element on screen. The new foot-band metric reads the same
      // geometry at 100%. Two gates, one subsystem, opposite verdicts: a gate
      // built for one defect SHAPE is silent on another shape. Do not widen
      // SPAN_CEILING -- the span metric is right about its own question.
      // Grounding is the one thing a 2D fighter cannot fake.
      //
      // `alarm` proves the safe shape -- two wings with the centre open read as
      // depth, and both critics let it pass despite carrying MORE foreground
      // mass than stages they criticised. The open centre, not the total mass,
      // is what discriminates. So the fix opens the centre rather than dimming
      // or shrinking the art.
      //
      // The runs stop at |x| = 1.8, not at the fighters' own x. Foreground
      // pinned at `ZC` sits 5.0 units from the neutral camera against the
      // fighters' 9.85, so it projects ~1.97x wider: an element at world 1.8
      // lands where a BODY at 3.54 would, just outboard of the body's 3.1 edge.
      // Using the fighters' own coordinates here would leave the rail sitting
      // on them -- an earlier revision of this fix moved the balustrade one
      // depth back "so it reads as architecture instead of a smear", which
      // pulled it INBOARD in screen space and drove `spanP1/spanP2` from
      // 8.93/8.93 to 14.29/25. Measured, reverted. Depth is not a free knob
      // here: it is a magnification.
      for (const x of [-3.3, -2.5, -1.7, 1.7, 2.5, 3.3]) cyl(0.12, 1.7, x, 0.5, ZC, dark)
      for (const sx of [-1, 1]) {
        box(2.4, 0.26, 0.5, sx * 3.0, 1.35, ZC, darker)
        accent(2.2, 0.05, sx * 3.0, 1.48, ZC, cfg.trim, 0.5)
      }
      break
    }
    case 'yard': {
      // Chain-link fence posts + a dock bollard corner mass.
      //
      // The posts were three identical 5.0-tall cylinders at x = -3.3/-2.7/-2.1
      // while P1 stands at x = -2.55. The innermost ran the FULL height of his
      // body -- 56 of 56 rows -- and the 1:1 frame shows a black pole straight
      // down Chesky's arm and torso. Measured vertical span was 100% where
      // every other stage on the roster tops out at 17.9%.
      //
      // The defect is SHAPE, not amount. `ipo-prep` (8.93%) and `distribution`
      // (10.71%) cover almost the same AREA of the body box and read nothing
      // alike, because an element running the length of the body reads as the
      // character being cut in half. So the fix moves the run off the fighter
      // lane rather than shrinking it.
      //
      // CORRECTION, and it cost a cycle to learn: this comment used to finish
      // that sentence with "...while a foreground element crossing horizontally
      // near the floor reads as depth", stated as settled doctrine. That half
      // is FALSE in the full-width case, and `ipo-prep` was the counter-example
      // sitting three cases above -- a horizontal bar near the floor spanning
      // 100% of frame width, which two blind critics on different model
      // families independently ranked the worst element in the game. Horizontal
      // is safe only when the CENTRE IS OPEN over the fight lane; a full-width
      // horizontal bar severs the ground contact instead, which is worse than
      // the vertical case this stage fixes, not better. Ground contact and body
      // occlusion are separate axes with separate gates.
      //
      // Heights are also staggered, for the reason the `plateau` monolith was
      // segmented: three identical axis-aligned bars have no profile a viewer
      // can name, so the eye files them as a hole punched in the frame rather
      // than as built structure.
      for (const [x, h, y] of [[-4.15, 5.0, 2.2], [-3.55, 4.3, 1.85], [-2.95, 3.5, 1.45]] as const) {
        cyl(0.08, h, x, y, Z, darker)
      }
      const mesh = structureMat({ color: darker, roughness: 0.8, metalness: 0.4 })
      for (let i = 0; i < 4; i++) { const w = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.03, 0.03), mesh); w.position.set(-3.55, 0.5 + i * 0.95, Z); b.add(w) }
      accent(0.07, 3.2, -4.05, 2.1, Z, cfg.trim, 0.45)
      cyl(0.4, 1.4, 3.0, 0.5, ZC, dark)
      box(1.0, 0.2, 1.0, 3.0, 1.2, ZC, darker)
      break
    }
    case 'plateau': {
      // a stalled monolith edge left + a drooping banner cable kept high on the
      // RIGHT so it frames the top corner without crossing the fighter's head.
      //
      // The monolith was one unbroken 0.9x5.4 slab at x=-3.3. Three blind
      // critics independently called the foreground "untextured box primitives"
      // and "a masking layer rather than a physical object" -- but measurement
      // says the surfaces DO carry scene-parity detail, so the read was never
      // about texture. What they were describing is the silhouette: a solid,
      // axis-aligned rectangle has no profile a viewer can name, so the eye
      // files it as a hole punched in the frame. Segmenting the tower into
      // offset blocks with gaps gives it an outline that reads as built
      // structure, and pushing it out to -3.6 pulls it off the fighter lane.
      for (const [dy, w, dx] of [[0.0, 0.62, 0.0], [1.85, 0.78, 0.09], [3.6, 0.5, -0.07]] as const) {
        box(w, 1.55, 0.72, -3.6 + dx, 0.75 + dy, Z, darker)
      }
      accent(0.09, 4.4, -3.24, 2.2, Z, cfg.trim, 0.5)
      const cable = structureMat({ color: darker, roughness: 0.9, metalness: 0.1 })
      const droop = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.8, 4.4, Z), new THREE.Vector3(2.4, 3.5, Z + 0.2), new THREE.Vector3(3.5, 4.2, Z)]), 20, 0.06, 6, false), cable)
      b.add(droop)
      box(1.25, 0.85, 1.3, 3.15, 0.28, ZC, dark, 0.03)
      break
    }
  }
  } finally {
    b.endForeground()
  }
}

/** A glowing polyline chart drawn as emissive segments + vertex nodes on the
 * back wall — a literal line graph. `pts` are normalised [0..1] coordinates. */
export function polyChart(
  b: StageBuild,
  pts: [number, number][],
  x0: number, x1: number, y0: number, y1: number, z: number,
  color: number, thickness = 0.16,
) {
  const P = pts.map(([px, py]) => new THREE.Vector3(x0 + (x1 - x0) * px, y0 + (y1 - y0) * py, z))
  const lineMat = glowMat(color, 0.95)
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], c = P[i + 1]
    const len = a.distanceTo(c)
    const seg = new THREE.Mesh(new THREE.BoxGeometry(len, thickness, thickness * 0.7), lineMat)
    seg.position.copy(a).lerp(c, 0.5)
    seg.rotation.z = Math.atan2(c.y - a.y, c.x - a.x)
    b.add(seg)
  }
  // vertex nodes brighten toward the flat tail to emphasise the stall
  for (let i = 0; i < P.length; i++) {
    const node = new THREE.Mesh(
      new THREE.SphereGeometry(thickness * 1.5, 10, 8),
      glowMat(color, 0.6 + 0.4 * (i / (P.length - 1))),
    )
    node.position.copy(P[i])
    b.add(node)
  }
  return P
}

// -- individual stages -------------------------------------------------------

export function shippingContainer(color: number, stencil: number): THREE.Group {
  const g = new THREE.Group()
  const w = 3.2, h = 1.4, d = 1.6
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), structureMat({ color, roughness: 0.82, metalness: 0.28 }))
  body.castShadow = true; body.receiveShadow = true
  g.add(body)
  const dark = new THREE.Color(color).multiplyScalar(0.6).getHex()
  const light = new THREE.Color(color).multiplyScalar(1.25).getHex()
  // vertical corrugation ribs on the two long (±z) faces
  const ribMat = structureMat({ color: dark, roughness: 0.85, metalness: 0.3 })
  for (let i = 0; i < 13; i++) {
    const rx = -w / 2 + 0.18 + i * ((w - 0.36) / 12)
    for (const fz of [d / 2 + 0.015, -d / 2 - 0.015]) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.07, h - 0.16, 0.03), ribMat)
      rib.position.set(rx, 0, fz)
      g.add(rib)
    }
  }
  // top & bottom rails + corner posts
  const railMat = structureMat({ color: light, roughness: 0.6, metalness: 0.4 })
  for (const ry of [h / 2 - 0.06, -h / 2 + 0.06]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, 0.12, d + 0.03), railMat)
    rail.position.set(0, ry, 0)
    g.add(rail)
  }
  // door seam down the middle of one end + a painted stencil block
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.05, h - 0.12, 0.02), ribMat)
  seam.position.set(0, 0, d / 2 + 0.02)
  g.add(seam)
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.32), glowMat(stencil, 0.5))
  badge.position.set(-w / 2 + 0.7, 0.15, d / 2 + 0.03)
  g.add(badge)
  return g
}

// ---------------------------------------------------------------------------
// Instanced container field.
//
// A single shippingContainer() is a Group of ~31 meshes (body + 26 corrugation
// ribs + 2 rails + seam + badge). A yard of ~20 of them minted ~650 meshes and,
// doubled by the planar-reflection pass, ~1600 draw calls — the whole reason
// `distribution` blew its budget. containerField() collapses the entire static
// field into TWO instanced draws: one InstancedMesh for the merged container
// shell (body+ribs+rails+seam baked into one geometry, with the per-part
// dark/light shading carried as a grayscale vertex-colour multiplier so a single
// PBR material still reads corrugated), and one for the additive stencil badges.
// Per-instance colour supplies each container's paint via `instanceColor`, which
// the shader multiplies against the vertex-colour part mask — so ribs still read
// 0.6× and rails 1.25× of the body paint, exactly as the per-mesh version did.
// ---------------------------------------------------------------------------

export interface ContainerSpec {
  x: number; y: number; z: number; ry: number; color: number; stencil: number
}

const _CONT_W = 3.2, _CONT_H = 1.4, _CONT_D = 1.6
const _CONT_UP = new THREE.Vector3(0, 1, 0)
// paintedMetal bakery mean-luma compensation (matches structureMat's internal
// brightness comp) so instanced paint lands at the same value as the per-mesh
// containers did before instancing.
const _CONT_COMP = Math.min(2.6, Math.max(1, 0.66 / 0.26))

function buildContainerGeo(): THREE.BufferGeometry {
  const w = _CONT_W, h = _CONT_H, d = _CONT_D
  const parts: THREE.BufferGeometry[] = []
  const push = (geo: THREE.BufferGeometry, mul: number) => {
    const n = geo.attributes.position.count
    const col = new Float32Array(n * 3)
    col.fill(mul)
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    parts.push(geo)
  }
  push(new THREE.BoxGeometry(w, h, d), 1.0)
  for (let i = 0; i < 13; i++) {
    const rx = -w / 2 + 0.18 + i * ((w - 0.36) / 12)
    for (const fz of [d / 2 + 0.015, -d / 2 - 0.015]) {
      const rib = new THREE.BoxGeometry(0.07, h - 0.16, 0.03)
      rib.translate(rx, 0, fz)
      push(rib, 0.6)
    }
  }
  for (const ry of [h / 2 - 0.06, -h / 2 + 0.06]) {
    const rail = new THREE.BoxGeometry(w + 0.03, 0.12, d + 0.03)
    rail.translate(0, ry, 0)
    push(rail, 1.25)
  }
  const seam = new THREE.BoxGeometry(0.05, h - 0.12, 0.02)
  seam.translate(0, 0, d / 2 + 0.02)
  push(seam, 0.6)
  const merged = mergeGeometries(parts, false)
  if (!merged) throw new Error('containerField: geometry merge failed')
  return merged
}

/** Render a static field of shipping containers as two instanced draw calls. */
export function containerField(b: StageBuild, specs: ContainerSpec[]): void {
  if (specs.length === 0) return
  const geo = buildContainerGeo()
  const mat = structureMat({ color: 0xffffff, roughness: 0.82, metalness: 0.28 }).clone()
  mat.vertexColors = true
  const bodies = new THREE.InstancedMesh(geo, mat, specs.length)
  bodies.castShadow = true
  bodies.receiveShadow = true

  const badgeGeo = new THREE.PlaneGeometry(0.7, 0.32)
  const badgeMat = glowMat(0xffffff, 0.5)
  const badges = new THREE.InstancedMesh(badgeGeo, badgeMat, specs.length)

  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3(1, 1, 1)
  const off = new THREE.Vector3()
  const paint = new THREE.Color()
  const ink = new THREE.Color()

  specs.forEach((s, i) => {
    q.setFromAxisAngle(_CONT_UP, s.ry)
    pos.set(s.x, s.y, s.z)
    m4.compose(pos, q, scl)
    bodies.setMatrixAt(i, m4)
    paint.setHex(s.color).multiplyScalar(_CONT_COMP)
    paint.r = Math.min(1, paint.r); paint.g = Math.min(1, paint.g); paint.b = Math.min(1, paint.b)
    bodies.setColorAt(i, paint)
    off.set(-_CONT_W / 2 + 0.7, 0.15, _CONT_D / 2 + 0.03).applyQuaternion(q).add(pos)
    m4.compose(off, q, scl)
    badges.setMatrixAt(i, m4)
    badges.setColorAt(i, ink.setHex(s.stencil))
  })
  bodies.instanceMatrix.needsUpdate = true
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true
  badges.instanceMatrix.needsUpdate = true
  if (badges.instanceColor) badges.instanceColor.needsUpdate = true

  b.add(bodies)
  b.add(badges)
}
