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

type OverheadStyle =
  | 'garage' | 'gantry' | 'plateau' | 'server'
  | 'gold' | 'alarm' | 'atrium' | 'yard'

// -- shared sub-assemblies ---------------------------------------------------

/** Volumetric downlight shafts. `tilt(x)` splays them per-stage so no two
 *  arenas share the identical "converging cone" god-ray signature. */
function ceilingShafts(
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
function overhead(b: StageBuild, cfg: StageConfig, flags: QualityFlags, style: OverheadStyle) {
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

/** Foreground occluders — dark shapes close to camera, blurred into bokeh by
 *  DOF. Distinct per stage (kept to the frame edges/top so they frame rather
 *  than block the fighters) so the foreground stops being the same rail+cable. */
function foreground(b: StageBuild, style: OverheadStyle) {
  const D = 0x05060a
  const bar = (w: number, h: number, d: number, x: number, y: number, z: number, rz = 0) => {
    const m = fgBar(w, h, d, D); m.position.set(x, y, z); m.rotation.z = rz; b.add(m); return m
  }
  const arc = (pts: [number, number, number][], r: number) => {
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]))), 24, r, 6, false)
    b.add(new THREE.Mesh(geo, structureMat({ color: D, roughness: 1, metalness: 0 })))
  }
  switch (style) {
    case 'garage': // a hanging cord loop + a workshop stool silhouette
      bar(0.42, 6, 0.42, -7.6, 2.2, 7.2)
      arc([[-8.4, 6.4, 7], [-6.8, 4.2, 7.4], [-8.6, 2.6, 7]], 0.06)
      bar(1.3, 0.24, 1.3, 7.5, 1.0, 7.4); bar(0.12, 2.0, 0.12, 7.0, 0.0, 7.4); bar(0.12, 2.0, 0.12, 8.0, 0.0, 7.4)
      break
    case 'gantry': // launch railing across the top with posts
      bar(15, 0.36, 0.36, 0, 6.6, 7.2)
      for (const x of [-6, -2, 2, 6]) bar(0.18, 2.6, 0.18, x, 5.3, 7.1)
      bar(15, 0.13, 0.13, 0, 4.0, 7.1)
      break
    case 'plateau': // a low abandoned desk edge + a drooping banner cord
      bar(9, 0.3, 0.5, -3, 1.3, 7.3, 0.05)
      arc([[-2, 3.4, 7.2], [1.5, 2.9, 7.4], [4.5, 3.2, 7.2]], 0.05)
      break
    case 'server': // rack uprights + cable drops at the frame edges
      for (const x of [-7.4, 7.4]) bar(0.5, 9, 0.5, x, 2.5, 7.2)
      arc([[-7.2, 6.2, 7], [-4, 4.6, 7.3], [-1.2, 5.0, 7]], 0.05)
      arc([[7.2, 6.2, 7], [4, 4.4, 7.3], [1.2, 4.9, 7]], 0.05)
      break
    case 'gold': // stanchion posts + a velvet-rope swag
      bar(0.3, 7, 0.3, -7.0, 3.0, 7.2); bar(0.3, 7, 0.3, 7.0, 3.0, 7.2)
      arc([[-7, 4.6, 7.2], [0, 5.4, 7.6], [7, 4.6, 7.2]], 0.07)
      break
    case 'alarm': // angular console blocks low at the edges
      bar(5.4, 1.3, 0.6, -6.0, 1.3, 7.2); bar(5.4, 1.3, 0.6, 6.0, 1.3, 7.2)
      bar(0.4, 1.2, 0.4, -7.2, 2.6, 7.4); bar(0.4, 1.2, 0.4, 7.2, 2.6, 7.4)
      break
    case 'atrium': // a grand balustrade — balusters framing the edges + handrail
      for (const x of [-7, -5.2, -4.2, 4.2, 5.2, 7]) bar(0.16, 3.0, 0.16, x, 1.4, 7.3)
      bar(15, 0.26, 0.5, 0, 3.05, 7.3)
      break
    case 'yard': // chain-link fence edge + a dock bollard
      for (const x of [-7.6, -6.8, -6.0]) bar(0.1, 7, 0.1, x, 2.5, 7.2)
      arc([[-8, 6, 7], [8, 6, 7]], 0.04)
      bar(0.6, 1.4, 0.6, 6.9, 0.7, 7.4)
      break
  }
}

/** A glowing polyline chart drawn as emissive segments + vertex nodes on the
 * back wall — a literal line graph. `pts` are normalised [0..1] coordinates. */
function polyChart(
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

function buildPrePmf(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE GARAGE — a scrappy startup garage at dawn. A big roll-up door in the
  // centre-back blasts warm sunrise light through, back-lighting the fighters;
  // a whiteboard of scribbles, industrial shelving with bins, hung work-lamps
  // and a glowing monitor fill the room. Warm, cluttered, human — an origin.
  // warmer concrete walls with emissive seam lines so the room reads under the
  // filmic black-crush instead of collapsing to a void.
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(46, 24), structureMat({ color: 0x4a3a34, roughness: 0.96, metalness: 0.03 }))
  wall.position.set(0, 7, -16.4)
  wall.receiveShadow = true
  b.add(wall)
  for (const sy of [2.4, 6.2, 10]) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(46, 0.05, 0.05), glowMat(0x6a4030, 0.5))
    seam.position.set(0, sy, -16.3)
    b.add(seam)
  }
  const sideL = new THREE.Mesh(new THREE.PlaneGeometry(22, 24), structureMat({ color: 0x3c2e2a, roughness: 0.96 }))
  sideL.position.set(-14, 7, -8); sideL.rotation.y = Math.PI / 2.6
  b.add(sideL)
  const sideR = sideL.clone(); sideR.position.set(14, 7, -8); sideR.rotation.y = -Math.PI / 2.6
  b.add(sideR)
  const floorSlab = new THREE.Mesh(new THREE.PlaneGeometry(30, 14), structureMat({ color: 0x3a2e28, roughness: 0.95 }))
  floorSlab.rotation.x = -Math.PI / 2
  floorSlab.position.set(0, 0.02, -10)
  floorSlab.receiveShadow = true
  b.add(floorSlab)

  // HERO: big central roll-up door with sunrise blasting in
  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(12.2, 10.4, 0.5), structureMat({ color: 0x1a1512, roughness: 0.8, metalness: 0.35 }))
  doorFrame.position.set(0, 5.1, -15.9)
  b.add(doorFrame)
  // inner dawn light behind the door — warm, but dialled back so it reads as a
  // glow behind a segmented door rather than a blinding spotlight cone
  const dawn = radialGlow(10.2, 9.2, 0xffe9c2, 0xff8f36, 0.8)
  dawn.mesh.position.set(0, 4.9, -15.72)
  b.add(dawn.mesh)
  // wide soft halo spilling into the room (sits BEHIND the door slats)
  const dawnGlow = radialGlow(22, 18, 0xffcf90, 0xff7a2e, 0.3)
  dawnGlow.mesh.position.set(0, 5.2, -15.86)
  b.add(dawnGlow.mesh)
  // partly-raised door slats bunched at the top of the opening
  for (let i = 0; i < 4; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.42, 0.16), structureMat({ color: 0x241c18, roughness: 0.65, metalness: 0.55 }))
    slat.position.set(0, 9.3 + i * 0.5, -15.55)
    b.add(slat)
  }
  // segmented roll-up door: dark metal slats across the opening with thin warm
  // seams of light leaking between them, so it clearly reads as a back-lit door
  for (let i = 0; i < 12; i++) {
    const y = 0.5 + i * 0.72
    const slat = new THREE.Mesh(
      new THREE.BoxGeometry(10.6 - Math.abs(i - 5.5) * 0.12, 0.6, 0.1),
      structureMat({ color: 0x201712, roughness: 0.55, metalness: 0.6 }),
    )
    slat.position.set(0, y, -15.6)
    b.add(slat)
    // warm light seam leaking under each slat
    const seam = new THREE.Mesh(new THREE.PlaneGeometry(10.4 - Math.abs(i - 5.5) * 0.12, 0.12), glowMat(0xffb968, 0.9))
    seam.position.set(0, y - 0.36, -15.64)
    b.add(seam)
  }
  // vertical guide rails framing the door opening
  for (const gx of [-5.5, 5.5]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.26, 9.4, 0.2), structureMat({ color: 0x181310, roughness: 0.6, metalness: 0.55 }))
    rail.position.set(gx, 4.9, -15.58)
    b.add(rail)
  }
  // diagonal sunrise god-ray shafts pouring forward past the fighters
  if (SHAFT_ON(flags)) {
    for (const sx of [-2.4, 0.6, 3.0]) {
      const shaft = lightShaft(0.7, 3.4, 12, 0xffb765, 0.3)
      shaft.position.set(sx, 4.6, -10)
      shaft.rotation.z = sx * 0.03
      shaft.rotation.x = 0.12
      b.add(shaft)
      b.onUpdate((t) => {
        const m = shaft.material as THREE.ShaderMaterial
        m.uniforms.uTime.value = t
        m.uniforms.uOpacity.value = 0.26 + 0.05 * Math.sin(t * 0.9 + sx)
      })
    }
  }
  b.onUpdate((t) => { dawn.mat.uniforms.uTime.value = t; dawnGlow.mat.uniforms.uTime.value = t })

  // LEFT: whiteboard on a stand with a hand-drawn up-and-to-the-right growth line
  const wbFrame = new THREE.Mesh(new THREE.BoxGeometry(6.4, 4.2, 0.18), structureMat({ color: 0xd8d2c4, roughness: 0.45, metalness: 0.1 }))
  wbFrame.position.set(-8.4, 5.0, -13.6); wbFrame.rotation.y = 0.32
  b.add(wbFrame)
  const wbSurf = new THREE.Mesh(new THREE.PlaneGeometry(5.9, 3.7), structureMat({ color: 0xeceadf, roughness: 0.5, metalness: 0.0 }))
  wbSurf.position.set(-8.32, 5.0, -13.5); wbSurf.rotation.y = 0.32
  b.add(wbSurf)
  // marker scribble: rising line (drawn as small dark segments on the board)
  const scrib = new THREE.Group()
  const sp: [number, number][] = [[0.08, 0.2], [0.28, 0.32], [0.5, 0.44], [0.72, 0.66], [0.92, 0.86]]
  const smat = new THREE.MeshBasicMaterial({ color: 0x1c4fd8, fog: false, toneMapped: false })
  const smat2 = new THREE.MeshBasicMaterial({ color: 0xd8402c, fog: false, toneMapped: false })
  for (let i = 0; i < sp.length - 1; i++) {
    const a = new THREE.Vector3(-2.6 + 5.2 * sp[i][0], -1.5 + 3.0 * sp[i][1], 0)
    const c = new THREE.Vector3(-2.6 + 5.2 * sp[i + 1][0], -1.5 + 3.0 * sp[i + 1][1], 0)
    const len = a.distanceTo(c)
    const seg = new THREE.Mesh(new THREE.BoxGeometry(len, 0.09, 0.02), smat)
    seg.position.copy(a).lerp(c, 0.5); seg.rotation.z = Math.atan2(c.y - a.y, c.x - a.x)
    scrib.add(seg)
  }
  // a scrawled circle + arrow accent
  for (let k = 0; k < 8; k++) {
    const dot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.02), smat2)
    const ang = (k / 8) * Math.PI * 2
    dot.position.set(1.9 + Math.cos(ang) * 0.5, 1.0 + Math.sin(ang) * 0.5, 0)
    scrib.add(dot)
  }
  scrib.position.set(-8.32, 5.0, -13.42); scrib.rotation.y = 0.32
  b.add(scrib)
  const wbLeg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.0, 0.16), structureMat({ color: 0x2a2420, roughness: 0.7, metalness: 0.5 }))
  wbLeg.position.set(-8.4, 1.4, -13.6); wbLeg.rotation.y = 0.32
  b.add(wbLeg)

  // RIGHT: industrial shelving with warm-lit storage bins
  for (let i = 0; i < 4; i++) {
    const rack = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.22, 1.8), structureMat({ color: 0x5a4632, roughness: 0.8, metalness: 0.3 }))
    rack.position.set(8.8, 1.2 + i * 2.05, -12.8); rack.rotation.y = -0.3
    rack.castShadow = true; rack.receiveShadow = true
    b.add(rack)
    for (let j = 0; j < 3; j++) {
      const binCols = [0xc8792a, 0x3a7a8a, 0xa83c2c]
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.05, 1.0), structureMat({ color: binCols[(i + j) % 3], roughness: 0.85 }))
      box.position.set(7.2 + j * 1.15, 1.85 + i * 2.05, -12.8); box.rotation.y = -0.3
      box.castShadow = true
      b.add(box)
    }
  }
  for (const ux of [6.7, 11.0]) {
    const up = new THREE.Mesh(new THREE.BoxGeometry(0.2, 8.6, 0.2), structureMat({ color: 0x2a2420, roughness: 0.7, metalness: 0.6 }))
    up.position.set(ux, 4.4, -12.8); up.rotation.y = -0.3
    b.add(up)
  }

  // a workbench with a glowing monitor (cool practical to offset the warm dawn)
  const desk = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.2, 1.6), structureMat({ color: 0x3a2f28, roughness: 0.8, metalness: 0.3 }))
  desk.position.set(-7.6, 2.0, -10.5)
  b.add(desk)
  const mon = makeScreen(1.9, 1.2, 'data', 0x3aa0ff, 0x66ffe0, 0.9, 12)
  mon.mesh.position.set(-7.6, 2.9, -10.9); mon.mesh.rotation.y = 0.35
  b.add(mon.mesh)
  b.onUpdate((t) => (mon.mat.uniforms.uTime.value = t))

  // hanging work-lamps (bright bulb + shade) that gently swing
  for (let i = 0; i < 3; i++) {
    const x = -3.5 + i * 3.5
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 3, 6), structureMat({ color: 0x0a0a0a, roughness: 1 }))
    wire.position.set(x, 8.2, -6.5)
    b.add(wire)
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.42, 14, 1, true), structureMat({ color: 0x2a2020, roughness: 0.6, metalness: 0.6 }))
    shade.position.set(x, 6.9, -6.5)
    b.add(shade)
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), glowMat(0xffe6b0, 1))
    bulb.position.set(x, 6.7, -6.5)
    b.add(bulb)
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 10), glowMat(0xffcf82, 0.28))
    halo.position.copy(bulb.position)
    b.add(halo)
    b.onUpdate((t) => {
      const sw = Math.sin(t * 0.8 + i * 1.3) * 0.22
      bulb.position.x = x + sw; halo.position.x = x + sw
      shade.position.x = x + sw; wire.position.x = x + sw * 0.5
      wire.rotation.z = -sw * 0.06; shade.rotation.z = -sw * 0.04
    })
  }
  overhead(b, cfg, flags, 'garage')
  foreground(b, 'garage')
}

function buildHypergrowth(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE ROCKET DECK — launch gantry, a rocket silhouette venting glow, control
  // screens, a crowd of onlookers on the deck below.
  const s = cfg.structure
  // launch gantry — deliberately ASYMMETRIC so the deck reads as a real pad, not
  // a mirrored diagram: a TALL service tower with a swing arm on the left, a
  // SHORTER umbilical mast with a LOX tank cluster on the right.
  const towerL = trussBeam(15.5, 1.0, s); towerL.rotation.z = Math.PI / 2; towerL.position.set(-7.9, 7.9, -12); b.add(towerL)
  for (let i = 0; i < 4; i++) { const arm = trussBeam(4.2, 0.5, s); arm.position.set(-5.7, 2.8 + i * 3.1, -12); b.add(arm) }
  // retractable swing service arm reaching in toward the rocket
  const swing = trussBeam(4.8, 0.42, s); swing.position.set(-3.3, 11.4, -12.6); b.add(swing)
  const towerR = trussBeam(11.5, 0.85, s); towerR.rotation.z = Math.PI / 2; towerR.position.set(8.3, 5.9, -12); b.add(towerR)
  for (let i = 0; i < 2; i++) { const arm = trussBeam(3.4, 0.5, s); arm.position.set(6.7, 3.6 + i * 3.4, -12); b.add(arm) }
  // cryogenic propellant tanks clustered at the right mast base (unique mass)
  for (let k = 0; k < 2; k++) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 3.2, 18), structureMat({ color: 0xdfe6ec, roughness: 0.42, metalness: 0.5 }))
    tank.position.set(9.0 - k * 1.85, 2.3, -10.6 + k * 0.7); b.add(tank)
    const domeT = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), structureMat({ color: 0xe6edf2, roughness: 0.4, metalness: 0.5 }))
    domeT.position.set(9.0 - k * 1.85, 3.9, -10.6 + k * 0.7); b.add(domeT)
    const frost = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 3.0, 12), glowMat(0xcfe8ff, 0.1)); frost.position.copy(tank.position); b.add(frost)
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
  // control screens — ASYMMETRIC: a tall 2x2 telemetry stack on the left, a low
  // wide status strip plus a big mission-countdown clock on the right.
  screenWall(b, 2, 2, 2.2, 1.4, new THREE.Vector3(-6.7, 5.1, -9.4), ['data', 'equalizer', 'ticker', 'grid'], cfg.screen.hue, cfg.screen.hue2, 2)
  screenWall(b, 3, 1, 1.85, 1.15, new THREE.Vector3(7.2, 3.1, -9.0), ['ticker', 'data', 'ticker'], cfg.screen.hue, cfg.screen.hue2, 5)
  const clock = makeScreen(2.6, 1.5, 'ticker', 0x66e6ff, 0xffffff, 1.3, 44)
  clock.mesh.position.set(7.0, 5.5, -9.2)
  b.add(clock.mesh)
  b.onUpdate((t) => (clock.mat.uniforms.uTime.value = t))
  // a distant crowd suggestion, far back and low so it reads as a mass
  if (flags.crowdCount > 0) {
    const { mesh, update } = crowdBand(Math.min(70, flags.crowdCount), 30, 0x0a1622, 7)
    mesh.position.set(0, -0.4, -17.5)
    mesh.scale.setScalar(0.85)
    b.add(mesh)
    b.onUpdate(update)
  }
  overhead(b, cfg, flags, 'gantry')
  foreground(b, 'gantry')
}

function buildPlateau(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE FLATLINE — a stalled growth plateau. The hero is a giant lit chart: a
  // cyan growth curve that rockets up then dies flat, with a dashed magenta
  // "target" projection climbing away above it (the miss). Stepped terraces
  // climb then flatten; receding monoliths give the far silhouette.
  // dark board panel with faint horizontal gridlines
  const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(15.4, 5.6, 0.4), structureMat({ color: 0x140b22, roughness: 0.5, metalness: 0.5 }))
  boardFrame.position.set(0, 4.8, -15)
  b.add(boardFrame)
  const boardSurf = new THREE.Mesh(new THREE.PlaneGeometry(14.6, 5.0), structureMat({ color: 0x0e0720, roughness: 0.4, metalness: 0.4 }))
  boardSurf.position.set(0, 4.8, -14.78)
  b.add(boardSurf)
  for (let g = 0; g < 5; g++) {
    const gl = new THREE.Mesh(new THREE.BoxGeometry(14.2, 0.03, 0.03), glowMat(0x5a3a7a, 0.32))
    gl.position.set(0, 2.5 + g * 1.0, -14.74)
    b.add(gl)
  }
  const boardTrim = new THREE.Mesh(new THREE.BoxGeometry(15.6, 0.12, 0.12), glowMat(cfg.trim, 0.8))
  boardTrim.position.set(0, 2.0, -14.7)
  b.add(boardTrim)
  // HERO growth curve: hockey-stick up, then a dead-flat plateau (cyan)
  const growth: [number, number][] = [
    [0.04, 0.08], [0.13, 0.13], [0.22, 0.22], [0.31, 0.38],
    [0.4, 0.6], [0.49, 0.8], [0.58, 0.9], [0.68, 0.92],
    [0.79, 0.92], [0.92, 0.92],
  ]
  polyChart(b, growth, -6.7, 6.7, 3.0, 6.7, -14.66, 0x45f2e0, 0.17)
  // dashed magenta "target" projection continuing the early trajectory upward
  const projStart = new THREE.Vector3(-6.7 + 13.4 * 0.49, 3.0 + 3.7 * 0.8, -14.62)
  const projEnd = new THREE.Vector3(-6.7 + 13.4 * 0.95, 3.0 + 3.7 * 1.7, -14.62)
  const projDir = projEnd.clone().sub(projStart)
  const projLen = projDir.length()
  const dashN = 9
  for (let d = 0; d < dashN; d++) {
    if (d % 2 === 1) continue
    const seg = new THREE.Mesh(new THREE.BoxGeometry(projLen / dashN * 0.7, 0.1, 0.05), glowMat(cfg.accent, 0.7))
    seg.position.copy(projStart).addScaledVector(projDir, (d + 0.5) / dashN)
    seg.rotation.z = Math.atan2(projDir.y, projDir.x)
    b.add(seg)
  }
  // "stall" marker: a pulsing dot where the curve dies flat
  const stall = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), glowMat(0x45f2e0, 1))
  stall.position.set(-6.7 + 13.4 * 0.58, 3.0 + 3.7 * 0.9, -14.6)
  b.add(stall)
  b.onUpdate((t) => { (stall.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.5 * Math.abs(Math.sin(t * 2.4)) })
  for (const lx of [-6.8, 6.8]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.0, 0.4), structureMat({ color: cfg.structure, roughness: 0.7, metalness: 0.5 }))
    leg.position.set(lx, 1.0, -14.8)
    leg.castShadow = true
    b.add(leg)
  }

  // stepped terraces — ASYMMETRIC bar-graphs: the LEFT run climbs and holds
  // (the plateau); the RIGHT run climbs then rolls over and declines (the miss).
  // Two different profiles kill the mirror and reinforce the story.
  const heightsL = [2.2, 3.4, 4.4, 5.0, 5.2, 5.2, 5.2, 5.2]
  const heightsR = [2.6, 3.9, 4.7, 4.3, 3.7, 3.1, 2.7, 2.4]
  for (const sign of [-1, 1]) {
    const heights = sign < 0 ? heightsL : heightsR
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
      // glowing top edge — cool trim on the holding left, warning-warm on the
      // declining right, so the two runs read as different outcomes
      const capBright = 0.5 + 0.5 * (i / heights.length)
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.11, 1.26), glowMat(sign < 0 ? cfg.trim : cfg.accent, capBright))
      cap.position.set(x, h + 0.02, z)
      b.add(cap)
      // front glowing riser strip so the bars read from the camera
      const riser = new THREE.Mesh(new THREE.BoxGeometry(1.22, h * 0.9, 0.05), glowMat(cfg.screen.hue2, 0.28 + 0.2 * (i / heights.length)))
      riser.position.set(x, h / 2, z + 0.61)
      b.add(riser)
    }
  }

  // receding tall monolith slabs behind for the far silhouette
  const rnd = mulberry(21)
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? -1 : 1
    const depth = -13 - i * 1.4
    const h = 8 + rnd() * 4
    const sx = side * (7.5 + rnd() * 2)
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.6, h, 1.0), structureMat({ color: cfg.structure, roughness: 0.85, metalness: 0.3 }))
    slab.position.set(sx, h / 2, depth)
    slab.castShadow = true
    b.add(slab)
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, h * 0.85, 0.12), glowMat(cfg.trim, 0.6))
    strip.position.set(sx - side * 0.86, h / 2, depth + 0.55)
    b.add(strip)
  }
  overhead(b, cfg, flags, 'plateau')
  foreground(b, 'plateau')
}

function buildAiNative(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE MODEL FLOOR — a datacenter cathedral: monolith server towers with
  // flowing neural screens, holographic node lattices, cool cyan glow.
  const s = cfg.structure
  // server monoliths — ASYMMETRIC: a denser, taller bank on the LEFT, a sparser
  // bank on the RIGHT (plus a wide cooling unit below), so the hall never reads
  // as a mirrored diagram.
  const towerPlan: { sign: number; count: number; h0: number }[] = [
    { sign: -1, count: 3, h0: 9.6 },
    { sign: 1, count: 2, h0: 7.9 },
  ]
  for (let row = 0; row < 2; row++) {
    for (const plan of towerPlan) {
      const sign = plan.sign
      for (let i = 0; i < plan.count; i++) {
        const z = -9 - i * 3.0 - row * 0.5
        const x = sign * (4.5 + row * 2.2 + i * 0.6)
        const h = plan.h0 - i * 0.8
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
  // wide liquid-cooling unit low on the RIGHT — a chunky pipe-rack that balances
  // the emptier right bank with a different silhouette (breaks the mirror).
  const cool = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.2, 1.5), structureMat({ color: 0x141a24, roughness: 0.55, metalness: 0.6 }))
  cool.position.set(7.4, 1.1, -8.4); cool.castShadow = true; b.add(cool)
  for (let p = 0; p < 3; p++) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 3.4, 10), structureMat({ color: 0x2a3444, roughness: 0.4, metalness: 0.7 }))
    pipe.rotation.z = Math.PI / 2; pipe.position.set(7.4, 0.5 + p * 0.6, -7.6); b.add(pipe)
    const flow = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.05, 0.05), glowMat(0x59ffe0, 0.5)); flow.position.set(7.4, 0.5 + p * 0.6, -7.42); b.add(flow)
  }
  // central holographic neural board — nudged right to counterbalance the
  // left-shifted globe hologram (breaks the dead-centre axis)
  const board = makeScreen(8, 5, 'neural', cfg.screen.hue, cfg.screen.hue2, 1.0, 1)
  board.mesh.position.set(2.0, 5.7, -14)
  b.add(board.mesh)
  b.onUpdate((t) => (board.mat.uniforms.uTime.value = t))
  // holographic "model" — a wireframe globe with orbiting rings on a projector
  // plinth, set behind the play space so it reads as datacenter set-dressing.
  const holoX = -1.9, holoY = 4.0, holoZ = -11.5
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
  overhead(b, cfg, flags, 'server')
  foreground(b, 'server')
}

function buildMonetization(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE PRICING ROOM — gold-lit ticker temple: giant price boards, coin-gold
  // columns, cascading numbers.
  // big ticker board
  const board = makeScreen(16, 3, 'ticker', cfg.screen.hue, cfg.screen.hue2, 1.1, 2)
  board.mesh.position.set(0, 7.5, -15)
  b.add(board.mesh)
  b.onUpdate((t) => (board.mat.uniforms.uTime.value = t))
  // secondary data boards — nudged left of the big ticker so the wall isn't a
  // single centred stack
  screenWall(b, 3, 1, 2.4, 1.5, new THREE.Vector3(-1.4, 4.6, -14.6), ['data', 'equalizer', 'data'], cfg.screen.hue, cfg.screen.hue2, 6)
  // gold columns — ASYMMETRIC colonnade: a deep three-column run receding on the
  // LEFT, a single tall column on the RIGHT, so the temple isn't mirrored.
  const colPlan: { sign: number; count: number }[] = [{ sign: -1, count: 3 }, { sign: 1, count: 1 }]
  for (const plan of colPlan) {
    for (let i = 0; i < plan.count; i++) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 1.0, 13, 20),
        structureMat({ color: 0x6a4c12, roughness: 0.3, metalness: 0.9, emissive: 0x2a1c04, emissiveIntensity: 0.6 }),
      )
      col.position.set(plan.sign * (5.5 + i * 2.5), 6.5, -11 - i * 2)
      col.castShadow = true
      b.add(col)
      // capital glow ring
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.08, 8, 24), glowMat(cfg.trim, 0.8))
      ring.position.set(plan.sign * (5.5 + i * 2.5), 12.8, -11 - i * 2)
      ring.rotation.x = Math.PI / 2
      b.add(ring)
    }
  }
  // a gilded vault-door disc set into the RIGHT wall — a unique hero mass that
  // balances the deeper left colonnade (money kept behind steel)
  const vault = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.5, 40), structureMat({ color: 0x5a4a1e, roughness: 0.35, metalness: 0.95, emissive: 0x201804, emissiveIntensity: 0.5 }))
  vault.rotation.x = Math.PI / 2; vault.position.set(9.6, 5.2, -12.5); b.add(vault)
  for (let r = 0; r < 2; r++) {
    const vr = new THREE.Mesh(new THREE.TorusGeometry(1.5 - r * 0.6, 0.09, 8, 40), glowMat(cfg.trim, 0.7))
    vr.position.set(9.6, 5.2, -12.24); b.add(vr)
  }
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.9, 0.08), structureMat({ color: 0x8a6a1c, roughness: 0.3, metalness: 0.95 }))
    spoke.position.set(9.6 + Math.cos(ang) * 0.0, 5.2, -12.22); spoke.rotation.z = ang; b.add(spoke)
  }
  overhead(b, cfg, flags, 'gold')
  foreground(b, 'gold')
}

function buildCrisis(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE WAR ROOM — red-alert command center: a wall of alarm screens, a
  // situation table, rotating warning beacons, harsh red practicals.
  // command video wall — shifted LEFT of centre; a tall vertical status totem
  // stands on the RIGHT so the room reads asymmetric, not a mirrored grid.
  screenWall(b, 4, 3, 2.3, 1.4, new THREE.Vector3(-2.2, 6.2, -14.5), ['alert', 'data', 'ekg', 'grid', 'alert', 'ticker', 'data', 'alert', 'grid', 'alert', 'data', 'ekg'], cfg.screen.hue, cfg.screen.hue2, 3)
  const totem = makeScreen(1.8, 6.4, 'ekg', 0xff5a3c, 0xffb04c, 1.2, 33)
  totem.mesh.position.set(6.6, 5.6, -13.6)
  b.add(totem.mesh)
  const totemBez = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 6.6), structureMat({ color: 0x120606, roughness: 0.6, metalness: 0.4 }))
  totemBez.position.set(6.6, 5.6, -13.66); b.add(totemBez)
  b.onUpdate((t) => (totem.mat.uniforms.uTime.value = t))
  // ANGULAR COMMAND CONSOLE — a hexagonal war table with a flat rectangular
  // holo readout and a scatter of operator stations around it. Deliberately
  // angular + low + wide so it never reads as the same round dais as ipo-prep.
  const consoleBase = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.8, 0.8, 6), structureMat({ color: 0x1a0e0e, roughness: 0.6, metalness: 0.5 }))
  consoleBase.rotation.y = Math.PI / 6
  consoleBase.position.set(-1.5, 0.4, -10)
  consoleBase.castShadow = true
  b.add(consoleBase)
  // hex rim strip
  const rimHex = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.06, 6, 6), glowMat(0xff5a3c, 0.85))
  rimHex.rotation.x = Math.PI / 2; rimHex.rotation.z = Math.PI / 6
  rimHex.position.set(-1.5, 0.82, -10)
  b.add(rimHex)
  // flat rectangular tactical readout laid on the console top
  const map = makeScreen(3.7, 2.9, 'grid', 0xff6a4c, 0xffc04c, 1.5, 9)
  map.mesh.position.set(-1.5, 0.86, -10)
  map.mesh.rotation.x = -Math.PI / 2
  b.add(map.mesh)
  b.onUpdate((t) => {
    map.mat.uniforms.uTime.value = t
    ;(rimHex.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.3 * Math.sin(t * 3.0)
  })
  // operator stations: angular desks + tilted alert monitors flanking the console
  for (let k = 0; k < 3; k++) {
    const ang = -0.85 + k * 0.85
    const dx = -1.5 + Math.sin(ang) * 3.9
    const dz = -9.6 + Math.cos(ang) * 1.0
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.14, 0.85), structureMat({ color: 0x241414, roughness: 0.7, metalness: 0.4 }))
    desk.position.set(dx, 0.82, dz); desk.rotation.y = -ang
    desk.castShadow = true
    b.add(desk)
    const scr = makeScreen(1.5, 0.85, 'alert', 0xff5a3c, 0xffb04c, 1.15, 20 + k)
    scr.mesh.position.set(dx, 1.42, dz - 0.08)
    scr.mesh.rotation.y = -ang; scr.mesh.rotation.x = -0.32
    b.add(scr.mesh)
    b.onUpdate((t) => (scr.mat.uniforms.uTime.value = t))
  }
  // rotating warning beacons — different height, depth and phase per side so the
  // pair never reads as a mirror.
  const beaconPlan: { x: number; postH: number; y: number; z: number }[] = [
    { x: -6.9, postH: 9.2, y: 8.9, z: -8.4 },
    { x: 6.2, postH: 6.6, y: 6.6, z: -7.2 },
  ]
  beaconPlan.forEach((bp, bi) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, bp.postH, 8), structureMat({ color: cfg.structure, roughness: 0.7, metalness: 0.5 }))
    post.position.set(bp.x, bp.postH / 2, bp.z)
    b.add(post)
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), glowMat(0xef233c, 1))
    beacon.position.set(bp.x, bp.y, bp.z)
    b.add(beacon)
    const beam = lightShaft(0.3, 1.6, 5, 0xef233c, 0.8)
    beam.position.set(bp.x, bp.y - 2.7, bp.z)
    b.add(beam)
    b.onUpdate((t) => {
      const p = 0.5 + 0.5 * Math.sin(t * 5 + bi * 2.3)
      ;(beacon.material as THREE.MeshBasicMaterial).opacity = 0.4 + p * 0.6
      const bm = beam.material as THREE.ShaderMaterial
      bm.uniforms.uTime.value = t
      bm.uniforms.uOpacity.value = 0.3 + p * 0.7
      beam.rotation.y = t * 2 + bi
    })
  })
  overhead(b, cfg, flags, 'alarm')
  foreground(b, 'alarm')
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
  // marble columns — ASYMMETRIC colonnade: a full three-column run receding on
  // the LEFT, only two (with a wider gap) on the RIGHT to make room for a
  // presenter's podium, so the hall isn't mirrored.
  const ipoCols: { sign: number; count: number }[] = [{ sign: -1, count: 3 }, { sign: 1, count: 2 }]
  for (const plan of ipoCols) {
    for (let i = 0; i < plan.count; i++) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.8, 12, 20),
        structureMat({ color: 0x2a3648, roughness: 0.35, metalness: 0.4 }),
      )
      col.position.set(plan.sign * (4.5 + i * 2.2), 6, -8 - i * 2)
      col.castShadow = true
      b.add(col)
      // gold capital
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.75, 0.6, 20), structureMat({ color: 0x8a6a1c, roughness: 0.3, metalness: 0.95, emissive: 0x3a2a06, emissiveIntensity: 0.7 }))
      cap.position.set(plan.sign * (4.5 + i * 2.2), 12.2, -8 - i * 2)
      b.add(cap)
    }
  }
  // presenter's podium with a live mic on the RIGHT — a unique human-scale prop
  // that fills the gap left by the shorter right colonnade.
  const podium = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.1, 0.9), structureMat({ color: 0x24303f, roughness: 0.4, metalness: 0.5 }))
  podium.position.set(7.4, 1.05, -8.6); podium.castShadow = true; b.add(podium)
  const podTop = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 1.1), structureMat({ color: 0x8a6a1c, roughness: 0.3, metalness: 0.95, emissive: 0x3a2a06, emissiveIntensity: 0.6 }))
  podTop.position.set(7.4, 2.2, -8.6); b.add(podTop)
  const podScreen = makeScreen(1.0, 0.62, 'ticker', cfg.screen.hue, cfg.screen.hue2, 1.0, 55)
  podScreen.mesh.position.set(7.4, 1.5, -8.14); podScreen.mesh.rotation.x = -0.5; b.add(podScreen.mesh)
  b.onUpdate((t) => (podScreen.mat.uniforms.uTime.value = t))
  const micStem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), structureMat({ color: 0x0a0a0a, roughness: 1 }))
  micStem.position.set(7.7, 2.6, -8.5); micStem.rotation.z = 0.3; b.add(micStem)
  const micHead = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), structureMat({ color: 0x14181c, roughness: 0.6, metalness: 0.6 }))
  micHead.position.set(7.84, 3.0, -8.5); b.add(micHead)
  // OPENING-BELL ROSTRUM — three shrinking SQUARE tiers topped by a lit brass
  // bell on a post. Tall + gold + rectilinear so it reads as a totally
  // different silhouette from crisis's low hexagonal console.
  for (let i = 0; i < 3; i++) {
    const w = 3.6 - i * 0.95
    const tier = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.5, w),
      structureMat({ color: 0x1a2436, roughness: 0.4, metalness: 0.6, emissive: 0x0a1220, emissiveIntensity: 0.4 }),
    )
    tier.position.set(0, 0.25 + i * 0.5, -10.5)
    tier.castShadow = true
    b.add(tier)
    const edge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.06, w + 0.06), glowMat(cfg.trim, 0.7))
    edge.position.set(0, 0.5 + i * 0.5, -10.5)
    b.add(edge)
  }
  const bellPost = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.3, 8), structureMat({ color: 0x2a3648, roughness: 0.4, metalness: 0.7 }))
  bellPost.position.set(0, 2.25, -10.5)
  b.add(bellPost)
  const bell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.64, 0.72, 20, 1, true),
    structureMat({ color: 0x8a6a1c, roughness: 0.25, metalness: 0.95, emissive: 0x3a2a06, emissiveIntensity: 0.85 }),
  )
  bell.position.set(0, 3.05, -10.5)
  b.add(bell)
  const bellGlow = new THREE.Mesh(new THREE.SphereGeometry(0.72, 14, 12), glowMat(cfg.trim, 0.4))
  bellGlow.position.set(0, 3.05, -10.5)
  b.add(bellGlow)
  b.onUpdate((t) => {
    ;(bellGlow.material as THREE.MeshBasicMaterial).opacity = 0.28 + 0.22 * Math.abs(Math.sin(t * 2.2))
  })
  overhead(b, cfg, flags, 'atrium')
  foreground(b, 'atrium')
}

// A corrugated shipping container: base box + vertical rib detail on the long
// faces, top/bottom rails, a central door seam and a small painted stencil so it
// reads as real freight instead of a plain primitive box.
function shippingContainer(color: number, stencil: number): THREE.Group {
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

function buildDistribution(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE CHANNEL — logistics megahub: stacked shipping containers, gantry crane,
  // conveyor with moving crates, channel/status screens.
  const s = cfg.structure
  const containerColors = [0xc0562c, 0x2c6ac0, 0x2ca05a, 0xc0a02c, 0x8a3ca0]
  const stencils = [0xffd27a, 0xdfeaff, 0xbfffd0, 0xfff0a8, 0xe6c8ff]
  const rnd = mulberry(31)
  // container stacks (back)
  for (let i = 0; i < 10; i++) {
    const side = i % 2 === 0 ? -1 : 1
    const stack = Math.floor(rnd() * 3) + 1
    const bx = side * (4 + rnd() * 8)
    const bz = -11 - rnd() * 6
    for (let j = 0; j < stack; j++) {
      const ci = Math.floor(rnd() * containerColors.length)
      const c = shippingContainer(containerColors[ci], stencils[ci])
      c.position.set(bx, 0.7 + j * 1.45, bz)
      c.rotation.y = (rnd() - 0.5) * 0.14
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
  const hung = shippingContainer(0xc0562c, 0xffd27a)
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
  // dockside light masts — tall thin poles with a lamp head (logistics yard),
  // instead of the shared flankPillars so distribution keeps its own silhouette
  for (const sign of [-1, 1]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 15, 10), structureMat({ color: s, roughness: 0.6, metalness: 0.6 }))
    mast.position.set(sign * 8.2, 7.5, -7)
    mast.castShadow = true
    b.add(mast)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.16, 0.16), structureMat({ color: s, roughness: 0.6, metalness: 0.6 }))
    arm.position.set(sign * 7.4, 14.4, -7)
    b.add(arm)
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.4, 0.7), structureMat({ color: 0x14181c, roughness: 0.6, metalness: 0.6 }))
    lamp.position.set(sign * 6.7, 14.1, -7)
    b.add(lamp)
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), glowMat(0xdfeaff, 0.85))
    glow.position.set(sign * 6.7, 13.85, -6.6); glow.rotation.x = 0.5
    b.add(glow)
  }
  overhead(b, cfg, flags, 'yard')
  foreground(b, 'yard')
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
