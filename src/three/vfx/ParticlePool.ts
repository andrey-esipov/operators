import * as THREE from 'three'
import type { EngineContext, QualityTier } from '../types'

/**
 * GPU particle pool.
 *
 * One InstancedMesh, one draw call, per-instance attributes updated on the CPU
 * only when particles are spawned; motion is integrated in the vertex shader
 * from (origin, velocity, birth) so the CPU cost per frame is a single uniform
 * write. This is what lets us throw thousands of sparks at a hit without the
 * frame budget noticing.
 */

export type ParticleShape = 'spark' | 'shard' | 'ember' | 'ring' | 'smoke' | 'streak'

export interface EmitOptions {
  position: THREE.Vector3
  count: number
  /** Base speed, world units/sec. */
  speed: number
  speedVariance?: number
  /** Cone direction; omit for a full sphere. */
  direction?: THREE.Vector3
  /** Cone half-angle in radians (only with `direction`). */
  spread?: number
  color: THREE.Color
  color2?: THREE.Color
  size: number
  sizeVariance?: number
  life: number
  lifeVariance?: number
  gravity?: number
  drag?: number
  shape?: ParticleShape
  /** Additive vs alpha blending. */
  additive?: boolean
  /** Emissive multiplier — drives how hard it blooms. */
  intensity?: number
  /** Initial spatial jitter around `position`. */
  jitter?: number
  /** Spin rate, radians/sec. */
  spin?: number
}

const SHAPE_ID: Record<ParticleShape, number> = {
  spark: 0, shard: 1, ember: 2, ring: 3, smoke: 4, streak: 5,
}

export class ParticlePool {
  readonly mesh: THREE.InstancedMesh
  private capacity: number
  private cursor = 0
  private time = 0

  private aOrigin: THREE.InstancedBufferAttribute
  private aVelocity: THREE.InstancedBufferAttribute
  private aBirth: THREE.InstancedBufferAttribute
  private aLife: THREE.InstancedBufferAttribute
  private aSize: THREE.InstancedBufferAttribute
  private aColor: THREE.InstancedBufferAttribute
  private aColor2: THREE.InstancedBufferAttribute
  private aParams: THREE.InstancedBufferAttribute // gravity, drag, shape, spin
  private material: THREE.ShaderMaterial

  private dirtyLo = Infinity
  private dirtyHi = -Infinity

  constructor(capacity: number, additive: boolean) {
    this.capacity = capacity

    const geo = new THREE.InstancedBufferGeometry()
    const quad = new THREE.PlaneGeometry(1, 1)
    geo.index = quad.index
    geo.attributes.position = quad.attributes.position
    geo.attributes.uv = quad.attributes.uv
    geo.instanceCount = capacity

    const f = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n)
    this.aOrigin = f(3)
    this.aVelocity = f(3)
    this.aBirth = f(1)
    this.aLife = f(1)
    this.aSize = f(1)
    this.aColor = f(3)
    this.aColor2 = f(3)
    this.aParams = f(4)

    // Park every particle in the past so nothing renders until it's emitted.
    for (let i = 0; i < capacity; i++) {
      this.aBirth.array[i] = -1e6
      this.aLife.array[i] = 0.0001
    }

    geo.setAttribute('aOrigin', this.aOrigin)
    geo.setAttribute('aVelocity', this.aVelocity)
    geo.setAttribute('aBirth', this.aBirth)
    geo.setAttribute('aLife', this.aLife)
    geo.setAttribute('aSize', this.aSize)
    geo.setAttribute('aColor', this.aColor)
    geo.setAttribute('aColor2', this.aColor2)
    geo.setAttribute('aParams', this.aParams)

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
    })

    this.mesh = new THREE.InstancedMesh(geo, this.material, capacity)
    this.mesh.frustumCulled = false
    this.mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    this.mesh.renderOrder = 20
  }

  emit(o: EmitOptions) {
    const dir = o.direction?.clone().normalize()
    const spread = o.spread ?? Math.PI
    const jitter = o.jitter ?? 0
    const shape = SHAPE_ID[o.shape ?? 'spark']
    const c2 = o.color2 ?? o.color

    for (let n = 0; n < o.count; n++) {
      const i = this.cursor
      this.cursor = (this.cursor + 1) % this.capacity
      if (i < this.dirtyLo) this.dirtyLo = i
      if (i > this.dirtyHi) this.dirtyHi = i

      const i3 = i * 3
      const i4 = i * 4

      this.aOrigin.array[i3] = o.position.x + (Math.random() - 0.5) * jitter
      this.aOrigin.array[i3 + 1] = o.position.y + (Math.random() - 0.5) * jitter
      this.aOrigin.array[i3 + 2] = o.position.z + (Math.random() - 0.5) * jitter

      let vx: number, vy: number, vz: number
      if (dir) {
        // Sample inside a cone around `dir`.
        const cosA = Math.cos(spread)
        const z = cosA + Math.random() * (1 - cosA)
        const phi = Math.random() * Math.PI * 2
        const r = Math.sqrt(Math.max(0, 1 - z * z))
        const local = new THREE.Vector3(r * Math.cos(phi), r * Math.sin(phi), z)
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir)
        local.applyQuaternion(q)
        vx = local.x; vy = local.y; vz = local.z
      } else {
        const u = Math.random() * 2 - 1
        const phi = Math.random() * Math.PI * 2
        const r = Math.sqrt(Math.max(0, 1 - u * u))
        vx = r * Math.cos(phi); vy = r * Math.sin(phi); vz = u
      }
      const sp = o.speed * (1 + (Math.random() - 0.5) * 2 * (o.speedVariance ?? 0.4))
      this.aVelocity.array[i3] = vx * sp
      this.aVelocity.array[i3 + 1] = vy * sp
      this.aVelocity.array[i3 + 2] = vz * sp

      this.aBirth.array[i] = this.time
      this.aLife.array[i] = Math.max(0.02, o.life * (1 + (Math.random() - 0.5) * 2 * (o.lifeVariance ?? 0.35)))
      this.aSize.array[i] = Math.max(0.002, o.size * (1 + (Math.random() - 0.5) * 2 * (o.sizeVariance ?? 0.45)))

      this.aColor.array[i3] = o.color.r
      this.aColor.array[i3 + 1] = o.color.g
      this.aColor.array[i3 + 2] = o.color.b
      this.aColor2.array[i3] = c2.r
      this.aColor2.array[i3 + 1] = c2.g
      this.aColor2.array[i3 + 2] = c2.b

      this.aParams.array[i4] = o.gravity ?? -9.0
      this.aParams.array[i4 + 1] = o.drag ?? 1.6
      this.aParams.array[i4 + 2] = shape
      this.aParams.array[i4 + 3] = (o.spin ?? 4) * (Math.random() < 0.5 ? -1 : 1)
    }
    this.material.uniforms.uIntensity.value = o.intensity ?? 1
  }

  update(dt: number) {
    this.time += dt
    this.material.uniforms.uTime.value = this.time
    if (this.dirtyHi >= this.dirtyLo) {
      // `postprocessing` + three both honour updateRanges; upload only the
      // slice we touched this frame.
      for (const a of [this.aOrigin, this.aVelocity, this.aBirth, this.aLife, this.aSize, this.aColor, this.aColor2, this.aParams]) {
        a.needsUpdate = true
      }
      this.dirtyLo = Infinity
      this.dirtyHi = -Infinity
    }
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.mesh.parent?.remove(this.mesh)
  }
}

const PARTICLE_VERT = /* glsl */ `
  precision highp float;

  attribute vec3  aOrigin;
  attribute vec3  aVelocity;
  attribute float aBirth;
  attribute float aLife;
  attribute float aSize;
  attribute vec3  aColor;
  attribute vec3  aColor2;
  attribute vec4  aParams; // gravity, drag, shape, spin

  uniform float uTime;

  varying vec2  vUv;
  varying vec3  vColor;
  varying float vAge;
  varying float vShape;
  varying float vSeed;

  void main() {
    float age = (uTime - aBirth) / aLife;
    vAge = age;
    vShape = aParams.z;
    vSeed = aBirth * 13.37 + aSize * 91.7;

    if (age < 0.0 || age > 1.0) {
      // Cull: collapse the quad to a degenerate point off-screen.
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    float t = age * aLife;
    float drag = aParams.y;
    // Analytic integration of  v' = -drag*v + g
    float e = exp(-drag * t);
    vec3 p = aOrigin + aVelocity * (1.0 - e) / max(drag, 0.0001);
    p.y += aParams.x * (t - (1.0 - e) / max(drag, 0.0001)) / max(drag, 0.0001);

    vColor = mix(aColor, aColor2, smoothstep(0.0, 0.85, age));

    // Size curve: pop in, decay out.
    float grow = smoothstep(0.0, 0.08, age);
    float fade = 1.0 - smoothstep(0.55, 1.0, age);
    float size = aSize * grow * mix(1.0, 0.35, age);
    if (aParams.z > 2.5 && aParams.z < 3.5) size = aSize * (0.2 + age * 2.6); // ring expands
    if (aParams.z > 3.5 && aParams.z < 4.5) size = aSize * (0.6 + age * 1.8); // smoke expands
    size *= max(fade, 0.0001);

    // Camera-facing billboard with per-particle spin.
    float ang = aParams.w * t;
    float c = cos(ang), s = sin(ang);
    vec2 corner = position.xy;
    corner = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);

    // Streaks stretch along their velocity.
    if (aParams.z > 4.5) {
      corner.y *= 4.2;
    }

    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 world = p + (right * corner.x + up * corner.y) * size;

    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`

const PARTICLE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2  vUv;
  varying vec3  vColor;
  varying float vAge;
  varying float vShape;
  varying float vSeed;
  uniform float uIntensity;

  float hash(vec2 p){ p=fract(p*vec2(233.34,851.73)); p+=dot(p,p+23.45); return fract(p.x*p.y); }

  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d);
    float a = 0.0;

    if (vShape < 0.5) {
      // spark: hot core + soft halo
      a = smoothstep(0.5, 0.06, r);
      a = pow(a, 1.5);
    } else if (vShape < 1.5) {
      // shard: hard-edged diamond
      float dm = abs(d.x) + abs(d.y);
      a = 1.0 - smoothstep(0.34, 0.42, dm);
    } else if (vShape < 2.5) {
      // ember: small, very hot
      a = smoothstep(0.42, 0.0, r);
      a *= 0.6 + 0.4 * hash(vec2(vSeed, floor(vAge * 40.0)));
    } else if (vShape < 3.5) {
      // ring: thin annulus
      a = smoothstep(0.5, 0.44, r) - smoothstep(0.44, 0.36, r);
      a = max(a, 0.0) * 2.4;
    } else if (vShape < 4.5) {
      // smoke: soft, noisy
      float n = hash(floor(vUv * 9.0) + vSeed);
      a = smoothstep(0.5, 0.05, r) * (0.55 + n * 0.45) * 0.5;
    } else {
      // streak
      a = smoothstep(0.5, 0.0, abs(d.x) * 3.0) * smoothstep(0.5, 0.05, abs(d.y));
    }

    float fade = 1.0 - smoothstep(0.6, 1.0, vAge);
    a *= fade;
    if (a < 0.004) discard;

    // Hot core: whiten the centre so it reads as incandescent under bloom.
    vec3 col = vColor * uIntensity;
    col += vec3(1.0) * pow(max(0.0, 1.0 - r * 2.6), 3.0) * (1.0 - vAge) * 1.6;

    gl_FragColor = vec4(col, a);
  }
`

/** Convenience factory sized to the quality tier. */
export function createPools(ctx: EngineContext, budget: number) {
  const additive = new ParticlePool(Math.floor(budget * 0.75), true)
  const alpha = new ParticlePool(Math.floor(budget * 0.25), false)
  ctx.scene.add(additive.mesh, alpha.mesh)
  return { additive, alpha }
}

export function budgetFor(q: QualityTier): number {
  switch (q) {
    case 'low': return 500
    case 'medium': return 1500
    case 'high': return 3500
    case 'ultra': return 7000
  }
}
