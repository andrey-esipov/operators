import * as THREE from 'three'
import { bakeMaterial, type MaterialPreset } from '../materials/procedural'

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
  /**
   * Foreground framing occluders (pylons, rails, corner mass). These were
   * *authored* as a screen-space framing device — "the true frame edges" — but
   * a fixed-x world box only frames correctly from the one camera pose it was
   * drawn against. Ours dollies and zooms, so world-space occluders swing
   * across and bury the fighter on a punch-in. They therefore live in their own
   * group, which the stage subsystem pins rigidly to the camera (see
   * `StageSubsystem`), so they behave as the framing device they were designed
   * to be regardless of where the shot goes.
   */
  readonly foreground = new THREE.Group()
  readonly animated: Updater[] = []
  readonly disposables: { dispose(): void }[] = []
  /** Meshes that should be hidden while the reflection pass renders (cheap). */
  readonly reflectSkip: THREE.Object3D[] = []
  /**
   * Relayed each frame by the stage subsystem from the match's celebration
   * beat. Stage builds read it to gate victory-only set-dressing (e.g. the IPO
   * ticker-tape), so nothing festive fires during neutral play.
   */
  celebrate = false

  /** >0 while `foreground()` authoring is running, so `add()` routes into the
   *  camera-pinned frame group instead of the world-space set. */
  private fgDepth = 0

  add(o: THREE.Object3D) {
    ;(this.fgDepth > 0 ? this.foreground : this.root).add(o)
    return o
  }
  /** Route subsequent `add()`s into the camera-pinned foreground frame group.
   *  Paired with `endForeground()`; nestable so authoring stays untouched. */
  beginForeground() {
    this.fgDepth++
  }
  endForeground() {
    if (this.fgDepth > 0) this.fgDepth--
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
    const disposeTree = (o: THREE.Object3D) =>
      o.traverse((n) => {
        const m = n as THREE.Mesh
        m.geometry?.dispose?.()
        const mat = m.material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
        else mat?.dispose()
      })
    disposeTree(this.root)
    disposeTree(this.foreground)
    this.root.parent?.remove(this.root)
    this.foreground.parent?.remove(this.foreground)
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
  /** Force a specific bakery preset instead of inferring from metalness. */
  preset?: MaterialPreset
  /** Texture tiling across the surface UVs. */
  repeat?: number | [number, number]
  /** Override the preset's default normal-map strength. */
  normalScale?: number
  /** Opt out of texturing (rare — for tiny props where detail is wasted). */
  flat?: boolean
}): THREE.MeshStandardMaterial {
  const roughness = opts.roughness ?? 0.72
  const metalness = opts.metalness ?? 0.35
  if (opts.flat) {
    return new THREE.MeshStandardMaterial({
      color: opts.color,
      roughness,
      metalness,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
    })
  }
  return texturedMat({
    color: opts.color,
    roughness,
    metalness,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    preset: pickPreset(roughness, metalness, opts.preset),
    repeat: opts.repeat,
    normalScale: opts.normalScale,
  })
}

// ---------------------------------------------------------------------------
// Textured PBR structural material.
//
// Every structural primitive routes through the procedural bakery so it carries
// albedo variation, roughness variation and normal micro-detail for the light to
// catch — untextured primitives are the single loudest amateur tell. Materials
// are cached by signature and reuse the bakery's cached base maps (only the
// wrap/repeat is per-material via a light clone), so a stage that reuses a look
// in fifty places pays for one bake and a bounded set of texture views. aoMap is
// intentionally omitted (kit geometry has no second UV set); the baked albedo
// already darkens crevices so cavity reads even before lighting.
// ---------------------------------------------------------------------------

function pickPreset(roughness: number, metalness: number, hint?: MaterialPreset): MaterialPreset {
  if (hint) return hint
  if (metalness >= 0.6) return roughness <= 0.42 ? 'brushedMetal' : 'darkSteel'
  if (metalness >= 0.28) return 'paintedMetal'
  if (roughness >= 0.9) return 'plaster'
  return 'concrete'
}

/** Sensible UV tiling per preset so detail sits at a believable physical scale. */
const PRESET_REPEAT: Record<MaterialPreset, number> = {
  concrete: 2.2, polishedConcrete: 2.6, asphalt: 3, brushedMetal: 1.6,
  paintedMetal: 2, darkSteel: 2.2, rustedSteel: 2, marble: 1.4, wornWood: 2.4,
  plywood: 2, rubberFloor: 3, carpet: 3, fabric: 3, plaster: 2.4, drywall: 2,
  glassPanel: 1.4, carbonFibre: 3, perforatedMetal: 3, cardboard: 2, whiteboard: 1.2,
}

/** Approx mean luminance of each preset's baked albedo. The caller's `color` is
 *  the albedo they expect *before* the bakery multiplied its own texture in, so
 *  we pre-divide by this (clamped) to keep the surface's average brightness on
 *  target while the texture supplies the variation on top. */
const PRESET_MEAN_LUMA: Record<MaterialPreset, number> = {
  concrete: 0.5, polishedConcrete: 0.55, asphalt: 0.18, brushedMetal: 0.62,
  paintedMetal: 0.26, darkSteel: 0.16, rustedSteel: 0.3, marble: 0.72, wornWood: 0.32,
  plywood: 0.55, rubberFloor: 0.16, carpet: 0.24, fabric: 0.32, plaster: 0.6, drywall: 0.72,
  glassPanel: 0.4, carbonFibre: 0.12, perforatedMetal: 0.28, cardboard: 0.5, whiteboard: 0.9,
}

const texMatCache = new Map<string, THREE.MeshStandardMaterial>()
const _cc = new THREE.Color()

interface TexMatOpts {
  color: number
  roughness: number
  metalness: number
  emissive: number
  emissiveIntensity: number
  preset: MaterialPreset
  repeat?: number | [number, number]
  normalScale?: number
  seed?: number
  size?: number
}

export function texturedMat(o: TexMatOpts): THREE.MeshStandardMaterial {
  const rep = o.repeat ?? PRESET_REPEAT[o.preset] ?? 2
  const [rx, ry] = Array.isArray(rep) ? rep : [rep, rep]
  const seed = o.seed ?? 1
  const size = o.size ?? 256
  const key = `${o.preset}|${o.color}|${o.roughness.toFixed(2)}|${o.metalness.toFixed(2)}|${o.emissive}|${o.emissiveIntensity.toFixed(2)}|${rx}x${ry}|${o.normalScale ?? -1}|${seed}|${size}`
  const hit = texMatCache.get(key)
  if (hit) return hit

  const set = bakeMaterial(o.preset, seed, size)
  const map = set.map.clone(); map.needsUpdate = true
  const roughnessMap = set.roughnessMap.clone(); roughnessMap.needsUpdate = true
  const normalMap = set.normalMap.clone(); normalMap.needsUpdate = true
  const metalnessMap = set.metalnessMap?.clone()
  if (metalnessMap) metalnessMap.needsUpdate = true
  for (const t of [map, roughnessMap, normalMap, metalnessMap]) {
    if (!t) continue
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
    t.repeat.set(rx, ry)
  }
  // Brightness compensation: keep the surface's average on the caller's colour.
  const comp = Math.min(2.6, Math.max(1.0, 0.66 / (PRESET_MEAN_LUMA[o.preset] ?? 0.5)))
  _cc.setHex(o.color).multiplyScalar(comp)
  _cc.r = Math.min(1, _cc.r); _cc.g = Math.min(1, _cc.g); _cc.b = Math.min(1, _cc.b)
  const m = new THREE.MeshStandardMaterial({
    map,
    roughnessMap,
    normalMap,
    metalnessMap,
    color: _cc.getHex(),
    roughness: o.roughness,
    metalness: o.metalness,
    emissive: o.emissive,
    emissiveIntensity: o.emissiveIntensity,
  })
  const ns = o.normalScale ?? set.defaults.normalScale
  m.normalScale.set(ns, ns)
  texMatCache.set(key, m)
  return m
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
// Fresnel rim shell. A large solid prop that is BACK-lit (a column in front of a
// bright facade, say) collapses to a flat black silhouette — no form, no
// material, the amateur tell the brief called out on the ipo-prep pillars. This
// returns a thin additive shell whose brightness rides a fresnel term, so it
// glows only at grazing angles — i.e. exactly the silhouette EDGES — re-drawing
// the form's outline in light regardless of where the scene lights sit. Optional
// fluting modulates the rim around the surface so a column reads as fluted stone
// rather than a plain glowing tube. It is static (no per-frame uniform churn), so
// it adds no background motion.
// ---------------------------------------------------------------------------

export function fresnelShell(
  geo: THREE.BufferGeometry,
  color: number,
  intensity = 1,
  flutes = 0,
): { mesh: THREE.Mesh; mat: THREE.ShaderMaterial } {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uFlutes: { value: flutes },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      uniform vec3 uColor; uniform float uIntensity; uniform float uFlutes;
      void main(){
        float f = pow(1.0 - clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0), 2.4);
        float flute = uFlutes > 0.5 ? (0.55 + 0.45 * abs(sin(vUv.x * uFlutes * 3.14159265))) : 1.0;
        float rim = f * flute * uIntensity;
        gl_FragColor = vec4(uColor * rim, rim);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
    toneMapped: false,
    fog: false,
  })
  return { mesh: new THREE.Mesh(geo, mat), mat }
}

// ---------------------------------------------------------------------------
// Radial light glow — a soft blooming disc of light (dawn through a door,
// a blown-out practical, a projector cone hitting fog). Additive, animated
// with a slow breathing shimmer + faint vertical light bars so it reads as
// real light pouring through, not a flat sticker.
// ---------------------------------------------------------------------------

export function radialGlow(
  w: number,
  h: number,
  inner: number,
  outer: number,
  bright = 1,
): { mesh: THREE.Mesh; mat: THREE.ShaderMaterial } {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false,
    uniforms: {
      uTime: { value: 0 },
      uInner: { value: new THREE.Color(inner) },
      uOuter: { value: new THREE.Color(outer) },
      uBright: { value: bright },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform float uTime; uniform vec3 uInner; uniform vec3 uOuter; uniform float uBright;
      float hash(vec2 p){ p=fract(p*vec2(233.34,851.73)); p+=dot(p,p+23.45); return fract(p.x*p.y); }
      void main(){
        vec2 p = (vUv - 0.5) * vec2(1.7, 2.0);
        float d = length(p);
        // soft blooming core -> falloff
        float core = smoothstep(1.05, 0.0, d);
        core = pow(core, 1.7);
        float hot = smoothstep(0.42, 0.0, d);
        // faint vertical light bars (god-ray suggestion through the opening)
        float bars = 0.0;
        bars += 0.10 * smoothstep(0.5, 1.0, sin(vUv.x*11.0 + uTime*0.15));
        bars *= smoothstep(1.0, 0.15, d);
        // gentle breathing + dust flicker
        float breathe = 0.9 + 0.1 * sin(uTime*0.6);
        float dust = 0.96 + 0.04 * hash(floor(vUv*80.0) + floor(uTime*3.0));
        vec3 col = mix(uOuter, uInner, clamp(hot + core*0.6, 0.0, 1.0));
        float a = (core + hot*0.8 + bars) * uBright * breathe * dust;
        gl_FragColor = vec4(col * (0.6 + a), clamp(a, 0.0, 1.0));
      }
    `,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
  return { mesh, mat }
}

// ---------------------------------------------------------------------------
// Animated screen panel
// ---------------------------------------------------------------------------

export type ScreenMode = 'data' | 'ticker' | 'ekg' | 'equalizer' | 'grid' | 'alert' | 'crowd' | 'neural' | 'windows'

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
      } else if (m < 7.5) {
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
      } else {
        // windows: a lit high-rise facade. The mid-ground must read as a city
        // block behind the hall, not a flat noise panel, so this draws a
        // structured mullioned grid with warm/cool/dark window occupancy, a
        // stepped near-tower roofline that OCCLUDES a dimmer tower behind it
        // (parallax depth), a vertical city-glow gradient (bright occupied base
        // fading to dark sky) and one brighter focal storey. It is near-static:
        // occupancy shifts only every ~6s at tiny amplitude so the facade adds
        // no per-frame background motion (the confetti lesson).
        vec2 uvw = uv;

        // FAR tower: denser, cooler, dimmer, offset so it peeks past the roofline
        vec2 gF = uvw * vec2(22.0, 34.0) + vec2(3.0, 0.0);
        vec2 idF = floor(gF); vec2 fF = fract(gF);
        float paneF = step(0.14, fF.x) * step(fF.x, 0.86) * step(0.16, fF.y) * step(fF.y, 0.84);
        float litF = step(0.45, hash(idF));
        float coolF = step(0.55, hash(idF + 5.0));
        vec3 facFar = mix(uColor, uColor2, coolF) * paneF * litF * (0.35 + 0.5 * hash(idF + 2.0));
        facFar *= 0.55;

        // NEAR tower: larger warmer windows with structural piers
        vec2 gN = uvw * vec2(11.0, 20.0);
        vec2 idN = floor(gN); vec2 fN = fract(gN);
        float paneN = step(0.16, fN.x) * step(fN.x, 0.84) * step(0.18, fN.y) * step(fN.y, 0.82);
        float rN = hash(idN);
        float occ = step(0.40, rN + 0.08 * (hash(idN + floor(uTime * 0.16)) - 0.5) * 2.0);
        float coolN = step(0.78, hash(idN + 9.0));
        float briN = 0.55 + 0.45 * hash(idN + 3.0);
        vec3 facNear = mix(uColor, uColor2, coolN) * paneN * occ * briN;
        // vertical structural piers every ~3 columns read as building massing
        facNear *= (1.0 - 0.7 * step(0.92, fract(uvw.x * 3.667)));

        // stepped roofline: near-building silhouette, height varies in 3 blocks
        float bx = floor(uvw.x * 3.0);
        float roof = 0.60 + 0.18 * hash1(bx + 11.0);
        float nearMask = step(uvw.y, roof);
        float focal = smoothstep(0.05, 0.0, abs(uvw.y - 0.16)) * nearMask;

        vec3 fac = mix(facFar, facNear, nearMask);
        // city-glow gradient: bright occupied base fading to dark sky
        fac *= mix(1.15, 0.42, clamp(uvw.y, 0.0, 1.0));
        fac += uColor * smoothstep(0.22, 0.0, uvw.y) * 0.18;  // warm street bloom
        fac += mix(uColor, uColor2, 0.2) * focal * 0.5;        // focal storey
        col = fac;
      }

      // scanlines read as a monitor — right for data panels, wrong for a window
      // facade, so the windows mode (m=8) opts out and keeps only the depth
      // vignette; every other mode still gets the emissive-display scanline.
      float scan = 0.82 + 0.18*sin(uv.y*380.0);
      col *= (m > 7.5) ? 1.0 : scan;
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
    data: 0, ticker: 1, ekg: 2, equalizer: 3, grid: 4, alert: 5, crowd: 6, neural: 7, windows: 8,
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
