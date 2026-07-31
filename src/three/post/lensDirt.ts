import * as THREE from 'three'

/**
 * A procedural lens-dirt / grime texture.
 *
 * Layered soft specks and smudges, brighter toward a few hot spots — the sort
 * of dust and grease a real camera front element accumulates. Multiplied by the
 * bloom buffer so grime only lights up where there's an actual bright source.
 */
export function makeLensDirt(size = 512, seed = 1337): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  // Deterministic RNG so screenshots are stable.
  let s = seed >>> 0
  const rnd = () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 0xffffffff
  }

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, size, size)

  // Broad greasy smudges.
  for (let i = 0; i < 26; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const r = size * (0.04 + rnd() * 0.18)
    const a = 0.05 + rnd() * 0.22
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(255,255,255,${a})`)
    g.addColorStop(0.5, `rgba(220,225,255,${a * 0.4})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }

  // Fine dust specks.
  for (let i = 0; i < 900; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const r = rnd() < 0.9 ? 0.6 + rnd() * 1.6 : 2 + rnd() * 4
    const a = 0.1 + rnd() * 0.5
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255,255,255,${a})`
    ctx.fill()
  }

  // A couple of scratch streaks.
  for (let i = 0; i < 5; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const len = size * (0.1 + rnd() * 0.35)
    const ang = rnd() * Math.PI
    ctx.strokeStyle = `rgba(255,255,255,${0.06 + rnd() * 0.1})`
    ctx.lineWidth = 0.6 + rnd() * 1.2
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len)
    ctx.stroke()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true
  return tex
}
