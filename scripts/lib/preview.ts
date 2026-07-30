/**
 * Review artefacts.
 *
 * A static grid proves identity and that every pose came back on-model, but it
 * cannot reveal a hitchy walk or a punch that skips. So three things get
 * written per fighter:
 *
 *  - contact-sheet.png   every unique frame in a labelled grid — the "is this
 *                        the same character in every pose" check.
 *  - filmstrip-*.png     each motion clip laid out in playback order on a
 *                        shared baseline — flip your eye across it and a jerky
 *                        cycle or a foot that slides is obvious in a still.
 *  - preview.html        the atlas played back for real, every clip looping,
 *                        so a human (or a critic agent) can judge motion.
 *
 * The filmstrips are what let this pipeline's own output be judged without a
 * browser: they render straight to PNG.
 */
import sharp from 'sharp'
import type { FighterAssets } from '../../src/fight/types'
import { CLIPS } from './frame-spec'

const BG = { r: 22, g: 24, b: 32, alpha: 1 }
const LINE = { r: 60, g: 64, b: 80, alpha: 1 }

/** Registered frames on a shared canvas, keyed by name. */
export type RegMap = Map<string, { buf: Buffer; w: number; h: number }>

async function label(text: string, w: number): Promise<Buffer> {
  const svg = `<svg width="${w}" height="18" xmlns="http://www.w3.org/2000/svg">
    <text x="4" y="13" font-family="monospace" font-size="12" fill="#9fb0c8">${text}</text></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** All unique frames in a labelled grid. */
export async function contactSheet(
  frames: { name: string; buf: Buffer }[],
  cell: number,
  cols: number,
): Promise<Buffer> {
  const rows = Math.ceil(frames.length / cols)
  const cellH = cell + 20
  const width = cols * cell
  const height = rows * cellH
  const layers: sharp.OverlayOptions[] = []

  for (let i = 0; i < frames.length; i++) {
    const col = i % cols
    const row = (i / cols) | 0
    const x = col * cell
    const y = row * cellH
    const scaled = await sharp(frames[i].buf).resize(cell, cell, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    layers.push({ input: scaled, left: x, top: y })
    layers.push({ input: await label(frames[i].name, cell), left: x, top: y + cell })
  }

  return sharp({ create: { width, height, channels: 4, background: BG } })
    .composite(layers)
    .png()
    .toBuffer()
}

/**
 * One clip laid out left-to-right in playback order, each frame on the same
 * baseline as it will animate. Because the registered frames share a canvas
 * and origin, a foot that slides or a body that pops between keys shows up as
 * a jump along the strip.
 */
export async function clipFilmstrip(
  clipName: string,
  reg: RegMap,
  cell: number,
): Promise<Buffer | null> {
  const spec = CLIPS[clipName]
  if (!spec) return null
  const names = spec.frames
  if (names.some((n) => !reg.has(n))) return null

  const cellH = cell + 20
  const width = names.length * cell
  const layers: sharp.OverlayOptions[] = []
  for (let i = 0; i < names.length; i++) {
    const x = i * cell
    const scaled = await sharp(reg.get(names[i])!.buf)
      .resize(cell, cell, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer()
    layers.push({ input: scaled, left: x, top: 0 })
    layers.push({ input: await label(`${i}:${names[i]}`, cell), left: x, top: cell })
    if (i > 0) {
      layers.push({
        input: { create: { width: 1, height: cell, channels: 4, background: LINE } },
        left: x,
        top: 0,
      })
    }
  }
  return sharp({ create: { width, height: cellH, channels: 4, background: BG } })
    .composite(layers)
    .png()
    .toBuffer()
}

/**
 * A self-contained page that plays every clip off the packed atlas. The atlas
 * is referenced by relative path so the file works dropped next to
 * atlas.webp/assets.json. Each frame is drawn with its anchor on a fixed
 * baseline, exactly as the renderer will, so what you see here is what the
 * game will show.
 */
export function previewHtml(assets: FighterAssets, atlasHref: string): string {
  const data = JSON.stringify({ frames: assets.frames, clips: assets.clips, id: assets.id })
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${assets.id} — animation preview</title>
<style>
  body{margin:0;background:#12141c;color:#c8d2e0;font:13px/1.4 monospace}
  h1{font-size:15px;padding:12px 16px;margin:0;border-bottom:1px solid #2a2e3c}
  .grid{display:flex;flex-wrap:wrap;gap:14px;padding:16px}
  .clip{background:#181b24;border:1px solid #2a2e3c;border-radius:6px;padding:8px;width:180px}
  .clip canvas{display:block;background:#0c0e14;border-radius:3px;image-rendering:pixelated;width:164px;height:164px}
  .clip .name{margin-top:6px;color:#9fb0c8}
  .clip .meta{color:#5f6b82;font-size:11px}
</style></head><body>
<h1>${assets.id} — ${assets.frames.length} frames, ${Object.keys(assets.clips).length} clips · atlas plays at 60fps</h1>
<div class="grid" id="grid"></div>
<script>
const A = ${data};
const img = new Image();
img.src = ${JSON.stringify(atlasHref)};
img.onload = () => {
  const grid = document.getElementById('grid');
  // Shared baseline: place every anchor at this canvas point so clips that
  // change height (crouch, knockdown) sit on the floor instead of centring.
  const CW = 164, CH = 164, BASELINE_Y = 150, ORIGIN_X = 82;
  for (const [name, clip] of Object.entries(A.clips)) {
    const wrap = document.createElement('div'); wrap.className = 'clip';
    const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH;
    const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false;
    wrap.appendChild(cv);
    const nm = document.createElement('div'); nm.className='name'; nm.textContent = name;
    const mt = document.createElement('div'); mt.className='meta';
    mt.textContent = clip.frames.length + ' frame' + (clip.frames.length>1?'s':'') + (clip.loop?' · loop':'');
    wrap.appendChild(nm); wrap.appendChild(mt); grid.appendChild(wrap);

    let key = 0, elapsed = 0, done = false;
    // Scale the tallest frame in the clip to fit the cell, apply to all so the
    // character keeps a constant size across the clip.
    let maxH = 1; for (const fi of clip.frames) maxH = Math.max(maxH, A.frames[fi].rect.h);
    const scale = Math.min(1, (CH - 12) / maxH);
    function draw() {
      const fi = clip.frames[key];
      const f = A.frames[fi];
      ctx.clearRect(0,0,CW,CH);
      const dw = f.rect.w*scale, dh = f.rect.h*scale;
      const dx = ORIGIN_X - f.anchor.x*scale;
      const dy = BASELINE_Y - f.anchor.y*scale;
      ctx.drawImage(img, f.rect.x, f.rect.y, f.rect.w, f.rect.h, dx, dy, dw, dh);
    }
    function tick() {
      draw();
      elapsed++;
      if (elapsed >= clip.durations[key]) {
        elapsed = 0; key++;
        if (key >= clip.frames.length) { if (clip.loop) key = 0; else { key = clip.frames.length-1; done = true; } }
      }
      // 60fps sim clock, throttled to ~30fps wall time for legibility.
      if (!done || clip.loop) setTimeout(() => requestAnimationFrame(tick), 33);
    }
    tick();
  }
};
</script></body></html>`
}

/**
 * Clips worth a filmstrip — the ones whose motion quality actually matters.
 *
 * STALE PREMISE CORRECTED: this list originally omitted crouch/block/dash/
 * backdash/jump-fall because those clips shipped as a SINGLE cel on every
 * fighter, and a one-cel clip has no motion to judge — excluding them was
 * right at the time. They now carry 3-4 cels across the roster, so the reason
 * for the omission no longer holds and the clips a player dwells in longest
 * were the ones with no reviewable artefact.
 *
 * The rule this encodes: a clip earns a filmstrip once it has more than one
 * cel, so the list must be revisited whenever locomotion density changes.
 */
export const FILMSTRIP_CLIPS = [
  'idle', 'walk-fwd', 'walk-back', 'hp', 'hk', 'special-fireball', 'special-uppercut',
  'jump-rise', 'jump-fall', 'crouch', 'block', 'dash', 'backdash',
]
