import * as THREE from 'three'
import type { QualityFlags } from '../../core/QualityManager'
import type { StageConfig } from '../StageRegistry'
import { StageBuild, structureMat, glowMat, makeScreen, lightShaft, type ScreenMode } from '../StageKit'
import { overhead, screenWall, foreground } from './StageSet'

export function buildCrisis(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
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
  const beaconPlan: { x: number; postH: number; y: number; z: number; color: number }[] = [
    { x: -6.9, postH: 9.2, y: 8.9, z: -8.4, color: 0xef233c },
    { x: 6.2, postH: 6.6, y: 6.6, z: -7.2, color: 0xffa028 },
  ]
  beaconPlan.forEach((bp, bi) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, bp.postH, 10), structureMat({ color: cfg.structure, roughness: 0.7, metalness: 0.5 }))
    post.position.set(bp.x, bp.postH / 2, bp.z)
    b.add(post)
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), glowMat(bp.color, 1))
    beacon.position.set(bp.x, bp.y, bp.z)
    b.add(beacon)
    const beam = lightShaft(0.3, 1.6, 5, bp.color, 0.8)
    beam.position.set(bp.x, bp.y - 2.7, bp.z)
    beam.rotation.z = bi === 0 ? 0.5 : -0.5
    b.add(beam)
    b.onUpdate((t) => {
      const p = 0.5 + 0.5 * Math.sin(t * 5 + bi * 2.3)
      ;(beacon.material as THREE.MeshBasicMaterial).opacity = 0.4 + p * 0.6
      const bm = beam.material as THREE.ShaderMaterial
      bm.uniforms.uTime.value = t
      bm.uniforms.uOpacity.value = 0.3 + p * 0.7
      beam.rotation.y = t * 1.6 + bi
    })
  })

  // -------------------------------------------------------------------------
  // Depth-fill: the band directly behind the play plane was empty red haze, and
  // the whole room read monochrome. Add a mid-ground alert-cabinet bank (with a
  // cool-cyan status readout mixed into the red so the palette breathes) plus
  // amber floor hazard pulses running toward camera for depth and motion.
  // -------------------------------------------------------------------------
  const alertModes: ScreenMode[] = ['alert', 'ekg', 'data']
  const alertHues = [0xff5a3c, 0xffb04c, 0x6fd0ff]
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const cx = sign * (3.5 + i * 1.95)
      const cz = -5.6 - i * 0.4
      const ch = 2.1 - i * 0.2
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, ch, 1.2), structureMat({ color: 0x1a0e0e, roughness: 0.6, metalness: 0.5 }))
      cab.position.set(cx, ch / 2, cz); cab.castShadow = true; b.add(cab)
      const hue = alertHues[(i + (sign < 0 ? 0 : 2)) % alertHues.length]
      const scr = makeScreen(1.35, ch - 0.5, alertModes[i % alertModes.length], hue, 0xffd0a0, 0.9, i * 9 + sign * 4)
      scr.mesh.position.set(cx, ch / 2 + 0.08, cz + 0.62); b.add(scr.mesh)
      b.onUpdate((t) => (scr.mat.uniforms.uTime.value = t))
      const strip = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.08), glowMat(hue, 0.7))
      strip.position.set(cx, ch + 0.02, cz + 0.5); b.add(strip)
    }
  }
  const laneXs = [-5.5, -2.3, 2.3, 5.5]
  for (const lx of laneXs) {
    const lane = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 16), glowMat(0x5a1810, 0.5))
    lane.position.set(lx, 0.02, -4); b.add(lane)
  }
  const pulses: THREE.Mesh[] = []
  for (let p = 0; p < 8; p++) {
    const lx = laneXs[p % laneXs.length]
    const pk = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 1.0), glowMat(0xff7a2c, 0.9))
    pk.position.set(lx, 0.03, -4); pulses.push(pk); b.add(pk)
  }
  b.onUpdate((t) => {
    for (let p = 0; p < pulses.length; p++) {
      const sp = 3.0 + (p % 3) * 1.3
      pulses[p].position.z = ((t * sp + p * 3.3) % 18) - 12
    }
  })

  overhead(b, cfg, flags, 'alarm')
  foreground(b, 'alarm', cfg)
}
