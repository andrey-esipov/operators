import * as THREE from 'three'

/**
 * Procedural set-dressing kit.
 *
 * Rather than ship eight bespoke 3D scenes, we ship a modular kit — towers,
 * racks, gantries, animated screens, overhead trusses, banners, crowd bands,
 * LED strips, foreground occluders — and each arena is *composed* from the kit
 * with its own palette, silhouette and animated "life". That keeps eight
 * distinct, memorable stages maintainable while still reading as real,
 * light-catching geometry rather than a painted backdrop.
 *
 * Structural geometry uses `MeshStandardMaterial`, so it is lit and shadowed by
 * the shared LightRig automatically — the same key/rim/fill that hits the
 * fighters hits the world, which is most of what sells "they are in this room".
 * Screens / LEDs / shafts use additive custom shaders for self-lit glow.
 */

type Updater = (t: number, dt: number) => void

export class StageBuild {
  readonly root = new THREE.Group()
  readonly animated: Updater[] = []
  readonly disposables: { dispose(): void }[] = []
  /** Meshes that should be hidden while the reflection pass renders (cheap). */
  readonly reflectSkip: THREE.Object3D[] = []

  add(o: THREE.Object3D) {
    this.root.add(o)
    return o
  }
  onUpdate(fn: Updater) {
    this.animated.push(fn)
  }
  track(d: { dispose(): void }) {
    this.disposables.push(d)
  }

  update(t: number, dt: number) {
    for (const fn of this.animated) fn(t, dt)
  }

  dispose() {
    for (const d of this.disposables) d.dispose()
    this.root.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose?.()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
    this.root.parent?.remove(this.root)
  }
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export function structureMat(opts: {
  color: number
  roughness?: number
  metalness?: number
  emissive?: number
  emissiveIntensity?: number
}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: opts.color,
    roughness: opts.roughness ?? 0.72,
    metalness: opts.metalness ?? 0.35,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  })
}

/** Additive self-lit material used for glowing tubes / trims / practicals. */
export function glowMat(color: number, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  })
}

// ---------------------------------------------------------------------------
// Animated screen panel
// ---------------------------------------------------------------------------

export type ScreenMode = 'data' | 'ticker' | 'ekg' | 'equalizer' | 'grid' | 'alert' | 'crowd' | 'neural'

const SCREEN_SHADER = {
  vertex: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv=uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragment: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    uniform vec3 uColor;
    uniform vec3 uColor2;
    uniform float uMode;
    uniform float uBright;
    uniform float uSeed;

    float hash(vec2 p){ p=fract(p*vec2(233.34,851.73)); p+=dot(p,p+23.45); return fract(p.x*p.y); }
    float hash1(float x){ return fract(sin(x*127.1+uSeed)*43758.5453); }

    void main(){
      vec2 uv = vUv;
      vec3 col = vec3(0.0);
      float m = uMode;

      if (m < 0.5) {
        // data: scrolling rows of blocky readouts
        vec2 g = vec2(uv.x*14.0, uv.y*22.0 - uTime*1.3);
        vec2 id = floor(g);
        float on = step(0.45, hash(id + floor(uTime*2.0)*0.13));
        float cell = step(0.12, fract(g.x)) * step(0.2, fract(g.y));
        col = uColor * on * cell;
        col += uColor2 * step(0.98, fract(uv.y*8.0 - uTime*0.5)) * 0.5;
      } else if (m < 1.5) {
        // ticker: horizontal running numbers + up/down bars
        float row = floor(uv.y*6.0);
        float scroll = fract(uv.x*10.0 - uTime*(0.6+row*0.1) - hash1(row));
        float tick = step(0.5, hash(vec2(floor(uv.x*40.0 - uTime*4.0), row)));
        float up = hash1(row) > 0.5 ? 1.0 : 0.0;
        vec3 c = mix(uColor2, uColor, up);
        col = c * tick * step(0.1, fract(uv.y*6.0)) * scroll;
      } else if (m < 2.5) {
        // ekg / flatline heartbeat
        float x = fract(uv.x - uTime*0.18);
        float beat = exp(-pow((x-0.5)*40.0,2.0))* (0.5+0.5*sin(uTime*6.0));
        float line = 0.5 + beat*0.35 - 0.02*sin(x*120.0);
        float d = abs(uv.y - line);
        col = uColor * smoothstep(0.02, 0.0, d);
        col += uColor*0.06;
        col += uColor2 * step(0.985, fract(uv.x*30.0)) * 0.15;
      } else if (m < 3.5) {
        // equalizer bars
        float bars = 26.0;
        float bx = floor(uv.x*bars);
        float h = 0.2 + 0.75*abs(sin(bx*1.7 + uTime*3.0 + hash1(bx)*6.28));
        float b = step(uv.y, h) * step(0.1, fract(uv.x*bars));
        col = mix(uColor2, uColor, uv.y) * b;
      } else if (m < 4.5) {
        // grid / schematic
        vec2 g = abs(fract(uv*vec2(18.0,12.0))-0.5);
        float line = smoothstep(0.46,0.5,max(g.x,g.y));
        float sweep = smoothstep(0.03,0.0, abs(fract(uv.x - uTime*0.1)-0.5));
        col = uColor*line*0.5 + uColor2*sweep;
      } else if (m < 5.5) {
        // alert: pulsing warning bands
        float band = step(0.5, fract(uv.y*7.0 + uTime*0.6));
        float flash = 0.5+0.5*sin(uTime*8.0);
        col = mix(uColor*0.15, uColor, band) * (0.4+0.6*flash);
        col += uColor2 * step(0.97, fract(uv.x*3.0)) ;
      } else if (m < 6.5) {
        // crowd: shimmering mass of little lights
        vec2 g = floor(uv*vec2(60.0,34.0));
        float tw = hash(g + floor(uTime*3.0));
        float on = step(0.6, tw);
        col = mix(uColor2, uColor, hash(g)) * on * (0.6+0.4*sin(uTime*4.0+g.x));
      } else {
        // neural: flowing node network
        vec2 p = uv*vec2(8.0,6.0);
        float n = 0.0;
        for (int i=0;i<4;i++){
          float fi=float(i);
          vec2 c = vec2(hash1(fi)*8.0, 3.0+2.0*sin(uTime*0.5+fi));
          n += 0.04/(0.02+length(p-c));
        }
        float flow = 0.5+0.5*sin(p.x*2.0 - uTime*2.0 + p.y);
        col = uColor*clamp(n,0.0,1.0) + uColor2*flow*0.15;
      }

      // scanlines + vignette so panels read as real emissive displays
      col *= 0.82 + 0.18*sin(uv.y*380.0);
      float vig = smoothstep(1.15,0.35,length(uv-0.5));
      col *= vig;
      col *= uBright;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}

export function makeScreen(
  w: number,
  h: number,
  mode: ScreenMode,
  color: number,
  color2: number,
  bright = 1,
  seed = 0,
): { mesh: THREE.Mesh; mat: THREE.ShaderMaterial } {
  const modeIndex: Record<ScreenMode, number> = {
    data: 0, ticker: 1, ekg: 2, equalizer: 3, grid: 4, alert: 5, crowd: 6, neural: 7,
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
      uColor2: { value: new THREE.Color(color2) },
      uMode: { value: modeIndex[mode] },
      uBright: { value: bright },
      uSeed: { value: seed },
    },
    vertexShader: SCREEN_SHADER.vertex,
    fragmentShader: SCREEN_SHADER.fragment,
    fog: false,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
  return { mesh, mat }
}

// ---------------------------------------------------------------------------
// Structural builders
// ---------------------------------------------------------------------------

/** A lattice truss beam (box + diagonal cross-bracing) — arena rig feel. */
export function trussBeam(length: number, size: number, color: number): THREE.Group {
  const g = new THREE.Group()
  const mat = structureMat({ color, roughness: 0.55, metalness: 0.7 })
  const chordGeo = new THREE.BoxGeometry(length, size * 0.14, size * 0.14)
  for (const [y, z] of [[size / 2, size / 2], [size / 2, -size / 2], [-size / 2, size / 2], [-size / 2, -size / 2]] as [number, number][]) {
    const c = new THREE.Mesh(chordGeo, mat)
    c.position.set(0, y, z)
    c.castShadow = true
    g.add(c)
  }
  const n = Math.max(2, Math.round(length / (size * 1.1)))
  const braceGeo = new THREE.BoxGeometry(size * 0.08, size * 1.32, size * 0.08)
  for (let i = 0; i <= n; i++) {
    const x = -length / 2 + (i / n) * length
    const b = new THREE.Mesh(braceGeo, mat)
    b.position.set(x, 0, 0)
    b.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.6
    g.add(b)
    const b2 = new THREE.Mesh(braceGeo, mat)
    b2.position.set(x, 0, 0)
    b2.rotation.x = (i % 2 === 0 ? 1 : -1) * 0.6
    g.add(b2)
  }
  return g
}

/** A stage spotlight can (body + glowing lens) hung on a truss. */
export function spotCan(color: number, size = 0.5): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.5, size * 0.6, size, 12),
    structureMat({ color: 0x0a0a0f, roughness: 0.5, metalness: 0.8 }),
  )
  body.castShadow = true
  const lens = new THREE.Mesh(new THREE.CircleGeometry(size * 0.46, 16), glowMat(color, 0.95))
  lens.position.y = -size * 0.5 - 0.001
  lens.rotation.x = Math.PI / 2
  g.add(body, lens)
  return g
}

/** Vertical volumetric light shaft (soft additive cone) from a practical. */
export function lightShaft(topR: number, botR: number, height: number, color: number, opacity: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(topR, botR, height, 24, 1, true)
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vPos;
      void main(){ vUv=uv; vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
    `,
    fragmentShader: /* glsl */ `
      precision highp float; varying vec2 vUv; varying vec3 vPos;
      uniform vec3 uColor; uniform float uOpacity; uniform float uTime;
      float hash(vec2 p){ p=fract(p*vec2(233.34,851.73)); p+=dot(p,p+23.45); return fract(p.x*p.y); }
      float n(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){s+=a*n(p);p*=2.03;a*=.5;} return s; }
      void main(){
        // Vertical falloff: bright near the source (top), dissolving before it
        // reaches the floor so it never reads as a solid cut cylinder.
        float top = smoothstep(0.0, 0.35, vUv.y);
        float bottomFade = smoothstep(0.0, 0.4, 1.0 - vUv.y);
        float vert = top * (0.25 + 0.75*bottomFade);
        // Soft round core across the cone silhouette (no hard vector edge).
        float core = sin(vUv.x*3.14159);
        core = pow(max(core, 0.0), 2.6);
        // God-ray striations — thin bright/dark slats broken up by noise.
        float slat = 0.6 + 0.4*sin(vUv.x*46.0 + hash(vec2(floor(vUv.x*8.0),1.0))*6.28);
        float dust = fbm(vec2(vUv.x*6.0, vUv.y*3.5 - uTime*0.28));
        float dust2 = fbm(vec2(vUv.x*13.0 + 4.0, vUv.y*6.0 - uTime*0.15));
        float body = core * slat * (0.45 + 0.75*dust) * (0.7 + 0.5*dust2);
        float a = vert * body * uOpacity;
        vec3 c = uColor * (0.55 + 0.7*dust);
        gl_FragColor = vec4(c, a);
      }
    `,
  })
  const m = new THREE.Mesh(geo, mat)
  m.renderOrder = 5
  return m
}

/** Instanced crowd band: bobbing silhouette heads/shoulders (stadium life). */
export function crowdBand(count: number, width: number, color: number, seed = 1): { mesh: THREE.InstancedMesh; update: Updater } {
  const geo = new THREE.SphereGeometry(0.16, 8, 6)
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.0, emissive: color, emissiveIntensity: 0.12 })
  const mesh = new THREE.InstancedMesh(geo, mat, count)
  mesh.frustumCulled = false
  const rand = mulberry(seed)
  const base: { x: number; y: number; z: number; ph: number; sc: number }[] = []
  const rows = 5
  for (let i = 0; i < count; i++) {
    const row = i % rows
    const x = (rand() - 0.5) * width
    const z = -1.2 - row * 0.85 + (rand() - 0.5) * 0.4
    const y = 0.2 + row * 0.55 + (rand() - 0.5) * 0.15
    base.push({ x, y, z, ph: rand() * 6.28, sc: 0.8 + rand() * 0.7 })
  }
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  const p = new THREE.Vector3()
  const update: Updater = (t) => {
    for (let i = 0; i < count; i++) {
      const b = base[i]
      p.set(b.x, b.y + Math.sin(t * 1.6 + b.ph) * 0.08, b.z)
      s.set(b.sc, b.sc * (1.2 + Math.sin(t * 1.6 + b.ph) * 0.05), b.sc)
      m.compose(p, q, s)
      mesh.setMatrixAt(i, m)
    }
    mesh.instanceMatrix.needsUpdate = true
  }
  update(0, 0)
  return { mesh, update }
}

/** Foreground occluder rail/cable: dark, close to camera, blurs into bokeh. */
export function fgBar(w: number, h: number, d: number, color: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), structureMat({ color, roughness: 0.9, metalness: 0.2 }))
  return m
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
