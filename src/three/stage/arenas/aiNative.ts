import * as THREE from 'three'
import type { QualityFlags } from '../../core/QualityManager'
import type { StageConfig } from '../StageRegistry'
import { StageBuild, structureMat, glowMat, makeScreen, lightShaft, mulberry, type ScreenMode } from '../StageKit'
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

  // -------------------------------------------------------------------------
  // Depth-fill pass: the hall was reading as a dark corridor because the band
  // directly behind the play plane (and the floor) was pure black. Fill it with
  // a lit server bank, flowing floor data and suspended particulate so the set
  // reads as a live datacenter with three depth planes, not a void.
  // -------------------------------------------------------------------------
  const rndA = mulberry(77)

  // Mid-ground server bank: camera-facing scrolling LED cabinets flanking the
  // play plane. A center gap keeps the holo/backdrop sightline open.
  const bankModes: ScreenMode[] = ['data', 'grid', 'equalizer']
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const cx = sign * (2.35 + i * 1.78)
      const cz = -5.2 - i * 0.4
      const ch = 2.25 - i * 0.22
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, ch, 1.2), structureMat({ color: 0x151c26, roughness: 0.5, metalness: 0.62 }))
      cab.position.set(cx, ch / 2, cz); cab.castShadow = true; b.add(cab)
      const scr = makeScreen(1.3, ch - 0.5, bankModes[i % 3], cfg.screen.hue, cfg.screen.hue2, 0.85, i * 7 + sign * 5)
      scr.mesh.position.set(cx, ch / 2 + 0.08, cz + 0.62)
      b.add(scr.mesh)
      b.onUpdate((t) => (scr.mat.uniforms.uTime.value = t))
      const strip = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.08, 0.08), glowMat(0x59ffe0, 0.7))
      strip.position.set(cx, ch + 0.02, cz + 0.52); b.add(strip)
    }
  }

  // Floor data conduits: emissive lanes carrying sliding data packets from the
  // foreground into the hall, so the black floor reads as an active grid.
  const laneXs = [-6, -3.6, -1.35, 1.35, 3.6, 6]
  for (const lx of laneXs) {
    const lane = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 17), glowMat(0x1d6773, 0.5))
    lane.position.set(lx, 0.02, -4); b.add(lane)
  }
  const packets: THREE.Mesh[] = []
  for (let p = 0; p < 12; p++) {
    const lx = laneXs[p % laneXs.length]
    const pk = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.03, 0.85), glowMat(0x9dfbff, 0.9))
    pk.position.set(lx, 0.03, -4)
    packets.push(pk); b.add(pk)
  }
  b.onUpdate((t) => {
    for (let p = 0; p < packets.length; p++) {
      const sp = 3.4 + (p % 3) * 1.5
      packets[p].position.z = ((t * sp + p * 3.1) % 18) - 12
    }
  })

  // Overhead cyan conduits: thin flowing light bars filling the black ceiling band.
  for (let i = 0; i < 3; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(15, 0.09, 0.09), glowMat(0x2f9fb0, 0.5))
    bar.position.set(0, 6.6 + i * 0.85, -6 - i * 1.2); b.add(bar)
  }

  // Drifting data motes: cyan particulate suspended in the hall's light.
  const moteN = 90
  const mBase = new Float32Array(moteN * 3)
  const mSeed = new Float32Array(moteN)
  const mPos = new Float32Array(moteN * 3)
  for (let i = 0; i < moteN; i++) {
    mBase[i * 3] = (rndA() - 0.5) * 16
    mBase[i * 3 + 1] = rndA() * 6 + 0.5
    mBase[i * 3 + 2] = -2 - rndA() * 9
    mSeed[i] = rndA() * 10
    mPos[i * 3] = mBase[i * 3]; mPos[i * 3 + 1] = mBase[i * 3 + 1]; mPos[i * 3 + 2] = mBase[i * 3 + 2]
  }
  const mGeo = new THREE.BufferGeometry()
  mGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3))
  const mMat = new THREE.PointsMaterial({
    color: 0x8ff0ff, size: 0.07, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    fog: false, toneMapped: false,
  })
  const motes = new THREE.Points(mGeo, mMat)
  b.add(motes)
  b.track(mGeo); b.track(mMat)
  b.onUpdate((t) => {
    const a = mGeo.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < moteN; i++) {
      const y = ((mBase[i * 3 + 1] + t * 0.25 + mSeed[i]) % 6.2) + 0.4
      a.setXYZ(i, mBase[i * 3] + Math.sin(t * 0.3 + mSeed[i]) * 0.35, y, mBase[i * 3 + 2])
    }
    a.needsUpdate = true
  })
}
