import * as THREE from 'three'
import { WORLD, type EngineContext, type QualityTier } from '../types'

/**
 * Ground decals.
 *
 * Flat, floor-aligned effects that sell the hit as a physical event grounded
 * in the arena:
 *   - shock rings: a bright ring that races outward across the floor
 *   - scorch:      a dark burn that blooms in and lingers, then fades
 *
 * A tiny pool of camera-independent quads laid on the ground plane. Cheap, but
 * they add the "the floor reacted" beat that additive sprites can never give.
 */

type DecalKind = 'ring' | 'scorch'

interface Decal {
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
  life: number
  max: number
  kind: DecalKind
}

export class Decals {
  private pool: Decal[] = []
  private cursor = 0
  private scene: THREE.Scene
  private enabled = true

  constructor(ctx: EngineContext) {
    this.scene = ctx.scene
    const n = 10
    const geo = new THREE.PlaneGeometry(1, 1)
    for (let i = 0; i < n; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uAge: { value: 1 },
          uColor: { value: new THREE.Color(0xffffff) },
          uColor2: { value: new THREE.Color(0xff7a1a) },
          uKind: { value: 0 },
          uIntensity: { value: 1 },
          uSeed: { value: Math.random() * 10 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
        `,
        fragmentShader: DECAL_FRAG,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.rotation.x = -Math.PI / 2
      mesh.frustumCulled = false
      mesh.renderOrder = 12
      mesh.visible = false
      this.scene.add(mesh)
      this.pool.push({ mesh, mat, life: 0, max: 1, kind: 'ring' })
    }
    this.configure(ctx.quality)
  }

  configure(q: QualityTier) {
    this.enabled = q !== 'low'
  }

  spawn(
    kind: DecalKind,
    pos: THREE.Vector3,
    radius: number,
    duration: number,
    color: THREE.Color,
    color2: THREE.Color,
    intensity = 1,
  ) {
    if (!this.enabled) return
    const d = this.pool[this.cursor]
    this.cursor = (this.cursor + 1) % this.pool.length
    d.kind = kind
    d.life = duration
    d.max = duration
    d.mesh.position.set(pos.x, WORLD.GROUND_Y + (kind === 'scorch' ? 0.012 : 0.02), pos.z)
    d.mesh.scale.setScalar(radius * 2)
    d.mat.uniforms.uColor.value.copy(color)
    d.mat.uniforms.uColor2.value.copy(color2)
    d.mat.uniforms.uKind.value = kind === 'ring' ? 0 : 1
    d.mat.uniforms.uIntensity.value = intensity
    d.mat.uniforms.uSeed.value = Math.random() * 10
    d.mat.uniforms.uAge.value = 0
    d.mat.blending = kind === 'ring' ? THREE.AdditiveBlending : THREE.NormalBlending
    d.mat.needsUpdate = true
    d.mesh.visible = true
  }

  update(dt: number) {
    for (const d of this.pool) {
      if (d.life <= 0) continue
      d.life = Math.max(0, d.life - dt)
      d.mat.uniforms.uAge.value = 1 - d.life / d.max
      if (d.life <= 0) d.mesh.visible = false
    }
  }

  dispose() {
    for (const d of this.pool) {
      d.mesh.parent?.remove(d.mesh)
      d.mat.dispose()
      d.mesh.geometry.dispose()
    }
    this.pool = []
  }
}

const DECAL_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uAge;      // 0..1
  uniform vec3  uColor;
  uniform vec3  uColor2;
  uniform float uKind;     // 0 ring, 1 scorch
  uniform float uIntensity;
  uniform float uSeed;

  float hash(vec2 p){ p=fract(p*vec2(233.34,851.73)); p+=dot(p,p+23.45); return fract(p.x*p.y); }
  float noise(vec2 p){
    vec2 i=floor(p), f=fract(p);
    float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));
    vec2 u=f*f*(3.-2.*f);
    return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
  }

  void main(){
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0; // 0 centre .. 1 edge
    float ang = atan(d.y, d.x);

    if (uKind < 0.5) {
      // Shock ring racing outward across the floor.
      float edge = uAge;                       // ring radius grows to 1
      float w = mix(0.16, 0.05, uAge);         // thins as it expands
      float ring = smoothstep(w, 0.0, abs(r - edge));
      // ragged leading edge
      float ragged = 0.75 + 0.25 * noise(vec2(ang * 3.0, uSeed));
      float fade = 1.0 - smoothstep(0.4, 1.0, uAge);
      float a = ring * ragged * fade;
      vec3 col = mix(uColor, uColor2, r) * uIntensity * (1.0 + 2.0 * ring);
      if (a < 0.004) discard;
      gl_FragColor = vec4(col, a * 0.9);
    } else {
      // Scorch: blooms in fast, lingers, fades slowly.
      float grow = smoothstep(0.0, 0.12, uAge);
      float linger = 1.0 - smoothstep(0.55, 1.0, uAge);
      float body = smoothstep(0.5, 0.0, r * 0.5);
      float n = noise(vUv * 6.0 + uSeed) * 0.6 + noise(vUv * 13.0 - uSeed) * 0.4;
      float burn = body * (0.5 + n * 0.7);
      // glowing embers at the centre early on
      float glow = smoothstep(0.35, 0.0, r) * (1.0 - smoothstep(0.0, 0.35, uAge));
      float a = burn * grow * linger;
      vec3 soot = vec3(0.02, 0.015, 0.02);
      vec3 col = mix(soot, uColor2 * 0.4, glow);
      col += uColor * glow * 2.5;
      if (a < 0.006) discard;
      gl_FragColor = vec4(col, clamp(a, 0.0, 0.9));
    }
  }
`
