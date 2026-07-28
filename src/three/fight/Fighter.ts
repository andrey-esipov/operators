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
  g.addColorStop(0, 'rgba(0,0,0,0.9)')
  g.addColorStop(0.55, 'rgba(0,0,0,0.5)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.NoColorSpace
  sharedShadowTex = t
  return t
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
  private shadow: THREE.Mesh
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

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: shadowTexture(),
        transparent: true,
        depthWrite: false,
        // The shadow sits a hair above the floor (y≈0.02). At the near-level
        // fighting-game camera that gap is far below the depth buffer's ability
        // to separate it from the reflective floor plane at y=0, so with depth
        // testing on the shadow z-fought the floor and dropped out entirely —
        // the "sprite pasted on the floor with no contact" tell that survived
        // for five sessions. It's a ground decal: draw it purely by renderOrder
        // (after the floor/groundfog at <=4, before the sprite at 10) and never
        // depth-test it against the floor it is meant to darken.
        depthTest: false,
        opacity: 0.85,
        color: 0x000000,
      }),
    )
    this.shadow.rotation.x = -Math.PI / 2
    this.shadow.position.y = WORLD.GROUND_Y + 0.02
    this.shadow.renderOrder = 5

    this.group.add(this.shadow, this.mesh, this.bloomMask)
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

    // ---- Contact shadow ---------------------------------------------------
    // A ground decal that ties the fighter to the floor. It must SHRINK, fade
    // and soften as the fighter leaves the ground (a small faint pool directly
    // below reads as height; a shadow that grew would read as nearing a light),
    // and it must lean away from the stage key light rather than sit as a
    // symmetric blob.
    const airborne = Math.max(0, v.pos.y) * CM_TO_WORLD // world units above floor
    const w = this.bodyWidth
    const lift = THREE.MathUtils.clamp(airborne / (WORLD.FIGHTER_HEIGHT * 0.9), 0, 1)
    const shrink = 1 - 0.5 * lift // tight on the ground, ~half size at jump apex
    const shadowW = w * 0.92 * shrink
    const shadowD = w * 0.3 * shrink
    // Cast opposite the key light's horizontal direction. uKeyDir points from the
    // surface toward the light (set by applyLighting above), so the pool leans to
    // the far side; the offset eases toward centre as the fighter rises.
    const kd = this.uniforms.uKeyDir.value
    const away = kd.x >= 0 ? -1 : 1
    const offX = away * w * 0.14 * (1 - 0.5 * lift)
    this.shadow.position.set(feet.x + offX, WORLD.GROUND_Y + 0.02, 0)
    this.shadow.scale.set(shadowW, shadowD, 1)
    const smat = this.shadow.material as THREE.MeshBasicMaterial
    // Dark and crisp planted, lighter and softer airborne.
    smat.opacity = THREE.MathUtils.clamp(0.85 - 0.62 * lift, 0.16, 0.85) * (1 - this.dissolve)
  }

  /** Chest-height world anchor (x, y, z) for the stage's shadow/reflection sync. */
  chestAnchor(out = new THREE.Vector3()): THREE.Vector3 {
    const half = this.assets ? (this.assets.heightCm * CM_TO_WORLD) * 0.55 : 1.6
    return out.set(this.mesh.position.x, WORLD.GROUND_Y + half, 0)
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.shadow.geometry.dispose()
    ;(this.shadow.material as THREE.Material).dispose()
    this.bloomMask.geometry.dispose()
    ;(this.bloomMask.material as THREE.Material).dispose()
    this.group.parent?.remove(this.group)
  }
}
