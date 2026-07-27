import * as THREE from 'three'
import type { QualityFlags } from '../../core/QualityManager'
import type { StageConfig } from '../StageRegistry'
import { StageBuild, structureMat, glowMat, makeScreen } from '../StageKit'
import { overhead, screenWall, foreground } from './StageSet'

export function buildMonetization(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE PRICING ROOM — gold-lit ticker temple: giant price boards, coin-gold
  // columns, cascading numbers.
  // big ticker board
  const board = makeScreen(16, 3, 'ticker', cfg.screen.hue, cfg.screen.hue2, 1.1, 2)
  board.mesh.position.set(0, 7.5, -15)
  b.add(board.mesh)
  b.onUpdate((t) => (board.mat.uniforms.uTime.value = t))
  // secondary data boards — nudged left of the big ticker so the wall isn't a
  // single centred stack
  screenWall(b, 3, 1, 2.4, 1.5, new THREE.Vector3(-1.4, 4.6, -14.6), ['data', 'ticker', 'data'], cfg.screen.hue, cfg.screen.hue2, 6)
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
  foreground(b, 'gold', cfg)
}
