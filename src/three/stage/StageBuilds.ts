import * as THREE from 'three'
import type { QualityFlags } from '../core/QualityManager'
import type { ScenarioId } from '../../types'
import type { StageConfig } from './StageRegistry'
import {
  StageBuild,
  structureMat,
  glowMat,
  makeScreen,
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
    if (SHAFT_ON(flags)) {
      const shaft = lightShaft(0.6, 3.4, 9.2, shaftColor, cfg.shaftIntensity * 0.5)
      shaft.position.set(x * 0.7, 4.2, z + 1.5)
      b.add(shaft)
      b.onUpdate((t) => {
        const m = shaft.material as THREE.ShaderMaterial
        m.uniforms.uTime.value = t
        m.uniforms.uOpacity.value = cfg.shaftIntensity * (0.42 + 0.1 * Math.sin(t * 1.3 + i))
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
  // THE GARAGE — cluttered startup garage: shelving, hanging bulbs, workbench,
  // a roll-up door glowing with dawn light, whiteboards.
  const s = cfg.structure
  // back wall
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), structureMat({ color: 0x1a1520, roughness: 0.95, metalness: 0.05 }))
  wall.position.set(0, 6, -16)
  wall.receiveShadow = true
  b.add(wall)
  // roll-up door with dawn glow behind
  const door = new THREE.Mesh(new THREE.PlaneGeometry(9, 8), structureMat({ color: 0x0e0b12, roughness: 1 }))
  door.position.set(-9, 4.2, -15.7)
  b.add(door)
  const dawn = makeScreen(8.4, 7.4, 'grid', 0xffb257, 0xff7a2c, 0.5, 4)
  dawn.mesh.position.set(-9, 4.2, -15.9)
  b.add(dawn.mesh)
  b.onUpdate((t) => (dawn.mat.uniforms.uTime.value = t))
  // shelving racks (right)
  for (let i = 0; i < 3; i++) {
    const rack = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.25, 1.6), structureMat({ color: s, roughness: 0.8, metalness: 0.3 }))
    rack.position.set(8, 1.6 + i * 2.1, -13)
    rack.castShadow = true
    b.add(rack)
    // boxes on shelves
    for (let j = 0; j < 3; j++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.9), structureMat({ color: 0x6a4a2a, roughness: 0.95 }))
      box.position.set(6.6 + j * 1.0, 2.0 + i * 2.1, -13)
      box.castShadow = true
      b.add(box)
    }
  }
  // whiteboard with scribbles
  const wb = makeScreen(5, 3, 'neural', 0x9ad6ff, 0xff9d3c, 0.7, 8)
  wb.mesh.position.set(4.5, 4.5, -15.6)
  b.add(wb.mesh)
  b.onUpdate((t) => (wb.mat.uniforms.uTime.value = t))
  // hanging bulbs (practical glow + swing)
  for (let i = 0; i < 3; i++) {
    const x = -3 + i * 3
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 3, 6), structureMat({ color: 0x111, roughness: 1 }))
    wire.position.set(x, 8, -6)
    b.add(wire)
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), glowMat(0xffd9a0, 1))
    bulb.position.set(x, 6.5, -6)
    b.add(bulb)
    b.onUpdate((t) => {
      const sw = Math.sin(t * 0.8 + i * 1.3) * 0.25
      bulb.position.x = x + sw
      wire.position.x = x + sw * 0.5
      wire.rotation.z = -sw * 0.06
    })
  }
  flankPillars(b, cfg, 6.4, -9, cfg.trim)
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
  // rocket body
  const rocket = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.9, 14, 24),
    structureMat({ color: 0xd8e4ee, roughness: 0.4, metalness: 0.5 }),
  )
  rocket.position.set(0, 7, -13.5)
  rocket.castShadow = true
  b.add(rocket)
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3.2, 24), structureMat({ color: 0xc0ccd8, roughness: 0.4, metalness: 0.5 }))
  nose.position.set(0, 15.6, -13.5)
  b.add(nose)
  // engine glow
  const glow = new THREE.Mesh(new THREE.CircleGeometry(1.7, 24), glowMat(0x66e6ff, 0.8))
  glow.position.set(0, 0.18, -13.5)
  glow.rotation.x = -Math.PI / 2
  b.add(glow)
  const shaft = lightShaft(1.1, 2.0, 4.5, 0x66e6ff, 0.28)
  shaft.position.set(0, 1.9, -13.5)
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
  // THE FLATLINE — a stalled, sombre plateau: a giant flatlining EKG board,
  // sparse monolith slabs receding to a dead-flat horizon.
  const board = makeScreen(14, 4, 'ekg', cfg.screen.hue, cfg.screen.hue2, 1.1, 3)
  board.mesh.position.set(0, 5.5, -15)
  b.add(board.mesh)
  const bez = new THREE.Mesh(new THREE.PlaneGeometry(14.6, 4.6), structureMat({ color: 0x0a0714, roughness: 0.6, metalness: 0.4 }))
  bez.position.set(0, 5.5, -15.1)
  b.add(bez)
  b.onUpdate((t) => (board.mat.uniforms.uTime.value = t))
  // receding monolith slabs
  const rnd = mulberry(21)
  for (let i = 0; i < 8; i++) {
    const side = i % 2 === 0 ? -1 : 1
    const depth = -8 - i * 1.6
    const h = 5 + rnd() * 4
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.4, h, 1.0), structureMat({ color: cfg.structure, roughness: 0.85, metalness: 0.3 }))
    slab.position.set(side * (5 + rnd() * 3), h / 2, depth)
    slab.castShadow = true
    b.add(slab)
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.1, h * 0.8, 0.1), glowMat(cfg.trim, 0.5))
    strip.position.set(side * (5 + rnd() * 3) - side * 0.75, h / 2, depth + 0.55)
    b.add(strip)
  }
  flankPillars(b, cfg, 6.8, -9, cfg.trim)
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
  // floating hologram rings above the stage
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4 + i * 0.5, 0.03, 8, 48), glowMat(0x00e5ff, 0.6 - i * 0.12))
    ring.position.set(0, 3.2 + i * 0.4, -3)
    ring.rotation.x = Math.PI / 2.2
    b.add(ring)
    b.onUpdate((t) => {
      ring.rotation.z = t * (0.2 + i * 0.1)
      ring.position.y = 3.2 + i * 0.4 + Math.sin(t * 0.8 + i) * 0.1
    })
  }
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
  // situation table (glowing map)
  const table = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.4, 24), structureMat({ color: 0x1a0e0e, roughness: 0.6, metalness: 0.5 }))
  table.position.set(0, 0.6, -6)
  b.add(table)
  const map = makeScreen(4.2, 4.2, 'grid', 0xff5a3c, 0xffb03c, 0.8, 9)
  map.mesh.position.set(0, 0.82, -6)
  map.mesh.rotation.x = -Math.PI / 2
  b.add(map.mesh)
  b.onUpdate((t) => (map.mat.uniforms.uTime.value = t))
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
  // bell dais glow
  const dais = makeScreen(3, 3, 'grid', cfg.trim, cfg.screen.hue2, 0.7, 4)
  dais.mesh.position.set(0, 0.05, -4)
  dais.mesh.rotation.x = -Math.PI / 2
  b.add(dais.mesh)
  b.onUpdate((t) => (dais.mat.uniforms.uTime.value = t))
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
