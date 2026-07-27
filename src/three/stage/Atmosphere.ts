import * as THREE from 'three'

/**
 * Atmosphere — the volume between the camera and the set.
 *
 * `DustField` is a real 3D point cloud (not a screen-space shader) so it
 * parallaxes correctly as the camera moves, giving honest depth cues. Motes
 * near the camera are large and soft; distant ones are tiny. They drift and
 * twinkle so the air is never dead.
 *
 * `groundFog` is a stack of soft planes hugging the floor that catch the rim
 * light and dissolve the hard line where geometry meets the ground — the thing
 * that makes an arena feel like it has atmosphere instead of a cut-out floor.
 */

export class DustField {
  readonly points: THREE.Points
  private velocities: Float32Array
  private basePos: Float32Array
  private bounds: THREE.Vector3
  private count: number

  constructor(count: number, bounds: THREE.Vector3, color: number, size = 0.09) {
    this.count = count
    this.bounds = bounds
    const pos = new Float32Array(count * 3)
    const rnd = new Float32Array(count)
    this.velocities = new Float32Array(count * 3)
    this.basePos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * bounds.x
      const y = Math.random() * bounds.y
      const z = -bounds.z * 0.5 + Math.random() * bounds.z
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z
      this.basePos[i * 3] = x; this.basePos[i * 3 + 1] = y; this.basePos[i * 3 + 2] = z
      this.velocities[i * 3] = (Math.random() - 0.5) * 0.08
      this.velocities[i * 3 + 1] = 0.02 + Math.random() * 0.06
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.05
      rnd[i] = Math.random()
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1))

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uSize: { value: size },
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float aRnd;
        uniform float uSize; uniform float uTime; uniform float uPixelRatio;
        varying float vTw;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          float dist = -mv.z;
          vTw = 0.5 + 0.5*sin(uTime*(1.5+aRnd*3.0) + aRnd*30.0);
          gl_PointSize = uSize * (300.0/dist) * uPixelRatio * (0.5+aRnd);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float; varying float vTw; uniform vec3 uColor;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          float a = smoothstep(0.5, 0.0, r);
          a *= a;
          gl_FragColor = vec4(uColor*(0.6+vTw*0.8), a*vTw*0.7);
        }
      `,
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 3
  }

  setColor(color: number) {
    ;(this.points.material as THREE.ShaderMaterial).uniforms.uColor.value.setHex(color)
  }
  setPixelRatio(r: number) {
    ;(this.points.material as THREE.ShaderMaterial).uniforms.uSize.value // noop guard
    ;(this.points.material as THREE.ShaderMaterial).uniforms.uPixelRatio.value = r
  }

  update(t: number, dt: number, drift: number) {
    const mat = this.points.material as THREE.ShaderMaterial
    mat.uniforms.uTime.value = t
    const attr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    for (let i = 0; i < this.count; i++) {
      arr[i * 3] += this.velocities[i * 3] * dt * drift
      arr[i * 3 + 1] += this.velocities[i * 3 + 1] * dt * drift
      arr[i * 3 + 2] += this.velocities[i * 3 + 2] * dt * drift
      // gentle sine sway so motion isn't linear
      arr[i * 3] += Math.sin(t * 0.5 + i) * 0.0015 * drift
      if (arr[i * 3 + 1] > this.bounds.y) {
        arr[i * 3] = this.basePos[i * 3] + (Math.random() - 0.5) * 2
        arr[i * 3 + 1] = 0
        arr[i * 3 + 2] = this.basePos[i * 3 + 2] + (Math.random() - 0.5) * 2
      }
    }
    attr.needsUpdate = true
  }

  dispose() {
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
  }
}

/** Soft glowing fog planes hugging the ground. Returns a group + updater. */
export function groundFog(color: number, extent: number): { group: THREE.Group; update: (t: number) => void } {
  const group = new THREE.Group()
  const mats: THREE.ShaderMaterial[] = []
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      fog: false,
      toneMapped: false,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uTime: { value: 0 },
        uSeed: { value: i * 4.1 },
        uOpacity: { value: 0.26 - i * 0.05 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: /* glsl */ `
        precision highp float; varying vec2 vUv;
        uniform vec3 uColor; uniform float uTime; uniform float uSeed; uniform float uOpacity;
        float hash(vec2 p){ p=fract(p*vec2(233.34,851.73)); p+=dot(p,p+23.45); return fract(p.x*p.y); }
        float n(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){s+=a*n(p);p*=2.02;a*=.5;} return s; }
        void main(){
          vec2 p = vUv*vec2(4.0,2.0) + vec2(uTime*0.03+uSeed, uSeed);
          float f = fbm(p);
          f *= fbm(p*2.0 - vec2(uTime*0.05,0.0));
          float band = smoothstep(0.0,0.45,vUv.y)*smoothstep(1.0,0.55,vUv.y);
          float a = f * band * uOpacity;
          gl_FragColor = vec4(uColor, a);
        }
      `,
    })
    mats.push(mat)
    const m = new THREE.Mesh(new THREE.PlaneGeometry(extent, 5.5), mat)
    m.position.set(0, 1.4, -6 + i * 4.5)
    m.renderOrder = 4 + i
    group.add(m)
  }
  // Far atmospheric haze bands — tall, faint, ADDITIVE glow sheets standing at
  // the background-architecture depth so the far layer dissolves into luminous
  // fog instead of butting hard against the backdrop (atmospheric perspective).
  for (let i = 0; i < 2; i++) {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uTime: { value: 0 },
        uSeed: { value: 7.3 + i * 3.7 },
        uOpacity: { value: 0.12 - i * 0.04 },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: /* glsl */ `
        precision highp float; varying vec2 vUv;
        uniform vec3 uColor; uniform float uTime; uniform float uSeed; uniform float uOpacity;
        float hash(vec2 p){ p=fract(p*vec2(233.34,851.73)); p+=dot(p,p+23.45); return fract(p.x*p.y); }
        float n(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){s+=a*n(p);p*=2.02;a*=.5;} return s; }
        void main(){
          vec2 p = vUv*vec2(3.0,1.6) + vec2(uTime*0.02+uSeed, uSeed*0.5);
          float f = fbm(p)*0.6 + 0.4;
          // dense at the base, dissolving upward — a ground-hugging light fog
          float band = smoothstep(1.0,0.15,vUv.y);
          float a = f * band * uOpacity;
          gl_FragColor = vec4(uColor, a);
        }
      `,
    })
    mats.push(mat)
    const m = new THREE.Mesh(new THREE.PlaneGeometry(extent * 1.1, 9), mat)
    m.position.set(0, 3.4, -11 - i * 3.5)
    m.renderOrder = 3
    group.add(m)
  }
  return {
    group,
    update: (t) => { for (const m of mats) m.uniforms.uTime.value = t },
  }
}
