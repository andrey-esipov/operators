import * as THREE from 'three'
import type { QualityFlags } from '../../core/QualityManager'
import type { StageConfig } from '../StageRegistry'
import { StageBuild, structureMat, glowMat, makeScreen } from '../StageKit'
import { overhead, foreground } from './StageSet'

export function buildIpoPrep(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE LISTING FLOOR — stock-exchange grandeur: a colossal curved big board,
  // marble columns, gold trim, an opening-bell dais.
  // curved big board (approximate with segmented panels)
  const segs = 5
  for (let i = 0; i < segs; i++) {
    const a = (i / (segs - 1) - 0.5) * 0.9
    const { mesh, mat } = makeScreen(3.6, 5, i === 2 ? 'ticker' : 'data', cfg.screen.hue, cfg.screen.hue2, 1.0, i * 11 + 2)
    mesh.position.set(Math.sin(a) * 13, 6.5, -13 + Math.cos(a) * -1.5 - 1)
    mesh.rotation.y = -a
    b.add(mesh)
    b.onUpdate((t) => (mat.uniforms.uTime.value = t))
  }
  // marble columns — ASYMMETRIC colonnade: a full three-column run receding on
  // the LEFT, only two (with a wider gap) on the RIGHT to make room for a
  // presenter's podium, so the hall isn't mirrored.
  const ipoCols: { sign: number; count: number }[] = [{ sign: -1, count: 3 }, { sign: 1, count: 2 }]
  for (const plan of ipoCols) {
    for (let i = 0; i < plan.count; i++) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.7, 0.8, 12, 20),
        structureMat({ color: 0x2a3648, roughness: 0.35, metalness: 0.4 }),
      )
      col.position.set(plan.sign * (4.5 + i * 2.2), 6, -8 - i * 2)
      col.castShadow = true
      b.add(col)
      // gold capital
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.75, 0.6, 20), structureMat({ color: 0x8a6a1c, roughness: 0.3, metalness: 0.95, emissive: 0x3a2a06, emissiveIntensity: 0.7 }))
      cap.position.set(plan.sign * (4.5 + i * 2.2), 12.2, -8 - i * 2)
      b.add(cap)
    }
  }
  // presenter's podium with a live mic on the RIGHT — a unique human-scale prop
  // that fills the gap left by the shorter right colonnade.
  const podium = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.1, 0.9), structureMat({ color: 0x24303f, roughness: 0.4, metalness: 0.5 }))
  podium.position.set(7.4, 1.05, -8.6); podium.castShadow = true; b.add(podium)
  const podTop = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.18, 1.1), structureMat({ color: 0x8a6a1c, roughness: 0.3, metalness: 0.95, emissive: 0x3a2a06, emissiveIntensity: 0.6 }))
  podTop.position.set(7.4, 2.2, -8.6); b.add(podTop)
  const podScreen = makeScreen(1.0, 0.62, 'ticker', cfg.screen.hue, cfg.screen.hue2, 1.0, 55)
  podScreen.mesh.position.set(7.4, 1.5, -8.14); podScreen.mesh.rotation.x = -0.5; b.add(podScreen.mesh)
  b.onUpdate((t) => (podScreen.mat.uniforms.uTime.value = t))
  const micStem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), structureMat({ color: 0x0a0a0a, roughness: 1 }))
  micStem.position.set(7.7, 2.6, -8.5); micStem.rotation.z = 0.3; b.add(micStem)
  const micHead = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), structureMat({ color: 0x14181c, roughness: 0.6, metalness: 0.6 }))
  micHead.position.set(7.84, 3.0, -8.5); b.add(micHead)
  // OPENING-BELL ROSTRUM — three shrinking SQUARE tiers topped by a lit brass
  // bell on a post. Tall + gold + rectilinear so it reads as a totally
  // different silhouette from crisis's low hexagonal console.
  for (let i = 0; i < 3; i++) {
    const w = 3.6 - i * 0.95
    const tier = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.5, w),
      structureMat({ color: 0x1a2436, roughness: 0.4, metalness: 0.6, emissive: 0x0a1220, emissiveIntensity: 0.4 }),
    )
    tier.position.set(0, 0.25 + i * 0.5, -10.5)
    tier.castShadow = true
    b.add(tier)
    const edge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.06, w + 0.06), glowMat(cfg.trim, 0.7))
    edge.position.set(0, 0.5 + i * 0.5, -10.5)
    b.add(edge)
  }
  const bellPost = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.3, 8), structureMat({ color: 0x2a3648, roughness: 0.4, metalness: 0.7 }))
  bellPost.position.set(0, 2.25, -10.5)
  b.add(bellPost)
  const bell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.64, 0.72, 20, 1, true),
    structureMat({ color: 0x8a6a1c, roughness: 0.25, metalness: 0.95, emissive: 0x3a2a06, emissiveIntensity: 0.85 }),
  )
  bell.position.set(0, 3.05, -10.5)
  b.add(bell)
  const bellGlow = new THREE.Mesh(new THREE.SphereGeometry(0.72, 14, 12), glowMat(cfg.trim, 0.4))
  bellGlow.position.set(0, 3.05, -10.5)
  b.add(bellGlow)
  b.onUpdate((t) => {
    ;(bellGlow.material as THREE.MeshBasicMaterial).opacity = 0.28 + 0.22 * Math.abs(Math.sin(t * 2.2))
  })
  // Ticker-tape confetti — the unmistakable NYSE/Nasdaq listing-day cue, but a
  // CELEBRATION cue: it falls only during a victory / round-over beat (see
  // `b.celebrate`), never during neutral play, where a constant paper storm read
  // as a party overlay pasted onto a fight. It eases in/out, and while idle it is
  // fully hidden AND skips its per-frame matrix work, so a neutral round gets
  // exactly zero ticker-tape motion.
  if (flags.crowdCount > 0) {
    const tapeColors = [0xffd60a, 0xfcbf49, 0xffffff, 0x9ecbff, 0xffe08a, 0xff6a6a, 0x8affc0]
    const N = 140
    const geo = new THREE.PlaneGeometry(0.11, 0.34)
    const seeds: { x: number; z: number; y0: number; sp: number; rot: number; sw: number; sc: number }[] = []
    const tape = new THREE.InstancedMesh(
      geo,
      new THREE.MeshBasicMaterial({
        vertexColors: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
      N,
    )
    // Born hidden: no confetti until a celebration actually starts.
    tape.visible = false
    const colr = new THREE.Color()
    for (let i = 0; i < N; i++) {
      seeds.push({
        x: (Math.random() * 2 - 1) * 11.0,
        z: -3 - Math.random() * 11,
        y0: Math.random() * 13,
        sp: 1.0 + Math.random() * 1.8,
        rot: Math.random() * Math.PI,
        sw: 0.6 + Math.random() * 1.6,
        sc: 0.7 + Math.random() * 0.9,
      })
      tape.setColorAt(i, colr.setHex(tapeColors[i % tapeColors.length]))
    }
    b.add(tape)
    const m4 = new THREE.Matrix4(); const qq = new THREE.Quaternion(); const eu = new THREE.Euler(); const sc = new THREE.Vector3(1, 1, 1); const pos = new THREE.Vector3()
    let gain = 0
    const mat = tape.material as THREE.MeshBasicMaterial
    b.onUpdate((t, dt) => {
      const target = b.celebrate ? 1 : 0
      // Ease toward the target so the tape drops in / clears out over ~0.3s
      // rather than popping. `dt` collapses toward 0 during the KO hitstop
      // freeze, which is correct: the whole world holds, and the tape resumes
      // falling as time does.
      gain += (target - gain) * Math.min(1, dt * 3.5)
      if (target === 0 && gain < 0.01) {
        // Fully idle: hide and skip ALL motion so a neutral round is still.
        if (tape.visible) tape.visible = false
        return
      }
      tape.visible = true
      mat.opacity = gain
      for (let i = 0; i < N; i++) {
        const s = seeds[i]
        const y = 13 - ((s.y0 + t * s.sp) % 13.5)
        const sway = Math.sin(t * s.sw + s.rot) * 0.7
        pos.set(s.x + sway, y, s.z)
        eu.set(t * s.sw * 1.6 + s.rot, t * s.sp + s.rot, s.rot * 2)
        qq.setFromEuler(eu)
        sc.set(s.sc, s.sc, s.sc)
        m4.compose(pos, qq, sc)
        tape.setMatrixAt(i, m4)
      }
      tape.instanceMatrix.needsUpdate = true
    })
  }
  overhead(b, cfg, flags, 'atrium')
  foreground(b, 'atrium', cfg)
}

// A corrugated shipping container: base box + vertical rib detail on the long
// faces, top/bottom rails, a central door seam and a small painted stencil so it
// reads as real freight instead of a plain primitive box.
