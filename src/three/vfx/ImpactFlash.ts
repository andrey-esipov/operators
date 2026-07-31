import * as THREE from 'three'
import type { EngineContext, QualityTier } from '../types'
import type { LoadedImpactSheet, MarkUV } from '../fight/loadImpactSheet'

/**
 * The bold impact-frame graphic — one large, short-lived additive quad that
 * lands at the contact point on a hit, on TOP of the fine particle burst.
 *
 * WHY THIS EXISTS. The particle burst is a spray of *fine* elements (each ~4–7%
 * of character height). AAA fighters (SF6 / Tekken 8 / GGST) appear to add a
 * single deliberate DRAWN mark at contact — a vector star, slash or shatter —
 * that reads as "something got HIT", not "particles happened" (our own read of
 * the genre; no published spec grounds it). This class draws that
 * mark from the procedural spark sheet (public/impact/sparks, authored by
 * scripts/generate-impact-sparks.ts).
 *
 * THREE DESIGN RULES, each learned the hard way here:
 *   1. Short-lived. Our target life is ~2–8 frames — our own number, from
 *      watching the genre, with no published spec to cite. The mark runs on
 *      the SCALED sim delta (like the shockwaves), so it is HELD through hitstop
 *      and then ages out in a handful of frames — the "held impact frame that
 *      releases" beat — instead of lingering as clutter.
 *   2. Oriented to the blow. The quad is rotated in its own plane (uRot) to the
 *      screen-space blow direction, so a right-facing jab and a left-facing one
 *      don't stamp the same mark; the slash/shatter marks especially read as a
 *      cut along the punch.
 *   3. Channel-weighted tint owns the hue. The sheet is drawn WHITE; the tint is
 *      applied here with one channel pushed >1 and another suppressed, so
 *      additive blending + bloom saturate the mark WARMER (or, for a launcher,
 *      BLUER) rather than driving every channel past 1 into a featureless white
 *      orb. This is the exact fix the Ion Storm super needed (commit 12c4d0b).
 */

interface Flash {
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
  life: number
  max: number
}

const POOL = 6

/** 1×1 white placeholder so the sampler is always bound before the sheet loads;
 *  spawn() is gated on `ready` so nothing actually draws until the real art is
 *  in. */
function placeholderTex(): THREE.Texture {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat)
  t.needsUpdate = true
  return t
}

export class ImpactFlash {
  private pool: Flash[] = []
  private cursor = 0
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private enabled = true
  private ready = false
  private uv: MarkUV[] = []
  private texture: THREE.Texture | null = null
  private placeholder = placeholderTex()

  constructor(ctx: EngineContext) {
    this.scene = ctx.scene
    this.camera = ctx.camera
    const geo = new THREE.PlaneGeometry(1, 1)
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uMap: { value: this.placeholder },
          uOffset: { value: new THREE.Vector2(0, 0) },
          uScale: { value: new THREE.Vector2(1, 1) },
          uTint: { value: new THREE.Color(1, 1, 1) },
          uIntensity: { value: 1 },
          uRot: { value: 0 },
          uAge: { value: 1 },
        },
        vertexShader: IMPACT_VERT,
        fragmentShader: IMPACT_FRAG,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.frustumCulled = false
      // Just over the shockwave (28) so the bold mark reads on top of the ring.
      mesh.renderOrder = 29
      mesh.visible = false
      this.scene.add(mesh)
      this.pool.push({ mesh, mat, life: 0, max: 1 })
    }
    this.configure(ctx.quality)
  }

  configure(_q: QualityTier) {
    // One additive quad per hit is negligible; keep the headline mark on at every
    // tier (the shockwave, by contrast, disables on 'low').
    this.enabled = true
  }

  /** Install the loaded spark sheet. Until this is called, spawn() is inert. */
  setSheet(sheet: LoadedImpactSheet) {
    this.texture = sheet.texture
    this.uv = sheet.uv
    for (const f of this.pool) f.mat.uniforms.uMap.value = sheet.texture
    this.ready = this.uv.length > 0
  }

  get isReady() {
    return this.ready
  }

  /**
   * Fire one bold mark.
   *
   * @param pos        contact point (world units) — the sim's `event.at`.
   * @param markIndex  which mark on the sheet (weight picks this).
   * @param size       world-unit width/height of the quad (weight scales this).
   * @param angleRad   in-plane rotation, the screen-space blow direction.
   * @param tint       channel-weighted hue (may exceed 1 per channel).
   * @param intensity  emissive multiplier (drives bloom).
   * @param life       seconds (short — ~2–8 frames).
   */
  spawn(
    pos: THREE.Vector3,
    markIndex: number,
    size: number,
    angleRad: number,
    tint: THREE.Color,
    intensity: number,
    life: number,
  ) {
    if (!this.enabled || !this.ready) return
    const uv = this.uv[markIndex] ?? this.uv[0]
    if (!uv) return
    const f = this.pool[this.cursor]
    this.cursor = (this.cursor + 1) % this.pool.length
    f.life = life
    f.max = life
    f.mesh.position.copy(pos)
    f.mesh.scale.set(size, size, 1)
    f.mat.uniforms.uOffset.value.set(uv.offset[0], uv.offset[1])
    f.mat.uniforms.uScale.value.set(uv.scale[0], uv.scale[1])
    ;(f.mat.uniforms.uTint.value as THREE.Color).copy(tint)
    f.mat.uniforms.uIntensity.value = intensity
    f.mat.uniforms.uRot.value = angleRad
    f.mat.uniforms.uAge.value = 0
    f.mesh.visible = true
  }

  update(dt: number) {
    for (const f of this.pool) {
      if (f.life <= 0) continue
      f.life = Math.max(0, f.life - dt)
      f.mat.uniforms.uAge.value = 1 - f.life / f.max
      // Billboard toward the camera; the in-plane spin lives in uRot so it
      // survives this.
      f.mesh.quaternion.copy(this.camera.quaternion)
      if (f.life <= 0) f.mesh.visible = false
    }
  }

  dispose() {
    for (const f of this.pool) {
      f.mesh.parent?.remove(f.mesh)
      f.mat.dispose()
      f.mesh.geometry.dispose()
    }
    this.pool = []
    this.placeholder.dispose()
    this.texture?.dispose()
  }
}

const IMPACT_VERT = /* glsl */ `
  uniform vec2 uOffset;
  uniform vec2 uScale;
  uniform float uRot;
  uniform float uAge;
  varying vec2 vUv;
  void main() {
    vUv = uOffset + uv * uScale;
    // Rotate the quad in its own (billboarded) plane to the blow direction.
    vec2 p = position.xy;
    float c = cos(uRot), s = sin(uRot);
    vec2 rp = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    // Blooms open a touch over its short life so the mark reads as struck-open,
    // not a static stamp.
    float grow = 1.0 + 0.18 * uAge;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(rp * grow, 0.0, 1.0);
  }
`

const IMPACT_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform vec3 uTint;
  uniform float uIntensity;
  uniform float uAge;
  varying vec2 vUv;
  void main() {
    vec4 tex = texture2D(uMap, vUv);
    // Held impact frame: quick rise, hold, then a clean release.
    float rise = smoothstep(0.0, 0.14, uAge);
    float out_ = 1.0 - smoothstep(0.45, 1.0, uAge);
    float a = tex.a * rise * out_;
    if (a < 0.004) discard;
    // The tint (channel-weighted, may exceed 1) owns the hue. tex.rgb is the
    // white drawn shape, so only the small hot core approaches white while the
    // spikes/halo stay chromatic under bloom.
    vec3 col = tex.rgb * uTint * uIntensity;
    gl_FragColor = vec4(col, a);
  }
`
