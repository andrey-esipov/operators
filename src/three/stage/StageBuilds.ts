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
  // inner blinding dawn light (radial, warm core -> orange edge)
  const dawn = radialGlow(11.4, 9.6, 0xfff4d6, 0xff8f36, 1.5)
  dawn.mesh.position.set(0, 4.9, -15.7)
  b.add(dawn.mesh)
  // wide soft halo spilling into the room
  const dawnGlow = radialGlow(24, 20, 0xffcf90, 0xff7a2e, 0.55)
  dawnGlow.mesh.position.set(0, 5.4, -15.4)
  b.add(dawnGlow.mesh)
  // partly-raised door slats bunched at the top of the opening
  for (let i = 0; i < 5; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.42, 0.16), structureMat({ color: 0x241c18, roughness: 0.65, metalness: 0.55 }))
    slat.position.set(0, 9.1 + i * 0.5, -15.55)
    b.add(slat)
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
      const capBright = 0.5 + 0.5 * (i / heights.length)
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.11, 1.26), glowMat(cfg.trim, capBright))
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
  overhead(b, cfg, flags, 'gold')
  foreground(b, 'gold')
}

function buildCrisis(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE WAR ROOM — red-alert command center: a wall of alarm screens, a
  // situation table, rotating warning beacons, harsh red practicals.
  screenWall(b, 4, 3, 2.3, 1.4, new THREE.Vector3(0, 6.0, -14.5), ['alert', 'data', 'ekg', 'grid', 'alert', 'ticker', 'data', 'alert', 'grid', 'alert', 'data', 'ekg'], cfg.screen.hue, cfg.screen.hue2, 3)
  // ANGULAR COMMAND CONSOLE — a hexagonal war table with a flat rectangular
  // holo readout and a scatter of operator stations around it. Deliberately
  // angular + low + wide so it never reads as the same round dais as ipo-prep.
  const consoleBase = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.8, 0.8, 6), structureMat({ color: 0x1a0e0e, roughness: 0.6, metalness: 0.5 }))
  consoleBase.rotation.y = Math.PI / 6
  consoleBase.position.set(0, 0.4, -10)
  consoleBase.castShadow = true
  b.add(consoleBase)
  // hex rim strip
  const rimHex = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.06, 6, 6), glowMat(0xff5a3c, 0.85))
  rimHex.rotation.x = Math.PI / 2; rimHex.rotation.z = Math.PI / 6
  rimHex.position.set(0, 0.82, -10)
  b.add(rimHex)
  // flat rectangular tactical readout laid on the console top
  const map = makeScreen(3.7, 2.9, 'grid', 0xff6a4c, 0xffc04c, 1.5, 9)
  map.mesh.position.set(0, 0.86, -10)
  map.mesh.rotation.x = -Math.PI / 2
  b.add(map.mesh)
  b.onUpdate((t) => {
    map.mat.uniforms.uTime.value = t
    ;(rimHex.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.3 * Math.sin(t * 3.0)
  })
  // operator stations: angular desks + tilted alert monitors flanking the console
  for (let k = 0; k < 3; k++) {
    const ang = -0.85 + k * 0.85
    const dx = Math.sin(ang) * 3.9
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
