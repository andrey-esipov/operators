import * as THREE from 'three'
import type { QualityFlags } from '../../core/QualityManager'
import type { StageConfig } from '../StageRegistry'
import { StageBuild, structureMat, glowMat, trussBeam, mulberry } from '../StageKit'
import { overhead, screenWall, foreground, shippingContainer } from './StageSet'

export function buildDistribution(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
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
