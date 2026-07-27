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
  // a gilded vault-door set into the RIGHT wall — a unique hero mass that
  // balances the deeper left colonnade. Rebuilt from a flat disc into a
  // beveled, bolted, spoked vault so it reads as dimensional metal, never a
  // flat bullseye sticker.
  const vx = 9.6, vy = 5.2, vz = -12.5
  // recessed dark backing plate
  const vPlate = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.35, 44), structureMat({ color: 0x2a2109, roughness: 0.5, metalness: 0.9 }))
  vPlate.rotation.x = Math.PI / 2; vPlate.position.set(vx, vy, vz - 0.22); b.add(vPlate)
  // main door disc — brighter gilded metal, stepped forward of the plate
  const vDoor = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.15, 0.5, 44), structureMat({ color: 0x8a6a20, roughness: 0.28, metalness: 0.96, emissive: 0x3a2a08, emissiveIntensity: 0.5 }))
  vDoor.rotation.x = Math.PI / 2; vDoor.position.set(vx, vy, vz); vDoor.castShadow = true; b.add(vDoor)
  // beveled outer rim catches the practicals -> a real dimensional edge
  const vRim = new THREE.Mesh(new THREE.TorusGeometry(2.28, 0.16, 12, 48), structureMat({ color: 0xb89030, roughness: 0.24, metalness: 0.98, emissive: 0x4a3810, emissiveIntensity: 0.55 }))
  vRim.position.set(vx, vy, vz + 0.05); b.add(vRim)
  // concentric recessed step rings for surface relief
  for (let s = 0; s < 2; s++) {
    const sr = new THREE.Mesh(new THREE.TorusGeometry(1.55 - s * 0.55, 0.07, 8, 40), structureMat({ color: 0x6a5216, roughness: 0.3, metalness: 0.95 }))
    sr.position.set(vx, vy, vz + 0.24); b.add(sr)
  }
  // a single warm glow accent ring (was two flat rings; now just an accent)
  const vGlow = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.05, 8, 48), glowMat(cfg.trim, 0.7))
  vGlow.position.set(vx, vy, vz + 0.26); b.add(vGlow)
  b.onUpdate((t) => ((vGlow.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.22 * Math.sin(t * 1.6)))
  // bolt studs around the rim — the unmistakable vault-door detail
  const boltN = 20
  const boltGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.18, 8)
  const boltMat = structureMat({ color: 0xd8b048, roughness: 0.22, metalness: 0.98, emissive: 0x4a3810, emissiveIntensity: 0.5 })
  const bolts = new THREE.InstancedMesh(boltGeo, boltMat, boltN)
  const bMtx = new THREE.Matrix4()
  const bQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
  const bScl = new THREE.Vector3(1, 1, 1)
  for (let i = 0; i < boltN; i++) {
    const a = (i / boltN) * Math.PI * 2
    bMtx.compose(new THREE.Vector3(vx + Math.cos(a) * 2.05, vy + Math.sin(a) * 2.05, vz + 0.22), bQuat, bScl)
    bolts.setMatrixAt(i, bMtx)
  }
  bolts.instanceMatrix.needsUpdate = true
  b.add(bolts); b.track(boltGeo)
  // spoked handwheel converging on a raised centre hub, slowly turning
  const wheel = new THREE.Group()
  for (let k = 0; k < 4; k++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.9, 0.12), structureMat({ color: 0xc89828, roughness: 0.25, metalness: 0.97, emissive: 0x3a2a08, emissiveIntensity: 0.5 }))
    spoke.rotation.z = (k / 4) * Math.PI
    wheel.add(spoke)
  }
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.08, 8, 28), structureMat({ color: 0xc89828, roughness: 0.25, metalness: 0.97, emissive: 0x3a2a08, emissiveIntensity: 0.5 }))
  wheel.add(wheelRim)
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.55, 16), structureMat({ color: 0xd8b048, roughness: 0.2, metalness: 0.98, emissive: 0x4a3810, emissiveIntensity: 0.7 }))
  hub.rotation.x = Math.PI / 2; wheel.add(hub)
  wheel.position.set(vx, vy, vz + 0.34); b.add(wheel)
  b.onUpdate((t) => (wheel.rotation.z = t * 0.15))
  overhead(b, cfg, flags, 'gold')
  foreground(b, 'gold', cfg)
}
