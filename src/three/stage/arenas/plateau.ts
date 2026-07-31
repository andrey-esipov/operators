import * as THREE from 'three'
import type { QualityFlags } from '../../core/QualityManager'
import type { StageConfig } from '../StageRegistry'
import { StageBuild, structureMat, glowMat, mulberry } from '../StageKit'
import { overhead, foreground, polyChart } from './StageSet'

export function buildPlateau(b: StageBuild, cfg: StageConfig, flags: QualityFlags) {
  // THE FLATLINE — a stalled growth plateau. The hero is a giant lit chart: a
  // cyan growth curve that rockets up then dies flat, with a dashed magenta
  // "target" projection climbing away above it (the miss). Stepped terraces
  // climb then flatten; receding monoliths give the far silhouette.
  // dark board panel with faint horizontal gridlines
  const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(15.4, 5.6, 0.4), structureMat({ color: 0x140b22, roughness: 0.5, metalness: 0.5 }))
  boardFrame.position.set(0, 4.8, -15)
  b.add(boardFrame)
  const boardSurf = new THREE.Mesh(new THREE.PlaneGeometry(14.6, 5.0), structureMat({ color: 0x12092a, roughness: 0.4, metalness: 0.4, emissive: 0x1a1140, emissiveIntensity: 0.55 }))
  boardSurf.position.set(0, 4.8, -14.78)
  b.add(boardSurf)
  // corner brackets so the panel unmistakably reads as a lit display, not a void
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const hb = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.06), glowMat(cfg.trim, 0.8))
    hb.position.set(sx * 6.6, 4.8 + sy * 2.3, -14.68); b.add(hb)
    const vb = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 0.06), glowMat(cfg.trim, 0.8))
    vb.position.set(sx * 7.2, 4.8 + sy * 1.9, -14.68); b.add(vb)
  }
  // continuous glowing bezel frame around the whole board so the growth curve
  // unmistakably lives ON a wall-mounted big-board display, not floating in air
  const bezelMat = () => glowMat(cfg.trim, 0.7)
  const bzTop = new THREE.Mesh(new THREE.BoxGeometry(15.0, 0.14, 0.1), bezelMat()); bzTop.position.set(0, 7.35, -14.66); b.add(bzTop)
  const bzBot = new THREE.Mesh(new THREE.BoxGeometry(15.0, 0.14, 0.1), bezelMat()); bzBot.position.set(0, 2.25, -14.66); b.add(bzBot)
  const bzL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 5.24, 0.1), bezelMat()); bzL.position.set(-7.43, 4.8, -14.66); b.add(bzL)
  const bzR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 5.24, 0.1), bezelMat()); bzR.position.set(7.43, 4.8, -14.66); b.add(bzR)
  // faint vertical gridlines so it reads as a chart display, not a plain panel
  for (let v = 1; v < 8; v++) {
    const vl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 4.9, 0.02), glowMat(0x4a2f6a, 0.22))
    vl.position.set(-7.0 + v * 1.75, 4.8, -14.75); b.add(vl)
  }
  for (let g = 0; g < 5; g++) {
    const gl = new THREE.Mesh(new THREE.BoxGeometry(14.2, 0.03, 0.03), glowMat(0x5a3a7a, 0.32))
    gl.position.set(0, 2.5 + g * 1.0, -14.74)
    b.add(gl)
  }
  const boardTrim = new THREE.Mesh(new THREE.BoxGeometry(15.6, 0.12, 0.12), glowMat(cfg.trim, 0.8))
  boardTrim.position.set(0, 2.0, -14.7)
  b.add(boardTrim)
  // HERO growth curve: hockey-stick up, then a dead-flat plateau (cyan)
  const growth: [number, number][] = [
    [0.04, 0.08], [0.13, 0.13], [0.22, 0.22], [0.31, 0.38],
    [0.4, 0.6], [0.49, 0.8], [0.58, 0.9], [0.68, 0.92],
    [0.79, 0.92], [0.92, 0.92],
  ]
  polyChart(b, growth, -6.7, 6.7, 3.0, 6.7, -14.66, 0x45f2e0, 0.17)
  // dashed magenta "target" projection continuing the early trajectory upward
  const projStart = new THREE.Vector3(-6.7 + 13.4 * 0.49, 3.0 + 3.7 * 0.8, -14.62)
  const projEnd = new THREE.Vector3(-6.7 + 13.4 * 0.95, 3.0 + 3.7 * 1.7, -14.62)
  const projDir = projEnd.clone().sub(projStart)
  const projLen = projDir.length()
  const dashN = 9
  for (let d = 0; d < dashN; d++) {
    if (d % 2 === 1) continue
    const seg = new THREE.Mesh(new THREE.BoxGeometry(projLen / dashN * 0.7, 0.1, 0.05), glowMat(cfg.accent, 0.7))
    seg.position.copy(projStart).addScaledVector(projDir, (d + 0.5) / dashN)
    seg.rotation.z = Math.atan2(projDir.y, projDir.x)
    b.add(seg)
  }
  // "stall" marker: a pulsing dot where the curve dies flat
  const stall = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), glowMat(0x45f2e0, 1))
  stall.position.set(-6.7 + 13.4 * 0.58, 3.0 + 3.7 * 0.9, -14.6)
  b.add(stall)
  b.onUpdate((t) => { (stall.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.5 * Math.abs(Math.sin(t * 2.4)) })
  for (const lx of [-6.8, 6.8]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.0, 0.4), structureMat({ color: cfg.structure, roughness: 0.7, metalness: 0.5 }))
    leg.position.set(lx, 1.0, -14.8)
    leg.castShadow = true
    b.add(leg)
  }

  // stepped terraces — ASYMMETRIC bar-graphs: the LEFT run climbs and holds
  // (the plateau); the RIGHT run climbs then rolls over and declines (the miss).
  // Two different profiles kill the mirror and reinforce the story.
  const heightsL = [2.2, 3.4, 4.4, 5.0, 5.2, 5.2, 5.2, 5.2]
  const heightsR = [2.6, 3.9, 4.7, 4.3, 3.7, 3.1, 2.7, 2.4]
  for (const sign of [-1, 1]) {
    const heights = sign < 0 ? heightsL : heightsR
    for (let i = 0; i < heights.length; i++) {
      const h = heights[i]
      const x = sign * (4.2 + i * 1.35)
      const z = -9.5 - i * 0.5
      const step = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, h, 1.2),
        structureMat({ color: cfg.structure, roughness: 0.8, metalness: 0.35 }),
      )
      step.position.set(x, h / 2, z)
      step.castShadow = true; step.receiveShadow = true
      b.add(step)
      // glowing top edge — cool trim on the holding left, warning-warm on the
      // declining right, so the two runs read as different outcomes
      const capBright = 0.5 + 0.5 * (i / heights.length)
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.11, 1.26), glowMat(sign < 0 ? cfg.trim : cfg.accent, capBright))
      cap.position.set(x, h + 0.02, z)
      b.add(cap)
      // front glowing riser strip so the bars read from the camera
      const riser = new THREE.Mesh(new THREE.BoxGeometry(1.22, h * 0.9, 0.05), glowMat(cfg.screen.hue2, 0.28 + 0.2 * (i / heights.length)))
      riser.position.set(x, h / 2, z + 0.61)
      b.add(riser)
    }
  }

  // receding tall monolith slabs behind for the far silhouette
  const rnd = mulberry(21)
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? -1 : 1
    const depth = -13 - i * 1.4
    const h = 8 + rnd() * 4
    const sx = side * (7.5 + rnd() * 2)
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.6, h, 1.0), structureMat({ color: cfg.structure, roughness: 0.85, metalness: 0.3 }))
    slab.position.set(sx, h / 2, depth)
    slab.castShadow = true
    b.add(slab)
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, h * 0.85, 0.12), glowMat(cfg.trim, 0.6))
    strip.position.set(sx - side * 0.86, h / 2, depth + 0.55)
    b.add(strip)
  }
  overhead(b, cfg, flags, 'plateau')
  foreground(b, 'plateau', cfg)
}
