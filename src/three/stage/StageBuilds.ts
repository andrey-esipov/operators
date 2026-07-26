import * as THREE from 'three'
import type { QualityFlags } from '../core/QualityManager'
import type { ScenarioId } from '../../types'
import type { StageConfig } from './StageRegistry'
import {
  StageBuild,
  structureMat,
  glowMat,
  makeScreen,
  radialGlow,
  trussBeam,
  spotCan,
  lightShaft,
  crowdBand,
  fgBar,
  mulberry,
  type ScreenMode,
} from './StageKit'

/**
 * Per-arena set composition.
 *
 * Every stage is assembled from the shared kit but with a distinct silhouette,
 * palette and animated "life" so the eight arenas feel authored, not recolored.
 * Depth is physical: architecture sits at real z between the far backdrop plate
 * (~z=-30) and the play space (z=0); overhead trusses frame the top; foreground
 * occluders sit in front of the camera to be blurred into bokeh by DOF.
 */

const SHAFT_ON = (f: QualityFlags) => f.volumetricLight

// -- shared sub-assemblies ---------------------------------------------------

/** Overhead lighting truss with hung spot-cans and volumetric shafts. */
function overheadRig(b: StageBuild, cfg: StageConfig, flags: QualityFlags, shaftColor: number) {
  const truss = trussBeam(28, 0.7, cfg.structure)
  truss.position.set(0, 9.4, -6)
  b.add(truss)
  const truss2 = trussBeam(18, 0.55, cfg.structure)
  truss2.rotation.y = Math.PI / 2
  truss2.position.set(-9, 9.0, -6)
  b.add(truss2)
  const truss3 = trussBeam(18, 0.55, cfg.structure)
  truss3.rotation.y = Math.PI / 2
  truss3.position.set(9, 9.0, -6)
  b.add(truss3)

  const cans: [number, number][] = [[-6, -4], [-2, -6], [2, -6], [6, -4], [0, -8]]
  for (let i = 0; i < cans.length; i++) {
    const [x, z] = cans[i]
    const can = spotCan(shaftColor, 0.6)
    can.position.set(x, 9.0, z)
    can.rotation.x = 0.25
    b.add(can)
    // Only a subset of cans throw a visible volumetric shaft, at varied width,
    // so they read as scattered god-rays rather than a solid light curtain.
    if (SHAFT_ON(flags) && (i === 0 || i === 3 || i === 4)) {
      const wide = i === 4 ? 1.35 : 1.0
      const shaft = lightShaft(0.5 * wide, 3.0 * wide, 9.4, shaftColor, cfg.shaftIntensity * 0.32)
      shaft.position.set(x * 0.72, 4.3, z + 1.4)
      shaft.rotation.z = (i - 2) * 0.03
      b.add(shaft)
      b.onUpdate((t) => {
        const m = shaft.material as THREE.ShaderMaterial
        m.uniforms.uTime.value = t
        m.uniforms.uOpacity.value = cfg.shaftIntensity * (0.3 + 0.06 * Math.sin(t * 1.1 + i * 1.7))
      })
    }
  }
}

/** A wall of stacked animated panels (control-room / trading-floor feel). */
function screenWall(
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

/** Tall structural pillars flanking the play space to frame the composition. */
function flankPillars(b: StageBuild, cfg: StageConfig, x: number, z: number, trimColor: number) {
  for (const sign of [-1, 1]) {
    const col = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 14, 1.5),
      structureMat({ color: cfg.structure, roughness: 0.7, metalness: 0.5 }),
    )
    col.position.set(sign * x, 6, z)
    col.castShadow = true
    col.receiveShadow = true
    b.add(col)
    // glowing edge strip
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 12, 0.14), glowMat(trimColor, 0.9))
    strip.position.set(sign * (x - 0.82), 6, z + 0.78)
    b.add(strip)
    b.onUpdate((t) => {
      ;(strip.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.25 * Math.sin(t * 2 + sign)
    })
  }
}

/** Foreground occluders — dark rails/cables close to camera for DOF bokeh. */
function foreground(b: StageBuild) {
  const railL = fgBar(0.5, 9, 0.5, 0x05060a)
  railL.position.set(-7.2, 2.5, 7.2)
  b.add(railL)
  const railR = fgBar(0.5, 9, 0.5, 0x05060a)
  railR.position.set(7.2, 2.5, 7.2)
  b.add(railR)
  // a slack cable arcing across the top foreground
  const cableGeo = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(-8, 6.4, 7),
      new THREE.Vector3(0, 5.2, 7.4),
      new THREE.Vector3(8, 6.4, 7),
    ]),
    24, 0.06, 6, false,
  )
  const cable = new THREE.Mesh(cableGeo, structureMat({ color: 0x04050a, roughness: 1, metalness: 0 }))
  b.add(cable)
}

// -- individual stages -------------------------------------------------------

function buildPrePmf(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE GARAGE — a scrappy startup garage backlit by dawn through a roll-up
  // door: pegboard, shelving with boxes, a whiteboard covered in scribbles,
  // hanging work-lamps. Warm, cluttered, human.
  // back + side walls (brighter so the room reads, not a black void)
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(44, 22), structureMat({ color: 0x33262c, roughness: 0.95, metalness: 0.04 }))
  wall.position.set(0, 7, -16)
  wall.receiveShadow = true
  b.add(wall)
  const sideL = new THREE.Mesh(new THREE.PlaneGeometry(20, 22), structureMat({ color: 0x2a1f26, roughness: 0.95 }))
  sideL.position.set(-13, 7, -8); sideL.rotation.y = Math.PI / 2.4
  b.add(sideL)
  const sideR = sideL.clone(); sideR.position.set(13, 7, -8); sideR.rotation.y = -Math.PI / 2.4
  b.add(sideR)

  // roll-up door with a big warm dawn glow blasting in (motivates the key)
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(9.4, 8.4, 0.4), structureMat({ color: 0x141016, roughness: 0.8, metalness: 0.3 }))
  doorFrame.position.set(-8.5, 4.4, -15.4)
  b.add(doorFrame)
  // solid blinding dawn light pouring through the opening (radial, not a black grid)
  const dawn = radialGlow(9.2, 8.2, 0xfff2d0, 0xff8f3a, 1.35)
  dawn.mesh.position.set(-8.5, 4.4, -15.55)
  b.add(dawn.mesh)
  // wide soft halo bleeding past the frame into the room
  const dawnGlow = radialGlow(20, 17, 0xffcf90, 0xff7a2e, 0.5)
  dawnGlow.mesh.position.set(-8.5, 4.6, -15.2)
  b.add(dawnGlow.mesh)
  b.onUpdate((t) => { dawn.mat.uniforms.uTime.value = t; dawnGlow.mat.uniforms.uTime.value = t })
  // roll-up door slats (partly open)
  for (let i = 0; i < 4; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 0.15), structureMat({ color: 0x2a2028, roughness: 0.7, metalness: 0.5 }))
    slat.position.set(-8.5, 7.4 + i * 0.55, -15.2)
    b.add(slat)
  }

  // shelving racks (right) with warm edge-lit uprights + boxes
  for (let i = 0; i < 4; i++) {
    const rack = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.22, 1.7), structureMat({ color: 0x4a3a2a, roughness: 0.8, metalness: 0.3 }))
    rack.position.set(8.5, 1.3 + i * 2.0, -12.5)
    rack.castShadow = true; rack.receiveShadow = true
    b.add(rack)
    for (let j = 0; j < 3; j++) {
      const shade = 0x6a4a2a + j * 0x040804
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 1.0), structureMat({ color: shade, roughness: 0.95 }))
      box.position.set(6.9 + j * 1.15, 1.9 + i * 2.0, -12.5)
      box.castShadow = true
      b.add(box)
    }
  }
  // vertical rack uprights with warm accent strips
  for (const ux of [6.4, 10.6]) {
    const up = new THREE.Mesh(new THREE.BoxGeometry(0.18, 8.4, 0.18), structureMat({ color: 0x2a2028, roughness: 0.7, metalness: 0.6 }))
    up.position.set(ux, 4.4, -12.5)
    b.add(up)
  }

  // whiteboard with scribbles (a real framed board)
  const wbFrame = new THREE.Mesh(new THREE.BoxGeometry(5.4, 3.4, 0.16), structureMat({ color: 0xb8b0a0, roughness: 0.5, metalness: 0.2 }))
  wbFrame.position.set(3.6, 4.7, -15.4)
  b.add(wbFrame)
  const wb = makeScreen(5, 3, 'neural', 0x2b6cff, 0xff5a3c, 0.85, 8)
  wb.mesh.position.set(3.6, 4.7, -15.3)
  b.add(wb.mesh)
  b.onUpdate((t) => (wb.mat.uniforms.uTime.value = t))

  // hanging work-lamps (bright emissive bulb + conical shade) that swing
  for (let i = 0; i < 3; i++) {
    const x = -3 + i * 3
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 3, 6), structureMat({ color: 0x0a0a0a, roughness: 1 }))
    wire.position.set(x, 8, -6)
    b.add(wire)
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.4, 14, 1, true), structureMat({ color: 0x2a2020, roughness: 0.6, metalness: 0.6 }))
    shade.position.set(x, 6.7, -6)
    b.add(shade)
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), glowMat(0xffe6b0, 1))
    bulb.position.set(x, 6.5, -6)
    b.add(bulb)
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), glowMat(0xffcf82, 0.25))
    halo.position.copy(bulb.position)
    b.add(halo)
    b.onUpdate((t) => {
      const sw = Math.sin(t * 0.8 + i * 1.3) * 0.25
      bulb.position.x = x + sw; halo.position.x = x + sw
      shade.position.x = x + sw; wire.position.x = x + sw * 0.5
      wire.rotation.z = -sw * 0.06; shade.rotation.z = -sw * 0.04
    })
  }
  flankPillars(b, cfg, 6.6, -9.5, cfg.trim)
  overheadRig(b, cfg, flags, cfg.shaftColor)
  foreground(b)
}

function buildHypergrowth(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE ROCKET DECK — launch gantry, a rocket silhouette venting glow, control
  // screens, a crowd of onlookers on the deck below.
  const s = cfg.structure
  // gantry towers
  for (const sign of [-1, 1]) {
    const tower = trussBeam(13, 1.0, s)
    tower.rotation.z = Math.PI / 2
    tower.position.set(sign * 7.5, 6.5, -12)
    b.add(tower)
    // cross arms
    for (let i = 0; i < 3; i++) {
      const arm = trussBeam(4, 0.5, s)
      arm.position.set(sign * 5.6, 3 + i * 3.5, -12)
      b.add(arm)
    }
  }
  // rocket body — panelled two-tone metal with a dark base and fins
  const rocket = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.75, 13, 28, 4),
    structureMat({ color: 0xe8eef4, roughness: 0.35, metalness: 0.6 }),
  )
  rocket.position.set(0, 7.5, -13.5)
  rocket.castShadow = true
  b.add(rocket)
  // charcoal band + engine skirt
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.62, 1.62, 1.6, 28), structureMat({ color: 0x2a3138, roughness: 0.5, metalness: 0.7 }))
  band.position.set(0, 4.4, -13.5)
  b.add(band)
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 2.2, 1.4, 28), structureMat({ color: 0x14181c, roughness: 0.6, metalness: 0.7 }))
  skirt.position.set(0, 1.4, -13.5)
  skirt.castShadow = true
  b.add(skirt)
  // accent stripe
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.53, 1.6, 0.5, 28), glowMat(0x66e6ff, 0.5))
  stripe.position.set(0, 9.5, -13.5)
  b.add(stripe)
  // fins
  for (let k = 0; k < 3; k++) {
    const ang = (k / 3) * Math.PI * 2
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 1.7), structureMat({ color: 0xb8c2cc, roughness: 0.4, metalness: 0.6 }))
    fin.position.set(Math.cos(ang) * 1.55, 2.1, -13.5 + Math.sin(ang) * 1.55)
    fin.rotation.y = -ang
    fin.castShadow = true
    b.add(fin)
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3.0, 28), structureMat({ color: 0xd0d8e0, roughness: 0.35, metalness: 0.6 }))
  nose.position.set(0, 15.5, -13.5)
  nose.castShadow = true
  b.add(nose)
  // engine glow
  const glow = new THREE.Mesh(new THREE.CircleGeometry(1.9, 24), glowMat(0x66e6ff, 0.8))
  glow.position.set(0, 0.18, -13.5)
  glow.rotation.x = -Math.PI / 2
  b.add(glow)
  const shaft = lightShaft(1.3, 2.3, 4.2, 0x66e6ff, 0.24)
  shaft.position.set(0, 1.7, -13.5)
  b.add(shaft)
  b.onUpdate((t) => {
    ;(glow.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.25 * Math.abs(Math.sin(t * 4))
    ;(shaft.material as THREE.ShaderMaterial).uniforms.uTime.value = t
  })
  // control screens flanking
  screenWall(b, 2, 2, 2.2, 1.4, new THREE.Vector3(-6.5, 4.5, -9.4), ['data', 'equalizer', 'ticker', 'grid'], cfg.screen.hue, cfg.screen.hue2, 2)
  screenWall(b, 2, 2, 2.2, 1.4, new THREE.Vector3(6.5, 4.5, -9.4), ['grid', 'ticker', 'data', 'equalizer'], cfg.screen.hue, cfg.screen.hue2, 5)
  // a distant crowd suggestion, far back and low so it reads as a mass
  if (flags.crowdCount > 0) {
    const { mesh, update } = crowdBand(Math.min(70, flags.crowdCount), 30, 0x0a1622, 7)
    mesh.position.set(0, -0.4, -17.5)
    mesh.scale.setScalar(0.85)
    b.add(mesh)
    b.onUpdate(update)
  }
  overheadRig(b, cfg, flags, cfg.shaftColor)
  foreground(b)
}

function buildPlateau(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE FLATLINE — a stalled growth plateau: a giant flatlining chart board on
  // a stand, stepped terraces that climb then die flat, receding monolith
  // slabs. Sombre magenta, but with real depth and readable silhouettes.
  // framed chart board on a stand
  const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(14.8, 4.8, 0.4), structureMat({ color: 0x140b22, roughness: 0.5, metalness: 0.5 }))
  boardFrame.position.set(0, 6.2, -15)
  b.add(boardFrame)
  const board = makeScreen(14, 4, 'ekg', cfg.screen.hue, cfg.screen.hue2, 1.2, 3)
  board.mesh.position.set(0, 6.2, -14.8)
  b.add(board.mesh)
  const boardTrim = new THREE.Mesh(new THREE.BoxGeometry(15.2, 0.12, 0.12), glowMat(cfg.trim, 0.7))
  boardTrim.position.set(0, 3.7, -14.7)
  b.add(boardTrim)
  for (const lx of [-6.6, 6.6]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4.4, 0.4), structureMat({ color: cfg.structure, roughness: 0.7, metalness: 0.5 }))
    leg.position.set(lx, 1.8, -14.8)
    leg.castShadow = true
    b.add(leg)
  }
  b.onUpdate((t) => (board.mat.uniforms.uTime.value = t))

  // stepped terraces — a bar-graph that climbs then flatlines into the plateau,
  // built as glowing-edged slabs receding on both sides for real depth.
  const heights = [2.2, 3.4, 4.4, 5.0, 5.2, 5.2, 5.2, 5.2]
  for (const sign of [-1, 1]) {
    for (let i = 0; i < heights.length; i++) {
      const h = heights[i]
      const x = sign * (4.2 + i * 1.35)
      const z = -9.5 - i * 0.5
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, h, 1.2),
        structureMat({ color: cfg.structure, roughness: 0.8, metalness: 0.35 }),
      )
      step.position.set(x, h / 2, z)
      step.castShadow = true; step.receiveShadow = true
      b.add(step)
      // glowing top edge — brighter toward the flat plateau to emphasise stall
      const capBright = 0.4 + 0.5 * (i / heights.length)
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.09, 1.24), glowMat(cfg.trim, capBright))
      cap.position.set(x, h + 0.02, z)
      b.add(cap)
    }
  }

  // receding tall monolith slabs behind for the far silhouette
  const rnd = mulberry(21)
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? -1 : 1
    const depth = -13 - i * 1.4
    const h = 8 + rnd() * 4
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.6, h, 1.0), structureMat({ color: cfg.structure, roughness: 0.85, metalness: 0.3 }))
    slab.position.set(side * (7 + rnd() * 2), h / 2, depth)
    slab.castShadow = true
    b.add(slab)
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, h * 0.85, 0.12), glowMat(cfg.trim, 0.55))
    strip.position.set(side * (7 + rnd() * 2) - side * 0.86, h / 2, depth + 0.55)
    b.add(strip)
  }
  overheadRig(b, cfg, flags, cfg.shaftColor)
  foreground(b)
}

function buildAiNative(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE MODEL FLOOR — a datacenter cathedral: monolith server towers with
  // flowing neural screens, holographic node lattices, cool cyan glow.
  const s = cfg.structure
  // server monoliths in two receding rows
  for (let row = 0; row < 2; row++) {
    for (const sign of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const z = -9 - i * 3.0 - row * 0.5
        const x = sign * (4.5 + row * 2.2 + i * 0.6)
        const h = 9 - i * 0.8
        const tower = new THREE.Mesh(new THREE.BoxGeometry(1.8, h, 1.4), structureMat({ color: s, roughness: 0.5, metalness: 0.6 }))
        tower.position.set(x, h / 2, z)
        tower.castShadow = true
        b.add(tower)
        // near-edge accent strip so the silhouette reads against the dark room
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.1, h * 0.92, 0.1), glowMat(cfg.trim, 0.55))
        edge.position.set(x - sign * 0.9, h / 2, z + 0.72)
        b.add(edge)
        const edge2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.44), glowMat(0x59ffe0, 0.4))
        edge2.position.set(x - sign * 0.9, h - 0.3, z)
        b.add(edge2)
        // face of blinking lights
        const face = makeScreen(1.5, h - 0.6, 'data', cfg.screen.hue, cfg.screen.hue2, 0.8, i * 10 + sign * 3 + row)
        face.mesh.position.set(x - sign * 0.92, h / 2, z)
        face.mesh.rotation.y = sign * Math.PI / 2
        b.add(face.mesh)
        b.onUpdate((t) => (face.mat.uniforms.uTime.value = t))
      }
    }
  }
  // central holographic neural board
  const board = makeScreen(9, 5, 'neural', cfg.screen.hue, cfg.screen.hue2, 1.0, 1)
  board.mesh.position.set(0, 5.5, -14)
  b.add(board.mesh)
  b.onUpdate((t) => (board.mat.uniforms.uTime.value = t))
  // holographic "model" — a wireframe globe with orbiting rings on a projector
  // plinth, set behind the play space so it reads as datacenter set-dressing.
  const holoX = 0, holoY = 4.0, holoZ = -11.5
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 1.0, 1.2, 20),
    structureMat({ color: s, roughness: 0.5, metalness: 0.6, emissive: cfg.trim, emissiveIntensity: 0.25 }),
  )
  plinth.position.set(holoX, 0.6, holoZ)
  b.add(plinth)
  const globe = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.5, 2),
    new THREE.MeshBasicMaterial({ color: 0x00e5ff, wireframe: true, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }),
  )
  globe.position.set(holoX, holoY, holoZ)
  b.add(globe)
  const projShaft = lightShaft(1.6, 0.5, 3.4, 0x00e5ff, 0.14)
  projShaft.position.set(holoX, 2.1, holoZ)
  projShaft.rotation.z = Math.PI
  b.add(projShaft)
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9 + i * 0.32, 0.025, 8, 48), glowMat(0x59ffe0, 0.5 - i * 0.1))
    ring.position.set(holoX, holoY, holoZ)
    ring.rotation.x = Math.PI / 2.4 + i * 0.3
    b.add(ring)
    b.onUpdate((t) => {
      ring.rotation.z = t * (0.3 + i * 0.15) * (i % 2 === 0 ? 1 : -1)
    })
  }
  b.onUpdate((t) => {
    globe.rotation.y = t * 0.3
    ;(projShaft.material as THREE.ShaderMaterial).uniforms.uTime.value = t
  })
  overheadRig(b, cfg, flags, cfg.shaftColor)
  foreground(b)
}

function buildMonetization(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE PRICING ROOM — gold-lit ticker temple: giant price boards, coin-gold
  // columns, cascading numbers.
  // big ticker board
  const board = makeScreen(16, 3, 'ticker', cfg.screen.hue, cfg.screen.hue2, 1.1, 2)
  board.mesh.position.set(0, 7.5, -15)
  b.add(board.mesh)
  b.onUpdate((t) => (board.mat.uniforms.uTime.value = t))
  // secondary data boards
  screenWall(b, 3, 1, 2.4, 1.5, new THREE.Vector3(0, 4.6, -14.6), ['data', 'equalizer', 'data'], cfg.screen.hue, cfg.screen.hue2, 6)
  // gold columns
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 1.0, 13, 20),
        structureMat({ color: 0x6a4c12, roughness: 0.3, metalness: 0.9, emissive: 0x2a1c04, emissiveIntensity: 0.6 }),
      )
      col.position.set(sign * (5.5 + i * 2.5), 6.5, -11 - i * 2)
      col.castShadow = true
      b.add(col)
      // capital glow ring
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.08, 8, 24), glowMat(cfg.trim, 0.8))
      ring.position.set(sign * (5.5 + i * 2.5), 12.8, -11 - i * 2)
      ring.rotation.x = Math.PI / 2
      b.add(ring)
    }
  }
  flankPillars(b, cfg, 7.2, -9, cfg.trim)
  overheadRig(b, cfg, flags, cfg.shaftColor)
  foreground(b)
}

function buildCrisis(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE WAR ROOM — red-alert command center: a wall of alarm screens, a
  // situation table, rotating warning beacons, harsh red practicals.
  screenWall(b, 4, 3, 2.3, 1.4, new THREE.Vector3(0, 6.0, -14.5), ['alert', 'data', 'ekg', 'grid', 'alert', 'ticker', 'data', 'alert', 'grid', 'alert', 'data', 'ekg'], cfg.screen.hue, cfg.screen.hue2, 3)
  // situation table (glowing holo-map) — pushed back behind the play space and
  // brightened so it reads as a raised holo-table, not a hole in the floor.
  const table = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.5, 0.9, 28), structureMat({ color: 0x1a0e0e, roughness: 0.6, metalness: 0.5 }))
  table.position.set(0, 0.45, -10)
  table.castShadow = true
  b.add(table)
  const map = makeScreen(3.9, 3.9, 'grid', 0xff6a4c, 0xffc04c, 1.5, 9)
  map.mesh.position.set(0, 0.92, -10)
  map.mesh.rotation.x = -Math.PI / 2
  b.add(map.mesh)
  const mapRing = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.08, 8, 32), glowMat(0xff5a3c, 0.85))
  mapRing.position.set(0, 0.92, -10)
  mapRing.rotation.x = Math.PI / 2
  b.add(mapRing)
  b.onUpdate((t) => {
    map.mat.uniforms.uTime.value = t
    ;(mapRing.material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.3 * Math.sin(t * 3.0)
  })
  // rotating warning beacons
  for (const sign of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 8, 8), structureMat({ color: cfg.structure, roughness: 0.7, metalness: 0.5 }))
    post.position.set(sign * 6.5, 4, -8)
    b.add(post)
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), glowMat(0xef233c, 1))
    beacon.position.set(sign * 6.5, 8.1, -8)
    b.add(beacon)
    const beam = lightShaft(0.3, 1.6, 5, 0xef233c, 0.8)
    beam.position.set(sign * 6.5, 5.4, -8)
    b.add(beam)
    b.onUpdate((t) => {
      const p = 0.5 + 0.5 * Math.sin(t * 5 + (sign > 0 ? Math.PI : 0))
      ;(beacon.material as THREE.MeshBasicMaterial).opacity = 0.4 + p * 0.6
      const bm = beam.material as THREE.ShaderMaterial
      bm.uniforms.uTime.value = t
      bm.uniforms.uOpacity.value = 0.3 + p * 0.7
      beam.rotation.y = t * 2
    })
  }
  overheadRig(b, cfg, flags, cfg.shaftColor)
  foreground(b)
}

function buildIpoPrep(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE LISTING FLOOR — stock-exchange grandeur: a colossal curved big board,
  // marble columns, gold trim, an opening-bell dais.
  // curved big board (approximate with segmented panels)
  const segs = 5
  for (let i = 0; i < segs; i++) {
    const a = (i / (segs - 1) - 0.5) * 0.9
    const { mesh, mat } = makeScreen(3.6, 5, i === 2 ? 'ticker' : 'data', cfg.screen.hue, cfg.screen.hue2, 1.0, i * 11 + 2)
    mesh.position.set(Math.sin(a) * 13, 6.5, -13 + Math.cos(a) * -1.5 - 1)
    mesh.rotation.y = -a
    b.add(mesh)
    b.onUpdate((t) => (mat.uniforms.uTime.value = t))
  }
  // marble columns
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.8, 12, 20),
        structureMat({ color: 0x2a3648, roughness: 0.35, metalness: 0.4 }),
      )
      col.position.set(sign * (4.5 + i * 2.2), 6, -8 - i * 2)
      col.castShadow = true
      b.add(col)
      // gold capital
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.75, 0.6, 20), structureMat({ color: 0x8a6a1c, roughness: 0.3, metalness: 0.95, emissive: 0x3a2a06, emissiveIntensity: 0.7 }))
      cap.position.set(sign * (4.5 + i * 2.2), 12.2, -8 - i * 2)
      b.add(cap)
    }
  }
  // opening-bell podium — a raised, glowing dais set BEHIND the play space so
  // it never reads as a hole punched in the floor.
  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(1.7, 2.1, 1.1, 28),
    structureMat({ color: 0x1a2436, roughness: 0.4, metalness: 0.6 }),
  )
  podium.position.set(0, 0.55, -10.5)
  podium.castShadow = true
  b.add(podium)
  const podiumTop = makeScreen(2.6, 2.6, 'grid', cfg.trim, cfg.screen.hue2, 1.3, 4)
  podiumTop.mesh.position.set(0, 1.12, -10.5)
  podiumTop.mesh.rotation.x = -Math.PI / 2
  b.add(podiumTop.mesh)
  const podiumRing = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.09, 8, 32), glowMat(cfg.trim, 0.9))
  podiumRing.position.set(0, 1.12, -10.5)
  podiumRing.rotation.x = Math.PI / 2
  b.add(podiumRing)
  b.onUpdate((t) => {
    podiumTop.mat.uniforms.uTime.value = t
    ;(podiumRing.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.25 * Math.sin(t * 2.2)
  })
  overheadRig(b, cfg, flags, cfg.shaftColor)
  foreground(b)
}

function buildDistribution(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE CHANNEL — logistics megahub: stacked shipping containers, gantry crane,
  // conveyor with moving crates, channel/status screens.
  const s = cfg.structure
  const containerColors = [0xc0562c, 0x2c6ac0, 0x2ca05a, 0xc0a02c, 0x8a3ca0]
  const rnd = mulberry(31)
  // container stacks (back)
  for (let i = 0; i < 10; i++) {
    const side = i % 2 === 0 ? -1 : 1
    const stack = Math.floor(rnd() * 3) + 1
    const bx = side * (4 + rnd() * 8)
    const bz = -11 - rnd() * 6
    for (let j = 0; j < stack; j++) {
      const c = new THREE.Mesh(
        new THREE.BoxGeometry(3.2, 1.4, 1.6),
        structureMat({ color: containerColors[Math.floor(rnd() * containerColors.length)], roughness: 0.85, metalness: 0.25 }),
      )
      c.position.set(bx, 0.7 + j * 1.45, bz)
      c.castShadow = true
      c.receiveShadow = true
      b.add(c)
    }
  }
  // gantry crane overhead
  const crane = trussBeam(26, 1.1, s)
  crane.position.set(0, 8.5, -9)
  b.add(crane)
  for (const sign of [-1, 1]) {
    const leg = trussBeam(9, 0.9, s)
    leg.rotation.z = Math.PI / 2
    leg.position.set(sign * 11, 4.5, -9)
    b.add(leg)
  }
  // hanging container from crane
  const hung = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.4, 1.6), structureMat({ color: 0xc0562c, roughness: 0.85 }))
  hung.position.set(-2, 5.5, -8)
  b.add(hung)
  for (const dx of [-1.4, 1.4]) {
    const cbl = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), structureMat({ color: 0x111, roughness: 1 }))
    cbl.position.set(-2 + dx, 6.9, -8)
    b.add(cbl)
  }
  b.onUpdate((t) => {
    hung.position.y = 5.5 + Math.sin(t * 0.7) * 0.3
  })
  // status screens
  screenWall(b, 3, 2, 2.2, 1.3, new THREE.Vector3(0, 5.2, -6.2), ['ticker', 'data', 'grid', 'equalizer', 'data', 'ticker'], cfg.screen.hue, cfg.screen.hue2, 4)
  flankPillars(b, cfg, 7.4, -7, cfg.trim)
  overheadRig(b, cfg, flags, cfg.shaftColor)
  foreground(b)
}

const BUILDERS: Record<ScenarioId, (b: StageBuild, cfg: StageConfig, flags: QualityFlags) => void> = {
  'pre-pmf': buildPrePmf,
  hypergrowth: buildHypergrowth,
  plateau: buildPlateau,
  'ai-native': buildAiNative,
  monetization: buildMonetization,
  crisis: buildCrisis,
  'ipo-prep': buildIpoPrep,
  distribution: buildDistribution,
}

export function buildStageScene(id: ScenarioId, cfg: StageConfig, flags: QualityFlags): StageBuild {
  const b = new StageBuild()
  const fn = BUILDERS[id] ?? buildPrePmf
  fn(b, cfg, flags)
  return b
}
