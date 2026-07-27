import * as THREE from 'three'
import type { QualityFlags } from '../../core/QualityManager'
import type { StageConfig } from '../StageRegistry'
import { StageBuild, structureMat, glowMat, makeScreen, lightShaft } from '../StageKit'
import { overhead, foreground } from './StageSet'

export function buildAiNative(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
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
    new THREE.IcosahedronGeometry(1.6, 2),
    new THREE.MeshBasicMaterial({ color: 0x00e5ff, wireframe: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }),
  )
  globe.position.set(holoX, holoY, holoZ)
  b.add(globe)
  // counter-rotating denser inner lattice + a glowing solid core so the model
  // reads as a live hologram, not a greybox wireframe placeholder
  const globe2 = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.05, 1),
    new THREE.MeshBasicMaterial({ color: 0x66fff0, wireframe: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false }),
  )
  globe2.position.set(holoX, holoY, holoZ)
  b.add(globe2)
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 16), glowMat(0xd8ffff, 0.85))
  core.position.set(holoX, holoY, holoZ)
  b.add(core)
  const coreHalo = new THREE.Mesh(new THREE.SphereGeometry(1.15, 20, 16), glowMat(0x33e5ff, 0.22))
  coreHalo.position.set(holoX, holoY, holoZ)
  b.add(coreHalo)
  // orbiting data nodes on the outer shell
  const nodeGrp = new THREE.Group()
  for (let n = 0; n < 10; n++) {
    const na = (n / 10) * Math.PI * 2
    const nd = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), glowMat(0xaef8ff, 0.9))
    nd.position.set(Math.cos(na) * 1.7, Math.sin(na * 1.7) * 0.9, Math.sin(na) * 1.7)
    nodeGrp.add(nd)
  }
  nodeGrp.position.set(holoX, holoY, holoZ)
  b.add(nodeGrp)
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
    globe2.rotation.y = -t * 0.5
    globe2.rotation.x = t * 0.2
    nodeGrp.rotation.y = t * 0.6
    ;(core.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.2 * Math.sin(t * 2.5)
    ;(projShaft.material as THREE.ShaderMaterial).uniforms.uTime.value = t
  })
  overhead(b, cfg, flags, 'server')
  foreground(b, 'server', cfg)
}
