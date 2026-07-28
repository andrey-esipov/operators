import * as THREE from 'three'
import type { FighterAssets, Vec2, Stance } from '../../fight/types'
import type { LightingDescription } from '../lighting/LightRig'
import { WORLD } from '../types'
import type { AtlasTextureSet } from './AtlasTextures'
import {
  createSpriteUniforms,
  createSpriteMaterial,
  makeUnitQuad,
  applyLighting,
  type SpriteFighterUniforms,
} from './SpriteFighterMaterial'
import { resolveFrame } from './AnimationDriver'
import { CM_TO_WORLD, simToWorld, FIGHTER_Z } from './worldScale'

/**
 * How long a hit flash reads before it hard-cuts to zero, in unscaled seconds.
 * ~3 frames at 60fps. The flash is boxed from the contact event, NOT the hurt
 * stance, so it can never persist across a multi-frame juggle/hitstun and erase
 * the pose underneath. Exported so a guard test can assert the box actually
 * expires (the failure mode that produced the "white silhouette" regression).
 */
export const FLASH_SECONDS = 0.05

/**
 * The hit-flash envelope as a self-contained, testable unit.
 *
 * The one invariant that matters: the flash is a fixed-length box armed at the
 * moment of contact. It reads at a constant, hit-weighted intensity for
 * FLASH_SECONDS and then HARD-CUTS to exactly zero — it is never bound to a
 * hurt STANCE. `juggle`/`hitstun` are multi-frame states; a flash keyed off
 * "is this fighter hurt" holds for the whole beat and whites-out the pose
 * underneath (the regression this guards against). A combo's next hit re-arms
 * the box (a fresh flashbulb per connect). Peak is capped so even the frame a
 * still-capture lands on keeps a readable silhouette; additive in the shader.
 */
export class HitFlashBox {
  private timer = 0
  private strength = 0
  /** Latch a fresh flash from a contact event. */
  arm(strength: number) {
    this.strength = Math.min(1, Math.max(0, strength))
    this.timer = FLASH_SECONDS
  }
  /** Advance by unscaled dt and return the visible additive value (0 once the
   *  box has expired — a hard cut, not a fade). */
  step(realDt: number): number {
    if (this.timer > 0) this.timer = Math.max(0, this.timer - realDt)
    return this.timer > 0 ? Math.min(0.45, this.strength) : 0
  }
}


/** The interpolated, render-ready view of one fighter for a single frame. */
export interface FighterView {
  pos: Vec2
  vel: Vec2
  facing: 1 | -1
  stance: Stance
  move?: { id: string; frame: number }
  health: number
  maxHealth: number
  grounded: boolean
  globalFrame: number
  /**
   * Frames elapsed inside the current reaction (hitstun, block, juggle,
   * knockdown, wakeup). A victim carries no `move` -- only attackers do -- so
   * without this the reaction clip has no clock of its own and falls back to
   * `globalFrame`, which for a non-looping clip clamps to its last frame
   * forever.
   */
  reactionFrame: number
}

export interface FighterUpdateCtx {
  light: LightingDescription
  fogColor: THREE.Color
  fogDensity: number
  bounceColor: THREE.Color
  /** Scaled dt (freezes with hitstop) — world motion. */
  dt: number
  /** Unscaled dt — presentation accents like the hit flash. */
  realDt: number
}

let sharedShadowTex: THREE.Texture | null = null
function shadowTexture(): THREE.Texture {
  if (sharedShadowTex) return sharedShadowTex
  const s = 128
  const c = document.createElement('canvas')
  c.width = c.height = s
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  // A tight, dark core so a stamp placed under a sole reads as genuine contact,
  // with a quick falloff so two feet stay visually separate (the gap between the
  // legs must NOT fill in — that is the contradiction this system fixes).
  g.addColorStop(0, 'rgba(0,0,0,0.95)')
  g.addColorStop(0.4, 'rgba(0,0,0,0.62)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.NoColorSpace
  sharedShadowTex = t
  return t
}

/** Max number of independent contact cores a fighter can cast at once (two feet
 *  plus a hand/knee/torso on a knockdown or wakeup plant). */
const SHADOW_STAMPS = 4

/**
 * One ground-contact support point, in the fighter's own facing-agnostic frame:
 * `ox` is the world-X offset of the contact from the feet anchor at facing = +1,
 * `halfW` its world half-width, `strength` its relative darkness (the widest,
 * most-planted contact = 1). Extracted once per frame from the real silhouette.
 */
interface Contact {
  ox: number
  halfW: number
  strength: number
}

/**
 * One live fighter: the lit sprite quad plus a grounded contact shadow.
 *
 * The contact shadow is not optional decoration — a sprite without one reads as
 * a sticker floating over the floor. It's a soft dark ellipse laid flat on the
 * ground under the feet that tightens and darkens as the fighter lands and
 * spreads and fades as they leave the ground, so weight transfer is legible.
 */
export class Fighter {
  readonly group = new THREE.Group()
  readonly mesh: THREE.Mesh
  private uniforms: SpriteFighterUniforms
  private shadowStamps: THREE.Mesh[] = []
  /** Per-frame ground-contact support points, indexed by frame number. */
  private contacts: Contact[][] = []
  private bloomMask: THREE.Mesh
  private assets: FighterAssets | null = null
  private pxToWorld = CM_TO_WORLD
  private curFrame = -1
  private flash = new HitFlashBox()
  private dissolve = 0
  private targetDissolve = 0
  private accent = new THREE.Color(0xffa53c)
  private side: 'a' | 'b'
  private tmp = new THREE.Vector3()

  constructor(side: 'a' | 'b') {
    this.side = side
    this.uniforms = createSpriteUniforms()
    const mat = createSpriteMaterial(this.uniforms)
    this.mesh = new THREE.Mesh(makeUnitQuad(), mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 10

    // Keep the fighter out of the (inverted) selective bloom. Blooming the
    // character's own diffuse doubles its luminance and blows lit skin / a hit
    // flash to pure white; and the bright white shoe soles bloom into glowing
    // pools on the floor that read as the character hovering on light. Real
    // fighters bloom the stage, the VFX and the supers, never the sprite.
    //
    // The catch: SelectiveBloomEffect masks its selection by DEPTH — it renders
    // the selected meshes through a plain depth pass and excludes screen pixels
    // whose scene depth matches. But the sprite's vertex shader ignores the
    // quad's `position` attribute and rebuilds its geometry from uniforms
    // (uSize/uPivot/squash/lean), so that depth pass draws the fighter as a tiny
    // unit quad in the wrong place. The mask misses the real sprite entirely and
    // tagging `mesh.noBloom` is a no-op (verified: toggling it changes nothing).
    //
    // Fix: a plain proxy quad that DOES honour its transform. The sprite is a
    // flat billboard at a single depth (FIGHTER_Z[side]), so a quad covering its
    // screen footprint at that z gives the depth pass the correct silhouette and
    // the fighter is genuinely excluded. It never draws colour or depth in the
    // main pass; it exists only to be seen by the bloom effect's depth pass.
    this.bloomMask = new THREE.Mesh(
      makeUnitQuad(),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }),
    )
    this.bloomMask.frustumCulled = false
    this.bloomMask.renderOrder = -1
    this.bloomMask.userData.noBloom = true

    // ---- Contact shadow: a pool of dark cores, one per support point --------
    // A single centred ellipse puts its darkest point at the body centroid,
    // which in a wide fighting stance is the empty gap BETWEEN the feet — the
    // dark core touches neither sole (a contradiction that reads worse than the
    // old "sprite floating over the floor" absence it replaced). Instead we cast
    // one soft dark stamp under each real ground-contact point (both feet, and a
    // hand/knee/torso plant on knockdown/wakeup), so every sole gets its own
    // dark core and the space between stays light.
    //
    // Each stamp is a flat ground decal: it sits a hair above the floor
    // (y≈0.02), which at this near, low camera is far below the depth buffer's
    // ability to separate it from the reflective floor at y=0. Depth-testing it
    // made it z-fight the floor and drop out entirely (the "no contact" tell that
    // survived five sessions), so — like the original — draw purely by
    // renderOrder (after floor/groundfog ≤4, before the sprite at 10) and never
    // depth-test against the floor it is meant to darken.
    for (let i = 0; i < SHADOW_STAMPS; i++) {
      const stamp = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: shadowTexture(),
          transparent: true,
          depthWrite: false,
          depthTest: false,
          opacity: 0,
          color: 0x000000,
        }),
      )
      stamp.rotation.x = -Math.PI / 2
      stamp.position.y = WORLD.GROUND_Y + 0.02
      stamp.renderOrder = 5
      stamp.frustumCulled = false
      this.shadowStamps.push(stamp)
    }

    this.group.add(this.mesh, this.bloomMask, ...this.shadowStamps)
  }

  setAssets(assets: FighterAssets, tex: AtlasTextureSet, accent: string) {
    this.assets = assets
    this.accent.set(accent)
    this.uniforms.uAlbedo.value = tex.albedo
    this.uniforms.uNormal.value = tex.normal
    this.uniforms.uHeight.value = tex.height
    this.uniforms.uTexel.value.set(1 / tex.width, 1 / tex.height_px)
    this.uniforms.uAccent.value.copy(this.accent)

    // Reference character pixel height → world scale. Use an idle frame so the
    // standing character is exactly `heightCm` tall; other poses inherit the
    // same pixels-per-world ratio so nothing grows or shrinks between frames.
    const idle = assets.clips['idle'] ?? assets.clips['stance']
    const refIdx = idle?.frames[0] ?? 0
    const refH = assets.frames[refIdx]?.rect.h || assets.frames[0]?.rect.h || 512
    this.pxToWorld = (assets.heightCm * CM_TO_WORLD) / refH
    this.curFrame = -1

    // Precompute the ground-contact support points for every frame from the real
    // silhouette so the runtime shadow costs only a table lookup (below).
    this.contacts = this.computeContacts(tex)
  }

  /**
   * For each frame, read the bottom band of the character's silhouette and split
   * it into ground-contact clusters. A wide idle gives two clusters (the feet);
   * a knockdown gives one long low cluster (the body on its side); a wakeup hand
   * plant gives a forward cluster plus the feet — all straight from the art, so
   * the shadow tracks whatever is actually touching the floor without any
   * per-stance table. Runs once per fighter at load.
   */
  private computeContacts(tex: AtlasTextureSet): Contact[][] {
    const out: Contact[][] = []
    if (!this.assets) return out
    const { mask, width: aw, height_px: ah } = tex
    for (const f of this.assets.frames) out.push(this.contactsForFrame(mask, aw, ah, f))
    return out
  }

  private contactsForFrame(
    mask: Uint8Array,
    aw: number,
    ah: number,
    f: FighterAssets['frames'][number],
  ): Contact[] {
    const { rect, anchor } = f
    const rw = rect.w, rh = rect.h, rx = rect.x, ry = rect.y
    if (rw <= 0 || rh <= 0) return []

    // Lowest opaque row of this frame (row 0 = top; feet are at the bottom).
    let bottomPy = -1
    for (let py = rh - 1; py >= 0 && bottomPy < 0; py--) {
      const Y = ry + py
      if (Y < 0 || Y >= ah) continue
      const base = Y * aw + rx
      for (let px = 0; px < rw; px++) { if (mask[base + px]) { bottomPy = py; break } }
    }
    if (bottomPy < 0) return []

    // Density of silhouette coverage per column across a thin contact band just
    // above the lowest row — the footprint pressed into the floor.
    const band = Math.max(3, Math.round(rh * 0.05))
    const top = Math.max(0, bottomPy - band)
    const dens = new Float32Array(rw)
    for (let py = top; py <= bottomPy; py++) {
      const Y = ry + py
      if (Y < 0 || Y >= ah) continue
      const base = Y * aw + rx
      for (let px = 0; px < rw; px++) if (mask[base + px]) dens[px]++
    }

    // Merge columns into clusters, bridging small gaps (a shoe's arch, AA) so one
    // foot is one contact, but leaving the wide stance gap between feet as a
    // genuine break.
    const maxGap = Math.max(2, Math.round(rw * 0.04))
    const clusters: { start: number; end: number; mass: number; cx: number }[] = []
    let px = 0
    while (px < rw) {
      if (!dens[px]) { px++; continue }
      let end = px
      for (;;) {
        while (end + 1 < rw && dens[end + 1]) end++
        let g = end + 1, gg = 0
        while (g < rw && !dens[g] && gg < maxGap) { g++; gg++ }
        if (g < rw && dens[g] && gg <= maxGap) { end = g; continue }
        break
      }
      let mass = 0, wsum = 0
      for (let c = px; c <= end; c++) { mass += dens[c]; wsum += dens[c] * c }
      clusters.push({ start: px, end, mass, cx: mass > 0 ? wsum / mass : (px + end) / 2 })
      px = end + 1
    }
    if (!clusters.length) return []

    // Keep the meaningful contacts: drop specks, take the strongest few.
    let maxMass = 0
    for (const c of clusters) if (c.mass > maxMass) maxMass = c.mass
    const kept = clusters
      .filter((c) => c.mass >= 0.18 * maxMass)
      .sort((a, b) => b.mass - a.mass)
      .slice(0, SHADOW_STAMPS)

    return kept.map((c) => ({
      ox: (c.cx - anchor.x) * this.pxToWorld,
      halfW: ((c.end - c.start + 1) / 2) * this.pxToWorld,
      strength: THREE.MathUtils.clamp(c.mass / (maxMass || 1), 0.45, 1),
    }))
  }

  /** Width of the standing silhouette in world units, for shadow/camera sizing. */
  get bodyWidth(): number {
    if (!this.assets) return 1
    const idle = this.assets.clips['idle'] ?? this.assets.clips['stance']
    const idx = idle?.frames[0] ?? 0
    return (this.assets.frames[idx]?.rect.w || 300) * this.pxToWorld
  }

  triggerHitFlash(strength = 1) {
    // Arm the box from THIS contact event. See HitFlashBox — the flash is a
    // fixed-length flashbulb, never bound to the victim's hurt stance, so it
    // cannot persist across a juggle/hitstun and erase the pose underneath.
    this.flash.arm(strength)
  }

  setDissolve(target: number) {
    this.targetDissolve = THREE.MathUtils.clamp(target, 0, 1)
  }

  private applyFrame(idx: number) {
    if (!this.assets || idx === this.curFrame) return
    const f = this.assets.frames[idx]
    if (!f) return
    this.curFrame = idx
    const atlasW = this.uniforms.uTexel.value.x > 0 ? 1 / this.uniforms.uTexel.value.x : 1024
    const atlasH = this.uniforms.uTexel.value.y > 0 ? 1 / this.uniforms.uTexel.value.y : 1024
    const { rect, anchor } = f
    this.uniforms.uUvOffset.value.set(rect.x / atlasW, rect.y / atlasH)
    this.uniforms.uUvScale.value.set(rect.w / atlasW, rect.h / atlasH)
    this.uniforms.uSize.value.set(rect.w * this.pxToWorld, rect.h * this.pxToWorld)
    // Pivot: anchor is feet in px from the rect's top-left; geometry y grows up.
    this.uniforms.uPivot.value.set(anchor.x / rect.w, 1 - anchor.y / rect.h)
  }

  update(v: FighterView, ctx: FighterUpdateCtx) {
    if (!this.assets) return

    // ---- Discrete frame selection (never interpolated) --------------------
    const idx = resolveFrame(this.assets, { stance: v.stance, move: v.move, globalFrame: v.globalFrame, reactionFrame: v.reactionFrame })
    this.applyFrame(idx)

    // ---- Placement: feet land on the sim position -------------------------
    const feet = simToWorld(v.pos, this.tmp)
    this.mesh.position.set(feet.x, feet.y, FIGHTER_Z[this.side])
    this.uniforms.uFacing.value = v.facing

    // ---- Weight: feet-pivoted squash / stretch / lean ---------------------
    let sx = 1, sy = 1, lean = 0
    const bob = Math.sin(v.globalFrame * 0.14) * 0.012
    switch (v.stance) {
      case 'jump-rise': sy = 1.08; sx = 0.94; break
      case 'jump-fall': sy = 1.05; sx = 0.96; break
      case 'dash': lean = 0.14; sx = 1.05; break
      case 'backdash': lean = -0.1; break
      case 'attack': lean = 0.06; break
      case 'hitstun': lean = -0.14; sx = 1.04; break
      case 'juggle': lean = -0.2; break
      case 'knockdown': case 'ko': sy = 0.9; break
      case 'walk-fwd': case 'walk-back': sy = 1 + bob; sx = 1 - bob; break
      default: sy = 1 + bob * 0.6; sx = 1 - bob * 0.6
    }
    // Horizontal speed shears the body a touch into the direction of travel.
    lean += THREE.MathUtils.clamp((v.vel.x * CM_TO_WORLD) * 0.12, -0.14, 0.14)
    this.uniforms.uSquash.value.set(sx, sy)
    this.uniforms.uLean.value = lean

    // ---- Bloom-exclusion depth proxy --------------------------------------
    // Cover the sprite's screen footprint with a plain quad at the sprite's
    // constant depth so the selective bloom's depth pass can mask the fighter
    // (see the constructor). Sized generously from the frame's world extent —
    // over-covering is harmless because the mask only affects scene pixels that
    // are actually at this depth (the sprite itself and the thin floor line at
    // its feet), never the background or the far stage.
    const bw = this.uniforms.uSize.value.x * Math.abs(sx)
    const bh = this.uniforms.uSize.value.y * Math.abs(sy)
    this.bloomMask.position.set(feet.x - bw, feet.y - 0.15, FIGHTER_Z[this.side])
    this.bloomMask.scale.set(bw * 2, bh + 0.3, 1)

    // ---- Lighting from the stage rig --------------------------------------
    applyLighting(this.uniforms, ctx.light)
    this.uniforms.uFogColor.value.copy(ctx.fogColor)
    this.uniforms.uFogDensity.value = ctx.fogDensity
    this.uniforms.uBounceColor.value.copy(ctx.bounceColor)
    this.uniforms.uAccent.value.copy(this.accent)
    this.uniforms.uTime.value += ctx.dt

    // ---- Hit flash (a fixed-length flashbulb, boxed from the contact event) ----
    // Driven off a timer armed at contact (see HitFlashBox), NOT the hurt stance:
    // full intensity for FLASH_SECONDS (~3 frames), then a HARD CUT to zero.
    // Fighting games cut; a fade reads as motion blur. For the rest of a juggle
    // the victim shows its true albedo instead of a white-silhouette wash.
    this.uniforms.uHitFlash.value = this.flash.step(ctx.realDt)

    // ---- KO dissolve ------------------------------------------------------
    this.dissolve += (this.targetDissolve - this.dissolve) * Math.min(1, ctx.dt * 2.5)
    this.uniforms.uDissolve.value = this.dissolve
    this.uniforms.uOpacity.value = 1

    // ---- Contact shadow: a dark core under each real support point ---------
    // Ground decals that tie the fighter to the floor. Each support point (feet,
    // and a hand/knee/torso plant on knockdown/wakeup) gets its own soft dark
    // core, so a wide stance reads as two planted feet, not one blob hovering in
    // the gap between the legs. As the fighter leaves the ground the cores
    // CONVERGE toward centre, SHRINK, and SOFTEN (a small faint pool directly
    // below reads as height; a shadow that grew or stayed dark would read as
    // nearing a light), and the pool leans away from the stage key light.
    const airborne = Math.max(0, v.pos.y) * CM_TO_WORLD // world units above floor
    const w = this.bodyWidth
    let lift = THREE.MathUtils.clamp(airborne / (WORLD.FIGHTER_HEIGHT * 0.9), 0, 1)
    // DEV mutation hook: force the height response off so a probe can prove the
    // grounded↔airborne shrink/soften comes from THIS code, not the instrument.
    if (import.meta.env.DEV && (globalThis as Record<string, unknown>).__MUT_SHADOW_NOLIFT__) lift = 0
    const shrink = 1 - 0.5 * lift
    const conv = lift // feet draw together as the fighter rises
    // Cast opposite the key light's horizontal direction. uKeyDir points from the
    // surface toward the light (set by applyLighting above), so the pool leans to
    // the far side; the offset eases toward centre as the fighter rises.
    const kd = this.uniforms.uKeyDir.value
    const away = kd.x >= 0 ? -1 : 1
    const offX = away * w * 0.14 * (1 - 0.5 * lift)

    const frameContacts = this.contacts[this.curFrame]
    // Fallback keeps a two-foot stance if a frame yielded no silhouette band, so
    // we can never silently regress to a single centred blob in the leg gap.
    let cs: Contact[] =
      frameContacts && frameContacts.length
        ? frameContacts
        : [
            { ox: -w * 0.24, halfW: w * 0.15, strength: 1 },
            { ox: w * 0.24, halfW: w * 0.15, strength: 1 },
          ]

    // DEV mutation hooks (stripped from production by import.meta.env.DEV):
    //  · __MUT_SHADOW_OFF__      — hide every core, giving a per-height baseline
    //    of the bare floor so a probe can difference out the sprite/floor/twinkle
    //    and read ONLY the shadow's contribution.
    //  · __MUT_SHADOW_CENTROID__ — collapse to a single centred blob at the body
    //    centroid: the exact OLD defect, so an anchoring probe that passes on the
    //    support-point version must go red here or it is not really testing.
    let shadowOff = false
    if (import.meta.env.DEV) {
      const g = globalThis as Record<string, unknown>
      if (g.__MUT_SHADOW_OFF__) shadowOff = true
      if (g.__MUT_SHADOW_CENTROID__) cs = [{ ox: 0, halfW: w * 0.46, strength: 1 }]
    }

    for (let i = 0; i < this.shadowStamps.length; i++) {
      const stamp = this.shadowStamps[i]
      const smat = stamp.material as THREE.MeshBasicMaterial
      if (shadowOff || i >= cs.length) { stamp.visible = false; smat.opacity = 0; continue }
      stamp.visible = true
      const c = cs[i]
      const cx = feet.x + offX + v.facing * c.ox * (1 - conv)
      const coreW = Math.max(w * 0.14, c.halfW * 2) * 1.35 * shrink
      const coreD = w * 0.26 * shrink
      stamp.position.set(cx, WORLD.GROUND_Y + 0.02, 0)
      stamp.scale.set(coreW, coreD, 1)
      // Dark and crisp planted, lighter and softer airborne. Extra cores beyond
      // the first fade out as the fighter rises so mid-air is one faint pool, not
      // a stack of overlapping (and thus darker) ellipses.
      const extraFade = i === 0 ? 1 : 1 - lift
      const peak = (0.92 - 0.62 * lift) * c.strength
      smat.opacity = THREE.MathUtils.clamp(peak, 0.12, 0.92) * (1 - this.dissolve) * extraFade
    }
  }

  /** Chest-height world anchor (x, y, z) for the stage's shadow/reflection sync. */
  chestAnchor(out = new THREE.Vector3()): THREE.Vector3 {
    const half = this.assets ? (this.assets.heightCm * CM_TO_WORLD) * 0.55 : 1.6
    return out.set(this.mesh.position.x, WORLD.GROUND_Y + half, 0)
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    for (const stamp of this.shadowStamps) {
      stamp.geometry.dispose()
      ;(stamp.material as THREE.Material).dispose()
    }
    this.bloomMask.geometry.dispose()
    ;(this.bloomMask.material as THREE.Material).dispose()
    this.group.parent?.remove(this.group)
  }
}
