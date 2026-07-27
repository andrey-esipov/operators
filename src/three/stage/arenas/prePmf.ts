import * as THREE from 'three'
import type { QualityFlags } from '../../core/QualityManager'
import type { StageConfig } from '../StageRegistry'
import { StageBuild, structureMat, glowMat, makeScreen, radialGlow, lightShaft } from '../StageKit'
import { SHAFT_ON, overhead, foreground } from './StageSet'

export function buildPrePmf(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
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

  // cardboard moving boxes on the floor — the unmistakable "we just moved into
  // the garage" cue; stacked asymmetrically and low so they read as clutter and
  // add a real mid-ground layer without blocking the fighters.
  const cardboard = (w: number, h: number, d: number, x: number, y: number, z: number, ry: number) => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), structureMat({ color: 0xc8a06a, roughness: 0.95, metalness: 0.02, emissive: 0x3a2a16, emissiveIntensity: 0.35 }))
    box.position.set(x, y, z); box.rotation.y = ry; box.castShadow = true; box.receiveShadow = true; b.add(box)
    // packing-tape seam across the lid
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, d * 0.98), structureMat({ color: 0x7a5a34, roughness: 0.6, metalness: 0.1 }))
    tape.position.set(x, y + h / 2 + 0.005, z); tape.rotation.y = ry; b.add(tape)
    return box
  }
  cardboard(1.6, 1.5, 1.6, -6.0, 0.77, -6.0, 0.26)
  cardboard(1.25, 1.15, 1.25, -5.8, 2.08, -6.15, -0.12)
  cardboard(1.5, 1.4, 1.4, 5.7, 0.72, -5.6, -0.32)

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
  foreground(b, 'garage', cfg)
}
