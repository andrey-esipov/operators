#!/usr/bin/env python3
"""Score silhouette separation from captured frames + projected fighter boxes.

SIGNED mean contrast is a trap and this script learned it the hard way. When the
character grade was blowing every fighter into a white ghost, signed contrast
looked GREAT (+64 on crisis); the moment the fighters were fixed so their black
suits read as black, signed contrast went NEGATIVE and the metric called a
transformative improvement a regression. Silhouette read does not care which
side is brighter, only that the two separate.

So the headline is |sep| -- absolute distance between the fighter's value and
the value of the ground immediately behind it -- plus edge, the mean luminance
gradient across the silhouette boundary, which is what the eye actually resolves.

fighter : mean luminance inside the two fighter boxes
bgRing  : mean luminance of the ring immediately around them. A frame-wide
          background mean is useless here: a blown wall behind one head averages
          away against a dark floor and says "fine" while the head has vanished.
|sep|   : abs(fighter - bgRing). Target >= 30.
ringP90 : brightest 10% of that ring. Above ~235 means clipped highlights are
          sitting against the silhouette, which no amount of mean separation
          rescues.
edge    : mean |grad(luma)| on the box boundary. Higher = crisper read.
"""
import json, sys
import numpy as np
from PIL import Image

boxes_path = sys.argv[1]
runs = json.load(open(boxes_path))

print(f"{'stage':<14} {'fighter':>8} {'bgRing':>8} {'|sep|':>7} {'ringP90':>8} {'edge':>7}")
print("-" * 60)
rows = []
for r in runs:
    im = np.asarray(Image.open(r["png"]).convert("RGB"), dtype=np.float32)
    H, W, _ = im.shape
    lum = im @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)

    inner = np.zeros((H, W), dtype=bool)
    ring = np.zeros((H, W), dtype=bool)
    for b in r["boxes"]:
        x0 = int((b["cx"] - b["halfW"]) * W); x1 = int((b["cx"] + b["halfW"]) * W)
        y0 = int(b["top"] * H); y1 = int(b["bot"] * H)
        inner[max(0, y0):min(H, y1), max(0, x0):min(W, x1)] = True
        # Ring: same box grown 2.2x horizontally and 1.15x vertically.
        gw = (x1 - x0) * 1.1; gh = (y1 - y0) * 0.075
        rx0 = int(x0 - gw); rx1 = int(x1 + gw)
        ry0 = int(y0 - gh); ry1 = int(y1 + gh)
        ring[max(0, ry0):min(H, ry1), max(0, rx0):min(W, rx1)] = True
    ring &= ~inner

    f = float(lum[inner].mean())
    bg = float(lum[ring].mean())
    p90 = float(np.percentile(lum[ring], 90))
    # Edge crispness: gradient magnitude sampled on the silhouette boundary,
    # i.e. the pixels the eye uses to resolve the character from the arena.
    gy, gx = np.gradient(lum)
    grad = np.hypot(gx, gy)
    boundary = np.zeros_like(inner)
    boundary[1:-1, 1:-1] = inner[1:-1, 1:-1] ^ inner[:-2, 1:-1] | inner[1:-1, 1:-1] ^ inner[1:-1, :-2]
    band = np.zeros_like(inner)
    for dy in range(-6, 7):
        for dx in range(-6, 7):
            band |= np.roll(np.roll(boundary, dy, 0), dx, 1)
    edge = float(grad[band].mean())
    sep = abs(f - bg)
    rows.append((r["stage"], f, bg, sep, p90, edge))
    print(f"{r['stage']:<14} {f:8.1f} {bg:8.1f} {sep:7.1f} {p90:8.1f} {edge:7.2f}")

print("-" * 60)
sp = [x[3] for x in rows]; p9 = [x[4] for x in rows]; ed = [x[5] for x in rows]
print(f"{'MEAN':<14} {'':>8} {'':>8} {np.mean(sp):7.1f} {np.mean(p9):8.1f} {np.mean(ed):7.2f}")
print(f"{'WORST':<14} {'':>8} {'':>8} {min(sp):7.1f} {max(p9):8.1f} {min(ed):7.2f}")
fails = [x[0] for x in rows if x[3] < 30 or x[4] > 235]
print(f"\nFAIL (|sep| < 30 or ringP90 > 235): {', '.join(fails) if fails else 'none'}")
