import * as THREE from 'three'
import type { QualityFlags } from '../../core/QualityManager'
import type { StageConfig } from '../StageRegistry'
import { StageBuild, structureMat, glowMat, makeScreen, trussBeam, lightShaft, crowdBand } from '../StageKit'
import { overhead, screenWall, foreground } from './StageSet'

export function buildHypergrowth(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE ROCKET DECK — launch gantry, a rocket silhouette venting glow, control
  // screens, a crowd of onlookers on the deck below.
  const s = cfg.structure
  // launch gantry — deliberately ASYMMETRIC so the deck reads as a real pad, not
  // a mirrored diagram: a TALL service tower with a swing arm on the left, a
  // SHORTER umbilical mast with a LOX tank cluster on the right.
  const towerL = trussBeam(15.5, 1.0, s); towerL.rotation.z = Math.PI / 2; towerL.position.set(-7.9, 7.9, -12); b.add(towerL)
  for (let i = 0; i < 4; i++) { const arm = trussBeam(4.2, 0.5, s); arm.position.set(-5.7, 2.8 + i * 3.1, -12); b.add(arm) }
  // retractable swing service arm reaching in toward the rocket
  const swing = trussBeam(4.8, 0.42, s); swing.position.set(-3.3, 11.4, -12.6); b.add(swing)
  const towerR = trussBeam(11.5, 0.85, s); towerR.rotation.z = Math.PI / 2; towerR.position.set(8.3, 5.9, -12); b.add(towerR)
  for (let i = 0; i < 2; i++) { const arm = trussBeam(3.4, 0.5, s); arm.position.set(6.7, 3.6 + i * 3.4, -12); b.add(arm) }
  // cryogenic propellant tanks clustered at the right mast base (unique mass)
  for (let k = 0; k < 2; k++) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 3.2, 18), structureMat({ color: 0xdfe6ec, roughness: 0.42, metalness: 0.5 }))
    tank.position.set(9.0 - k * 1.85, 2.3, -10.6 + k * 0.7); b.add(tank)
    const domeT = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), structureMat({ color: 0xe6edf2, roughness: 0.4, metalness: 0.5 }))
    domeT.position.set(9.0 - k * 1.85, 3.9, -10.6 + k * 0.7); b.add(domeT)
    const frost = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 3.0, 12), glowMat(0xcfe8ff, 0.1)); frost.position.copy(tank.position); b.add(frost)
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
  // --- self-lit industrial detailing: this is what makes machinery read against
  // a dark deck without flooding the fighters with ambient. Aviation beacons,
  // safety strips and lit rocket windows carve the silhouette out of the black.
  const beacons: THREE.Mesh[] = []
  const addBeacon = (x: number, y: number, z: number, color: number) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), glowMat(color, 0.9))
    m.position.set(x, y, z); b.add(m); beacons.push(m)
  }
  addBeacon(-7.9, 15.4, -12, 0xff3524); addBeacon(-7.9, 10.9, -12, 0xff3524)
  addBeacon(8.3, 11.6, -12, 0xff3524)
  // cyan safety-light strips running up the two tower legs
  for (const x of [-7.4, 8.0]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 13), glowMat(0x33e0ff, 0.42))
    strip.position.set(x, 8, -11.5); b.add(strip)
  }
  // rocket panel windows — two vertical ladders of small emissive rects on the
  // body's front face (z = body centre + radius) so the hull stops reading flat.
  for (let i = 0; i < 6; i++) {
    for (const x of [-0.85, 0.85]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.2), glowMat(0x9ff0ff, 0.62))
      w.position.set(x, 5.4 + i * 1.35, -12.0); b.add(w)
    }
  }
  // brighter mission stripe already exists (stripe); add a second lower band
  const stripe2 = new THREE.Mesh(new THREE.CylinderGeometry(1.66, 1.66, 0.32, 28), glowMat(0x66e6ff, 0.6))
  stripe2.position.set(0, 6.0, -13.5); b.add(stripe2)
  b.onUpdate((t) => {
    const bl = 0.35 + 0.6 * (0.5 + 0.5 * Math.sin(t * 4.0))
    const bl2 = 0.35 + 0.6 * (0.5 + 0.5 * Math.sin(t * 4.0 + 2.1))
    ;(beacons[0].material as THREE.MeshBasicMaterial).opacity = bl
    ;(beacons[1].material as THREE.MeshBasicMaterial).opacity = bl
    ;(beacons[2].material as THREE.MeshBasicMaterial).opacity = bl2
  })
  // engine flame — a WHITE-HOT core inside an amber thruster plume. The warm fire
  // against the cool teal deck breaks the monochrome wash and gives the rocket a
  // motivated hero light (was a cold cyan disc that read as a static monument).
  const flameOuter = new THREE.Mesh(new THREE.CircleGeometry(2.3, 28), glowMat(0xff7a1c, 0.85))
  flameOuter.position.set(0, 0.16, -13.5); flameOuter.rotation.x = -Math.PI / 2; b.add(flameOuter)
  const glow = new THREE.Mesh(new THREE.CircleGeometry(1.5, 24), glowMat(0xffd24a, 0.95))
  glow.position.set(0, 0.2, -13.5); glow.rotation.x = -Math.PI / 2; b.add(glow)
  const core = new THREE.Mesh(new THREE.CircleGeometry(1.15, 24), glowMat(0xffffff, 1.0))
  core.position.set(0, 0.24, -13.5); core.rotation.x = -Math.PI / 2; b.add(core)
  // a tight white-hot exhaust plume + a broad amber flame column above it
  const plume = lightShaft(0.9, 2.1, 3.8, 0xffffff, 0.6)
  plume.position.set(0, 1.7, -13.5); b.add(plume)
  const shaft = lightShaft(1.5, 2.7, 4.6, 0xff8a2c, 0.32)
  shaft.position.set(0, 1.9, -13.5); b.add(shaft)
  // warm scorched-glow pool spilling forward onto the pad (motivated floor bounce)
  const scorch = new THREE.Mesh(new THREE.CircleGeometry(4.6, 32), glowMat(0xd9531a, 0.16))
  scorch.position.set(0, 0.05, -11.4); scorch.rotation.x = -Math.PI / 2; b.add(scorch)
  b.onUpdate((t) => {
    const f = 0.72 + 0.28 * Math.abs(Math.sin(t * 5.5) * Math.sin(t * 2.3 + 1))
    ;(glow.material as THREE.MeshBasicMaterial).opacity = 0.72 * f + 0.2
    ;(core.material as THREE.MeshBasicMaterial).opacity = 0.85 * f + 0.15
    ;(flameOuter.material as THREE.MeshBasicMaterial).opacity = 0.62 * f + 0.2
    ;(scorch.material as THREE.MeshBasicMaterial).opacity = 0.12 * f + 0.06
    ;(shaft.material as THREE.ShaderMaterial).uniforms.uTime.value = t
    ;(plume.material as THREE.ShaderMaterial).uniforms.uTime.value = t
  })
  // control screens — ASYMMETRIC: a tall 2x2 telemetry stack on the left, a low
  // wide status strip plus a big mission-countdown clock on the right.
  screenWall(b, 2, 2, 2.2, 1.4, new THREE.Vector3(-6.7, 5.1, -9.4), ['data', 'equalizer', 'ticker', 'grid'], cfg.screen.hue, cfg.screen.hue2, 2)
  screenWall(b, 3, 1, 1.85, 1.15, new THREE.Vector3(7.2, 3.1, -9.0), ['ticker', 'data', 'ticker'], cfg.screen.hue, cfg.screen.hue2, 5)
  const clock = makeScreen(2.6, 1.5, 'ticker', 0x66e6ff, 0xffffff, 1.3, 44)
  clock.mesh.position.set(7.0, 5.5, -9.2)
  b.add(clock.mesh)
  b.onUpdate((t) => (clock.mat.uniforms.uTime.value = t))
  // a distant crowd suggestion, far back and low so it reads as a mass
  if (flags.crowdCount > 0) {
    const { mesh, update } = crowdBand(Math.min(70, flags.crowdCount), 30, 0x0a1622, 7)
    mesh.position.set(0, -0.4, -17.5)
    mesh.scale.setScalar(0.85)
    b.add(mesh)
    b.onUpdate(update)
  }
  overhead(b, cfg, flags, 'gantry')
  foreground(b, 'gantry', cfg)
}
