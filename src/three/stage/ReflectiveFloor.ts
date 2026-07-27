import * as THREE from 'three'
import { WORLD } from '../types'
import type { LightingDescription } from '../lighting/LightRig'

/**
 * The arena floor + its own self-managed planar reflection.
 *
 * We deliberately do NOT use three's `Reflector`: its reflection render fires
 * from `onBeforeRender` *inside* the main scene draw, which corrupts the
 * `postprocessing` EffectComposer's render state and blacks out the frame.
 * Instead {@link PlanarReflection} renders the mirrored scene into its own
 * target from a late-update, strictly before the composer runs, and the floor
 * is a plain mesh that samples that target through a projected texture matrix.
 *
 * The surface shader reads as a poured, sealed arena floor: a dark tinted base
 * with large-scale mottled wear, an inlaid twin-frequency trim grid that only
 * lights near the play space, a glowing rounded-rect stage boundary, a broad
 * key-light sheen streak, a soft central pool, planar reflection with a
 * grazing-angle Fresnel gain, and expanding impact shock rings.
 */

export interface FloorLook {
  base: number
  grid: number
  gridIntensity: number
  reflectivity: number
  /** Roughness of the reflection (blurs / dims it). 0 = mirror, 1 = matte. */
  roughness: number
  /** Metallic tint applied to the reflection. */
  tint: number
  /** Trim ring accent colour (the glowing stage boundary). */
  trim: number
  /** Surface pattern: 0 plate/grid, 1 concrete, 2 hazard, 3 hex-lattice,
   *  4 marble, 5 painted-lane. Gives each arena its own floor identity. */
  pattern: number
}

// ---------------------------------------------------------------------------
// Planar reflection helper (oblique-clipped mirror render into an RT)
// ---------------------------------------------------------------------------

export class PlanarReflection {
  readonly target: THREE.WebGLRenderTarget
  readonly textureMatrix = new THREE.Matrix4()
  private virtualCamera = new THREE.PerspectiveCamera()
  private plane = new THREE.Plane()
  private normal = new THREE.Vector3(0, 1, 0)
  private reflectorPos = new THREE.Vector3()
  private cameraPos = new THREE.Vector3()
  private rotMat = new THREE.Matrix4()
  private view = new THREE.Vector3()
  private target3 = new THREE.Vector3()
  private lookAt = new THREE.Vector3()
  private q = new THREE.Vector4()
  private clipPlane = new THREE.Vector4()
  private planeY: number
  private clipBias = 0.0025

  constructor(size: number, planeY: number) {
    this.planeY = planeY
    this.target = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType,
      samples: 0,
    })
  }

  /** Render the scene mirrored across the y=planeY plane into the target. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hide: THREE.Object3D[]) {
    const vc = this.virtualCamera
    this.reflectorPos.set(0, this.planeY, 0)
    this.cameraPos.setFromMatrixPosition(camera.matrixWorld)
    this.normal.set(0, 1, 0)

    this.view.subVectors(this.reflectorPos, this.cameraPos)
    if (this.view.dot(this.normal) > 0) return // camera below the floor
    this.view.reflect(this.normal).negate().add(this.reflectorPos)

    this.rotMat.extractRotation(camera.matrixWorld)
    this.lookAt.set(0, 0, -1).applyMatrix4(this.rotMat).add(this.cameraPos)
    this.target3.subVectors(this.reflectorPos, this.lookAt)
    this.target3.reflect(this.normal).negate().add(this.reflectorPos)

    vc.position.copy(this.view)
    vc.up.set(0, 1, 0).applyMatrix4(this.rotMat).reflect(this.normal)
    vc.lookAt(this.target3)
    vc.far = camera.far
    vc.updateMatrixWorld()
    vc.projectionMatrix.copy(camera.projectionMatrix)

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
    this.textureMatrix.multiply(vc.projectionMatrix)
    this.textureMatrix.multiply(vc.matrixWorldInverse)

    // Oblique near-plane clip so nothing below the floor leaks in.
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.reflectorPos)
    this.plane.applyMatrix4(vc.matrixWorldInverse)
    this.clipPlane.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant)
    const p = vc.projectionMatrix
    this.q.x = (Math.sign(this.clipPlane.x) + p.elements[8]) / p.elements[0]
    this.q.y = (Math.sign(this.clipPlane.y) + p.elements[9]) / p.elements[5]
    this.q.z = -1
    this.q.w = (1 + p.elements[10]) / p.elements[14]
    this.clipPlane.multiplyScalar(2 / this.clipPlane.dot(this.q))
    p.elements[2] = this.clipPlane.x
    p.elements[6] = this.clipPlane.y
    p.elements[10] = this.clipPlane.z + 1 - this.clipBias
    p.elements[14] = this.clipPlane.w

    const prevRT = renderer.getRenderTarget()
    const prevShadow = renderer.shadowMap.autoUpdate
    renderer.shadowMap.autoUpdate = false
    const restoreVis = hide.map((o) => o.visible)
    for (const o of hide) o.visible = false

    renderer.setRenderTarget(this.target)
    renderer.clear()
    renderer.render(scene, vc)

    renderer.setRenderTarget(prevRT)
    renderer.shadowMap.autoUpdate = prevShadow
    for (let i = 0; i < hide.length; i++) hide[i].visible = restoreVis[i]
  }

  dispose() {
    this.target.dispose()
  }
}

// ---------------------------------------------------------------------------
// Floor material
// ---------------------------------------------------------------------------

function floorMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null as THREE.Texture | null },
      textureMatrix: { value: new THREE.Matrix4() },
      uBase: { value: new THREE.Color(0x12101d) },
      uGridColor: { value: new THREE.Color(0xf77f00) },
      uGridIntensity: { value: 0.6 },
      uPattern: { value: 0 },
      uTrimColor: { value: new THREE.Color(0xf77f00) },
      uReflectivity: { value: 0.6 },
      uRoughness: { value: 0.25 },
      uReflTint: { value: new THREE.Color(0x8090b0) },
      uHasRefl: { value: 0 },
      uTime: { value: 0 },
      uFogColor: { value: new THREE.Color(0x0a0716) },
      uFogDensity: { value: 0.02 },
      uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
      uKeyColor: { value: new THREE.Color(0xffffff) },
      uKeyIntensity: { value: 3 },
      uAmbient: { value: new THREE.Color(0x2a2440) },
      uAmbientIntensity: { value: 0.6 },
      uRimColor: { value: new THREE.Color(0x88ccff) },
      uRimIntensity: { value: 2 },
      uFlashPos: { value: new THREE.Vector4(0, 2, 0, 6) },
      uFlashColor: { value: new THREE.Color(0xffffff) },
      uFlashIntensity: { value: 0 },
      uImpact: { value: new THREE.Vector4(0, 0, 0, 0) },
      uImpact2: { value: new THREE.Vector4(0, 0, 0, 0) },
      uCamPos: { value: new THREE.Vector3() },
      uArena: { value: new THREE.Vector2(6.2, 4.6) },
      uContactA: { value: new THREE.Vector2(100, 100) },
      uContactB: { value: new THREE.Vector2(100, 100) },
    },
    vertexShader: /* glsl */ `
      uniform mat4 textureMatrix;
      varying vec4 vReflUv;
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vReflUv = textureMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec4 vReflUv;
      varying vec3 vWorld;
      uniform sampler2D tDiffuse;
      uniform vec3 uBase;
      uniform vec3 uGridColor;
      uniform float uGridIntensity;
      uniform float uPattern;
      uniform vec3 uTrimColor;
      uniform float uReflectivity;
      uniform float uRoughness;
      uniform vec3 uReflTint;
      uniform float uHasRefl;
      uniform float uTime;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform vec3 uKeyDir; uniform vec3 uKeyColor; uniform float uKeyIntensity;
      uniform vec3 uAmbient; uniform float uAmbientIntensity;
      uniform vec3 uRimColor; uniform float uRimIntensity;
      uniform vec4 uFlashPos; uniform vec3 uFlashColor; uniform float uFlashIntensity;
      uniform vec4 uImpact; uniform vec4 uImpact2;
      uniform vec3 uCamPos;
      uniform vec2 uArena;
      uniform vec2 uContactA; uniform vec2 uContactB;

      float hash(vec2 p){ p=fract(p*vec2(233.34,851.73)); p+=dot(p,p+23.45); return fract(p.x*p.y); }
      float vnoise(vec2 p){
        vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
      }
      float fbm(vec2 p){ float a=0.5,s=0.0; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }
      float gridLine(float c, float w){
        float g = abs(fract(c-0.5)-0.5)/max(fwidth(c),1e-4);
        return 1.0 - smoothstep(0.0, w, g);
      }
      float rrect(vec2 p, vec2 b, float r){
        vec2 d = abs(p) - b + r;
        return min(max(d.x,d.y),0.0) + length(max(d,0.0)) - r;
      }

      void main() {
        vec3 N = vec3(0.0, 1.0, 0.0);
        vec3 V = normalize(uCamPos - vWorld);
        vec2 P = vWorld.xz;
        float rad = length(P);

        float wear = fbm(P * 0.9);
        float wear2 = fbm(P * 2.4 + 11.3);
        vec2 grad = vec2(
          fbm(P*2.4 + vec2(0.05,0.0)) - fbm(P*2.4 - vec2(0.05,0.0)),
          fbm(P*2.4 + vec2(0.0,0.05)) - fbm(P*2.4 - vec2(0.0,0.05))
        );
        N = normalize(mix(N, normalize(vec3(-grad.x, 1.0, -grad.y)*vec3(0.35,1.0,0.35)), 0.5));

        // subtle surface variation only — big low-frequency swings read as dirty
        // blotches, so keep the amplitude tight for a clean polished read.
        vec3 base = uBase * (0.9 + wear*0.2);
        base *= 0.94 + wear2*0.12;

        float ndl = max(dot(N, normalize(uKeyDir)), 0.0);
        vec3 diff = base * (uAmbient*uAmbientIntensity + uKeyColor*uKeyIntensity*0.11*ndl);
        float pool = 1.0 - smoothstep(1.0, 9.5, length(P - vec2(0.0, 0.4)));
        diff += base * uKeyColor * uKeyIntensity * 0.05 * pool;

        // --- per-stage floor surface pattern --------------------------------
        float gridFade = 1.0 - smoothstep(5.0, 26.0, rad);
        vec3 detail = vec3(0.0);
        float pm = uPattern;
        if (pm < 0.5) {
          // 0 plate: twin-frequency data grid
          float fine = max(gridLine(P.x*0.5, 1.1), gridLine(P.y*0.5, 1.1));
          float bold = max(gridLine(P.x*0.125,1.5), gridLine(P.y*0.125,1.5));
          detail = uGridColor * (fine*0.14 + bold*0.5);
        } else if (pm < 1.5) {
          // 1 concrete: sparse expansion joints, barely emissive (oil + wear)
          float joints = max(gridLine(P.x*0.1, 1.7), gridLine(P.y*0.1, 1.7));
          detail = uGridColor * joints * 0.14;
        } else if (pm < 2.5) {
          // 2 hazard: diagonal caution hatch painted as a ring around the combat
          // zone (not full-floor candy stripes) + a faint perimeter grid
          float diag = (P.x - P.y);
          float stripe = gridLine(diag*0.6 - uTime*0.05, 2.4);
          float ring = smoothstep(2.6, 3.6, rad) - smoothstep(6.0, 7.8, rad);
          float edge2 = max(gridLine(P.x*0.16,1.4), gridLine(P.y*0.16,1.4));
          detail = uGridColor * (stripe*ring*0.55 + edge2*0.1);
        } else if (pm < 3.5) {
          // 3 hex/data lattice: triangular mesh of thin emissive lines, pulsing
          float a = gridLine(P.x*0.5, 1.2);
          float bl = gridLine((P.x*0.5 + P.y*0.866)*0.5, 1.2);
          float cl = gridLine((P.x*0.5 - P.y*0.866)*0.5, 1.2);
          float lat = max(max(a,bl),cl);
          float pulse = 0.6 + 0.4*sin(rad*0.8 - uTime*1.5);
          detail = uGridColor * lat * 0.3 * pulse;
        } else if (pm < 4.5) {
          // 4 marble: thin dark vein contours + large inlaid tile seams (elegant,
          // not blobby) — veins are the boundary of an fbm field, so they read as
          // real marble threading rather than smudges
          float mv = fbm(P*0.7 + 9.0);
          float veins = smoothstep(0.49, 0.5, mv) - smoothstep(0.5, 0.51, mv);
          float veins2 = smoothstep(0.61, 0.615, mv) - smoothstep(0.615, 0.62, mv);
          float seams = max(gridLine(P.x*0.085, 1.9), gridLine(P.y*0.085, 1.9));
          detail = uGridColor * ((veins + veins2*0.6)*0.5 + seams*0.4);
        } else {
          // 5 lane: painted loading-bay lane lines + a hatched perimeter
          float lanes = gridLine(P.x*0.18, 2.4);
          float atEdge = step(6.0, max(abs(P.x), abs(P.y))) * (1.0 - smoothstep(8.0, 9.6, max(abs(P.x), abs(P.y))));
          float hatch = step(0.5, fract((P.x - P.y)*0.6)) * atEdge;
          detail = uGridColor * (lanes*0.4 + hatch*0.14);
        }
        vec3 grid = detail * uGridIntensity * gridFade;

        float sd = rrect(P, uArena, 0.9);
        float edge = smoothstep(0.16, 0.0, abs(sd));
        float pulse = 0.75 + 0.25*sin(uTime*1.6);
        vec3 trim = uTrimColor * edge * (1.4 * pulse);
        diff *= 1.0 + 0.18*smoothstep(0.0, -1.5, sd);

        vec3 refl = vec3(0.0);
        if (uHasRefl > 0.5) {
          vec2 ruv = vReflUv.xy / max(vReflUv.w, 1e-4);
          // Tight normal-driven ripple = a wet-sealed floor that still mirrors
          // geometry crisply (no vertical smear double-image).
          vec2 jit = grad * (uRoughness * 0.03);
          jit.y += uRoughness * 0.004;
          vec3 r0 = texture2D(tDiffuse, ruv + jit).rgb;
          vec3 r1 = texture2D(tDiffuse, ruv + jit*1.5).rgb;
          refl = mix(r0, r1, uRoughness*0.3) * uReflTint * 1.28;
          // Lift so dark reflected geometry still separates from the base, and
          // punch bright reflected emissives (screens, neon) so the mirror reads.
          refl += refl*refl*0.7;
        }
        float fres = pow(1.0 - clamp(dot(vec3(0.0,1.0,0.0), V), 0.0, 1.0), 3.0);

        // Contact: a directional CAST shadow (offset + elongated away from the
        // key light) plus a tight dark AO core at the feet, so the sprites read
        // as physically planted with a shadow that agrees with the lighting.
        vec2 keyXZ = uKeyDir.xz;
        float kl = length(keyXZ);
        vec2 castDir = kl > 1e-3 ? -keyXZ / kl : vec2(0.0, 1.0); // shadow throw dir
        vec2 castPerp = vec2(-castDir.y, castDir.x);
        // wide soft skirt, stretched along the cast direction
        float skirt = 0.0;
        {
          vec2 da = P - (uContactA + castDir * 0.5);
          vec2 ea = vec2(dot(da, castDir) / 1.35, dot(da, castPerp) / 0.82);
          skirt = max(skirt, 1.0 - smoothstep(0.0, 1.0, length(ea)));
          vec2 db = P - (uContactB + castDir * 0.5);
          vec2 eb = vec2(dot(db, castDir) / 1.35, dot(db, castPerp) / 0.82);
          skirt = max(skirt, 1.0 - smoothstep(0.0, 1.0, length(eb)));
        }
        // tight core (darker, smaller footprint right at the feet)
        float core = 0.0;
        {
          vec2 da = P - (uContactA + castDir * 0.16);
          vec2 ca = vec2(dot(da, castDir) / 0.72, dot(da, castPerp) / 0.44);
          core = max(core, 1.0 - smoothstep(0.0, 1.0, length(ca)));
          vec2 db = P - (uContactB + castDir * 0.16);
          vec2 cb = vec2(dot(db, castDir) / 0.72, dot(db, castPerp) / 0.44);
          core = max(core, 1.0 - smoothstep(0.0, 1.0, length(cb)));
        }
        core = core*core;
        float contactCore = max(skirt*skirt*0.5, core);

        float reflAmt = uReflectivity * (0.62 + 0.38*fres);
        // reflection gains only in the wet skirt, NOT in the dark AO core
        reflAmt = clamp(reflAmt + skirt*skirt*0.25*(1.0-core), 0.0, 0.97);
        reflAmt *= 1.0 - core*0.9;
        reflAmt *= 1.0 - smoothstep(16.0, 34.0, rad);

        vec3 H = normalize(normalize(uKeyDir) + V);
        float spec = pow(max(dot(N, H), 0.0), mix(80.0, 900.0, 1.0-uRoughness));
        // broad low-power lobe = a soft polished sheen band across the near floor,
        // the read that instantly says "this surface is wet/lacquered", not decal
        float broad = pow(max(dot(N, H), 0.0), 22.0);
        vec3 sheen = uKeyColor * spec * (0.6 + fres) * (1.0 - uRoughness*0.6);
        sheen += uKeyColor * broad * 0.3 * (1.0 - uRoughness*0.5);
        sheen += uRimColor * fres * uRimIntensity * 0.05;

        vec3 toFlash = uFlashPos.xyz - vWorld;
        float fd = length(toFlash);
        float atten = uFlashIntensity / (1.0 + fd*fd*2.2);
        vec3 flash = uFlashColor * atten * max(dot(N, normalize(toFlash)), 0.0);

        float ring = 0.0;
        if (uImpact.w > 0.001){ float d=length(P-uImpact.xy); ring += smoothstep(0.4,0.0,abs(d-uImpact.z))*uImpact.w; }
        if (uImpact2.w > 0.001){ float d=length(P-uImpact2.xy); ring += smoothstep(0.4,0.0,abs(d-uImpact2.z))*uImpact2.w; }

        vec3 col = diff + grid + trim + sheen + flash + uTrimColor*ring*2.0;
        // Contact shadow: darken the surface (and grid) under each fighter, with
        // a strong tight AO core at the feet so they read as grounded, not lit.
        col *= 1.0 - core*0.9 - skirt*skirt*0.32;
        col = mix(col, refl, reflAmt);
        col += sheen*0.35 + trim*0.4;

        float depth = length(uCamPos - vWorld);
        float fogF = 1.0 - exp(-uFogDensity*uFogDensity*depth*depth);
        col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  })
}

export class ReflectiveFloor {
  readonly mesh: THREE.Mesh
  readonly material: THREE.ShaderMaterial
  readonly reflection: PlanarReflection | null

  constructor(size: number, textureSize: number, reflectionsOn: boolean) {
    this.material = floorMaterial()
    this.material.uniforms.uHasRefl.value = reflectionsOn ? 1 : 0
    const geo = new THREE.PlaneGeometry(size, size, 1, 1)
    this.mesh = new THREE.Mesh(geo, this.material)
    this.mesh.rotation.x = -Math.PI / 2
    this.mesh.position.y = WORLD.GROUND_Y
    this.mesh.position.z = -2.5
    this.mesh.renderOrder = -10
    this.reflection = reflectionsOn ? new PlanarReflection(textureSize, WORLD.GROUND_Y) : null
    if (this.reflection) {
      this.material.uniforms.tDiffuse.value = this.reflection.target.texture
    }
  }

  /** Called from a late-update, before the post composer runs. */
  updateReflection(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hide: THREE.Object3D[]) {
    if (!this.reflection) return
    this.reflection.render(renderer, scene, camera, [this.mesh, ...hide])
    this.material.uniforms.textureMatrix.value.copy(this.reflection.textureMatrix)
  }

  applyLook(look: FloorLook) {
    const u = this.material.uniforms
    u.uBase.value.setHex(look.base)
    u.uGridColor.value.setHex(look.grid)
    u.uGridIntensity.value = look.gridIntensity
    u.uPattern.value = look.pattern
    u.uTrimColor.value.setHex(look.trim)
    u.uReflectivity.value = look.reflectivity
    u.uRoughness.value = look.roughness
    u.uReflTint.value.setHex(look.tint)
  }

  setArena(halfX: number, halfZ: number) {
    ;(this.material.uniforms.uArena.value as THREE.Vector2).set(halfX, halfZ)
  }

  /** Live fighter ground positions → contact shadow + reflection gain. */
  setContacts(a: THREE.Vector3, b: THREE.Vector3) {
    ;(this.material.uniforms.uContactA.value as THREE.Vector2).set(a.x, a.z)
    ;(this.material.uniforms.uContactB.value as THREE.Vector2).set(b.x, b.z)
  }

  syncLighting(d: LightingDescription, camPos: THREE.Vector3, fogColor: number, fogDensity: number) {
    const u = this.material.uniforms
    u.uKeyDir.value.copy(d.keyDir)
    u.uKeyColor.value.copy(d.keyColor)
    u.uKeyIntensity.value = d.keyIntensity
    u.uAmbient.value.copy(d.ambientColor)
    u.uAmbientIntensity.value = d.ambientIntensity
    u.uRimColor.value.copy(d.rimColor)
    u.uRimIntensity.value = d.rimIntensity
    u.uFlashPos.value.copy(d.flashPos)
    u.uFlashColor.value.copy(d.flashColor)
    u.uFlashIntensity.value = d.flashIntensity
    u.uCamPos.value.copy(camPos)
    u.uFogColor.value.setHex(fogColor)
    u.uFogDensity.value = fogDensity
  }

  setTime(t: number) {
    this.material.uniforms.uTime.value = t
  }

  impact(x: number, z: number, power: number) {
    const u = this.material.uniforms
    const a = u.uImpact.value as THREE.Vector4
    const b = u.uImpact2.value as THREE.Vector4
    const slot = a.w <= b.w ? a : b
    slot.set(x, z, 0.2, 0.5 + power * 0.9)
  }

  decay(dt: number) {
    for (const key of ['uImpact', 'uImpact2'] as const) {
      const v = this.material.uniforms[key].value as THREE.Vector4
      if (v.w > 0.001) {
        v.z += dt * 15
        v.w = Math.max(0, v.w - dt * 1.8)
      }
    }
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.reflection?.dispose()
  }
}
