import * as THREE from 'three'
import type { QualityFlags } from '../../core/QualityManager'
import type { StageConfig } from '../StageRegistry'
import {
  StageBuild,
  structureMat,
  glowMat,
  makeScreen,
  trussBeam,
  lightShaft,
  fgBar,
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

/** Foreground occluders — dark shapes close to camera, blurred into bokeh by
 *  DOF. Distinct per stage (kept to the frame edges/top so they frame rather
 *  than block the fighters) so the foreground stops being the same rail+cable. */
export function foreground(b: StageBuild, style: OverheadStyle) {
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
