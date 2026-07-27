import * as THREE from 'three'
import type { QualityFlags } from '../../core/QualityManager'
import type { StageConfig } from '../StageRegistry'
import { StageBuild, structureMat, glowMat, makeScreen, lightShaft } from '../StageKit'
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
  const beaconPlan: { x: number; postH: number; y: number; z: number }[] = [
    { x: -6.9, postH: 9.2, y: 8.9, z: -8.4 },
    { x: 6.2, postH: 6.6, y: 6.6, z: -7.2 },
  ]
  beaconPlan.forEach((bp, bi) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, bp.postH, 10), structureMat({ color: cfg.structure, roughness: 0.7, metalness: 0.5 }))
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
  foreground(b, 'alarm', cfg)
}
