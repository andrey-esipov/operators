import * as THREE from 'three'
import { WORLD, type EngineContext, type QualityTier } from '../types'

/**
 * GPU particle pool.
 *
 * One InstancedMesh, one draw call, per-instance attributes updated on the CPU
 * only when particles are spawned; motion is integrated in the vertex shader
 * from (origin, velocity, birth) so the CPU cost per frame is a single uniform
 * write. This is what lets us throw thousands of sparks at a hit without the
 * frame budget noticing.
 *
 * Two integration models live in the vertex shader:
 *   - analytic drag (default): closed-form  v' = -drag*v + g
 *   - ballistic-bounce (mode 1): gravity-only parabola that reflects off the
 *     floor with restitution, unrolled for a few bounces. This is what makes
 *     debris skitter across the ground instead of sinking through it.
 *
 * Extra per-particle controls live in `aExtra`:
 *   x = stretch        velocity-aligned streak length (0 = round billboard)
 *   y = mode           0 analytic drag, 1 ballistic bounce
 *   z = restitution    floor bounciness for mode 1
 *   w = groundAlign    1 = lay the quad flat on the floor (dust/soot on ground)
 */

export type ParticleShape =
  | 'spark'
  | 'shard'
  | 'ember'
  | 'ring'
  | 'smoke'
  | 'streak'
  | 'debris'
  | 'flare'
  | 'dust'

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
  /** Bias the sphere/cone toward the horizontal plane (0=none, 1=flat disc). */
  flatten?: number
  color: THREE.Color
  color2?: THREE.Color
  size: number
  sizeVariance?: number
  life: number
  lifeVariance?: number
  gravity?: number
  drag?: number
  shape?: ParticleShape
  /** Emissive multiplier — drives how hard it blooms. */
  intensity?: number
  /** Initial spatial jitter around `position`. */
  jitter?: number
  /** Spin rate, radians/sec. */
  spin?: number
  /** Velocity-aligned stretch (tracer look). 0 = round. */
  stretch?: number
  /** Enable ballistic floor bouncing. */
  bounce?: boolean
  /** Floor bounciness, 0..1. */
  restitution?: number
  /** Floor plane the particle bounces on / lies on. Defaults to WORLD.GROUND_Y. */
  floorY?: number
  /** Lay the quad flat on the ground (soot, kicked dust). */
  groundAlign?: boolean
}

const SHAPE_ID: Record<ParticleShape, number> = {
  spark: 0,
  shard: 1,
  ember: 2,
  ring: 3,
  smoke: 4,
  streak: 5,
  debris: 6,
  flare: 7,
  dust: 8,
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
  private aExtra: THREE.InstancedBufferAttribute // stretch, mode, restitution, groundAlign
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
    this.aExtra = f(4)

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
    geo.setAttribute('aExtra', this.aExtra)

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1 },
        uFloorY: { value: WORLD.GROUND_Y },
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
    const flatten = o.flatten ?? 0
    const mode = o.bounce ? 1 : 0
    const stretch = o.stretch ?? (shape === 5 ? 4.2 : 0)
    const groundAlign = o.groundAlign ? 1 : 0
    const restitution = o.restitution ?? 0.42
    const floorY = o.floorY ?? WORLD.GROUND_Y

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
      if (flatten > 0) {
        vy *= 1 - flatten
        const rescale = 1 + flatten * 0.6
        vx *= rescale; vz *= rescale
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

      this.aExtra.array[i4] = stretch * (0.7 + Math.random() * 0.6)
      this.aExtra.array[i4 + 1] = mode
      this.aExtra.array[i4 + 2] = restitution
      this.aExtra.array[i4 + 3] = groundAlign
    }
    this.material.uniforms.uIntensity.value = o.intensity ?? 1
    this.material.uniforms.uFloorY.value = floorY
  }

  update(dt: number) {
    this.time += dt
    this.material.uniforms.uTime.value = this.time
    if (this.dirtyHi >= this.dirtyLo) {
      for (const a of [
        this.aOrigin, this.aVelocity, this.aBirth, this.aLife, this.aSize,
        this.aColor, this.aColor2, this.aParams, this.aExtra,
      ]) {
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
  attribute vec4  aExtra;  // stretch, mode, restitution, groundAlignEncoded

  uniform float uTime;
  uniform float uFloorY;

  varying vec2  vUv;
  varying vec3  vColor;
  varying float vAge;
  varying float vShape;
  varying float vSeed;
  varying float vGround;

  // Gravity-only parabola that reflects off the floor with restitution.
  // g is passed as a NEGATIVE downward accel (matches analytic model), so we
  // negate to a positive magnitude here.
  float bounceY(float y0, float vy, float gNeg, float t, float rest, float floorY) {
    float g = max(0.0001, -gNeg);
    float p = y0 - floorY;   // height above floor
    for (int i = 0; i < 4; i++) {
      float disc = vy * vy + 2.0 * g * p;
      if (disc <= 0.0) break;
      float tHit = (vy + sqrt(disc)) / g; // time to reach floor (downward root)
      if (tHit <= 0.0) break;
      if (t < tHit) {
        return floorY + p + vy * t - 0.5 * g * t * t;
      }
      t -= tHit;
      float vImpact = vy - g * tHit;      // downward velocity at floor (negative)
      vy = -vImpact * rest;               // reflect + damp
      p = 0.0;
      if (vy < 0.35) return floorY;       // settled
    }
    return floorY;
  }

  void main() {
    float age = (uTime - aBirth) / aLife;
    vAge = age;
    vShape = aParams.z;
    vSeed = aBirth * 13.37 + aSize * 91.7;
    vGround = aExtra.w > 0.5 ? 1.0 : 0.0;

    if (age < 0.0 || age > 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }

    float t = age * aLife;
    float drag = aParams.y;
    float grav = aParams.x;
    float mode = aExtra.y;

    // Position integration.
    vec3 p;
    if (mode > 0.5) {
      // Ballistic bounce: horizontal uses light drag, vertical bounces.
      float e = exp(-drag * t);
      p = aOrigin + aVelocity * (1.0 - e) / max(drag, 0.0001);
      p.y = bounceY(aOrigin.y, aVelocity.y, grav, t, aExtra.z, uFloorY);
    } else {
      float e = exp(-drag * t);
      p = aOrigin + aVelocity * (1.0 - e) / max(drag, 0.0001);
      p.y += grav * (t - (1.0 - e) / max(drag, 0.0001)) / max(drag, 0.0001);
    }

    vColor = mix(aColor, aColor2, smoothstep(0.0, 0.85, age));

    // Size curve: pop in, decay out.
    float grow = smoothstep(0.0, 0.06, age);
    float fade = 1.0 - smoothstep(0.55, 1.0, age);
    float size = aSize * grow * mix(1.0, 0.35, age);
    if (aParams.z > 2.5 && aParams.z < 3.5) size = aSize * (0.15 + age * 2.9);       // ring expands
    if (aParams.z > 3.5 && aParams.z < 4.5) size = aSize * (0.55 + age * 1.9);       // smoke expands
    if (aParams.z > 6.5 && aParams.z < 7.5) size = aSize * (0.3 + age * 3.4) * (1.0 - smoothstep(0.35,1.0,age)); // flare snaps out
    if (aParams.z > 7.5) size = aSize * (0.5 + age * 2.2);                            // dust spreads
    size *= max(fade, 0.0001);

    // Instantaneous velocity (for stretch orientation).
    float e2 = exp(-drag * t);
    vec3 vel = aVelocity * e2;

    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

    vec2 corner = position.xy;
    float stretch = aExtra.x;

    vec3 world;
    if (vGround > 0.5) {
      // Lay flat on the ground plane (XZ), no billboard.
      float ang = aParams.w * t;
      float c = cos(ang), s = sin(ang);
      vec2 cc = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
      world = vec3(p.x + cc.x * size, uFloorY + 0.02, p.z + cc.y * size);
    } else if (stretch > 0.01 && dot(vel, vel) > 0.0004) {
      // Velocity-aligned tracer: orient the quad's long axis along screen-space velocity.
      vec2 sv = vec2(dot(vel, right), dot(vel, up));
      float l = length(sv);
      vec2 dirn = l > 0.0001 ? sv / l : vec2(0.0, 1.0);
      vec2 perp = vec2(-dirn.y, dirn.x);
      float len = size * (1.0 + stretch * clamp(l * 0.14, 0.35, 1.0));
      vec2 off = dirn * corner.y * len + perp * corner.x * size;
      world = p + right * off.x + up * off.y;
    } else {
      float ang = aParams.w * t;
      float c = cos(ang), s = sin(ang);
      vec2 cc = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
      world = p + (right * cc.x + up * cc.y) * size;
    }

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
  varying float vGround;
  uniform float uIntensity;

  float hash(vec2 p){ p=fract(p*vec2(233.34,851.73)); p+=dot(p,p+23.45); return fract(p.x*p.y); }
  float noise(vec2 p){
    vec2 i=floor(p), f=fract(p);
    float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));
    vec2 u=f*f*(3.-2.*f);
    return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);
  }

  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d);
    float a = 0.0;
    float coreBoost = 1.0;

    if (vShape < 0.5) {
      // spark: hot core + tight halo
      a = smoothstep(0.5, 0.02, r);
      a = pow(a, 1.35);
      coreBoost = 2.4;
    } else if (vShape < 1.5) {
      // shard: hard-edged diamond
      float dm = abs(d.x) + abs(d.y);
      a = 1.0 - smoothstep(0.30, 0.40, dm);
      coreBoost = 1.6;
    } else if (vShape < 2.5) {
      // ember: small, very hot, flickering
      a = smoothstep(0.42, 0.0, r);
      a *= 0.55 + 0.45 * hash(vec2(vSeed, floor(vAge * 46.0)));
      coreBoost = 2.6;
    } else if (vShape < 3.5) {
      // ring: bright leading rim with a soft trailing wash
      float rim = smoothstep(0.5, 0.45, r) - smoothstep(0.45, 0.30, r);
      float inner = smoothstep(0.45, 0.0, r) * 0.12;
      a = max(rim, 0.0) * 2.6 + inner;
      coreBoost = 1.4;
    } else if (vShape < 4.5) {
      // smoke: soft, billowy, fbm-ish
      float n = noise(vUv * 4.0 + vSeed) * 0.6 + noise(vUv * 9.0 - vSeed) * 0.4;
      float body = smoothstep(0.5, 0.02, r);
      a = body * (0.35 + n * 0.75) * 0.6;
      coreBoost = 0.0;
    } else if (vShape < 5.5) {
      // streak: sharp tracer line
      a = smoothstep(0.5, 0.0, abs(d.x) * 2.6) * smoothstep(0.5, 0.02, abs(d.y));
      coreBoost = 2.2;
    } else if (vShape < 6.5) {
      // debris: solid angular chunk with a hot edge
      float dm = max(abs(d.x), abs(d.y) * 0.72);
      a = 1.0 - smoothstep(0.30, 0.36, dm);
      coreBoost = 0.4;
    } else if (vShape < 7.5) {
      // flare: 4-point + 8-point star burst (the "hit spark")
      float ang = atan(d.y, d.x);
      float star4 = pow(max(0.0, cos(ang * 2.0)), 20.0) + pow(max(0.0, sin(ang * 2.0)), 20.0);
      float star8 = pow(max(0.0, cos(ang * 4.0)), 16.0) * 0.5;
      float core = smoothstep(0.5, 0.0, r);
      float spikes = (star4 + star8) * smoothstep(0.5, 0.0, r) ;
      a = clamp(core * 0.9 + spikes * 1.4, 0.0, 3.0);
      coreBoost = 3.0;
    } else {
      // dust (ground): soft, grainy, flat
      float n = noise(vUv * 5.0 + vSeed);
      a = smoothstep(0.5, 0.05, r) * (0.4 + n * 0.6) * 0.7;
      coreBoost = 0.0;
    }

    float fade = 1.0 - smoothstep(0.55, 1.0, vAge);
    a *= fade;
    if (a < 0.004) discard;

    vec3 col = vColor * uIntensity;
    // Incandescent hot centre so it reads as burning under bloom. Tinted 35%
    // toward the particle's own colour so flavour identity survives the bloom.
    col += mix(vec3(1.0), vColor * 1.5, 0.35) * pow(max(0.0, 1.0 - r * 2.4), 3.0) * (1.0 - vAge) * coreBoost;

    gl_FragColor = vec4(col, a);
  }
`

/** Convenience factory sized to the quality tier. */
export function createPools(ctx: EngineContext, budget: number) {
  const additive = new ParticlePool(Math.floor(budget * 0.72), true)
  const alpha = new ParticlePool(Math.floor(budget * 0.28), false)
  ctx.scene.add(additive.mesh, alpha.mesh)
  return { additive, alpha }
}

export function budgetFor(q: QualityTier): number {
  switch (q) {
    case 'low': return 700
    case 'medium': return 2000
    case 'high': return 4500
    case 'ultra': return 9000
  }
}
