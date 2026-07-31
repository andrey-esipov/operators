# Projectile art contract (for the `src/three` projectile consumer)

This is the **authoritative, durable** spec for the projectile sprites in this
directory. It is generated from and kept in sync with the real
`frames.json` files here — do not infer the format, read this. A wrong guess
here reproduces exactly the four-pose-atlas failure that cost us weeks.

Projectiles are **objects, not characters**: there is no identity to preserve.
Each is selected at runtime by `Projectile.kind` (a string on the sim's
projectile object). The two kinds shipped today are `ion-bolt` and
`super-beam`.

## Load path

```
/projectiles/<kind>/frames.json   # manifest (this shape)
/projectiles/<kind>/atlas.png     # single horizontal sprite strip
```

`<kind>` is the exact `Projectile.kind` value: `ion-bolt`, `super-beam`.
Fetch `frames.json`, then `atlas.png` from the same directory. As with the
fighter loader, a dev server returns `index.html` (200) for a missing asset —
so **validate that the fetched body parses as this manifest**, don't trust
`res.ok` alone.

## `frames.json` shape

```jsonc
{
  "kind": "ion-bolt",        // matches Projectile.kind and the directory name
  "atlas": "atlas.png",      // filename, relative to this dir
  "frameW": 96,              // every frame cell is exactly this wide
  "frameH": 96,              // ...and this tall
  "anchor": { "x": 62, "y": 48 }, // frame-local hot-point, see below
  "travelDir": "right",      // art is drawn travelling +X; see mirroring
  "frames": [
    { "name": "spawn-0", "rect": { "x": 4, "y": 4, "w": 96, "h": 96 } },
    // ...one entry per frame, in atlas order
  ],
  "clips": {
    "spawn":  { "frames": [0,1,2,3],            "durations": [2,2,2,2],        "loop": false },
    "travel": { "frames": [4,5,6,7,8,9,10,11],  "durations": [3,3,3,3,3,3,3,3],"loop": true  },
    "impact": { "frames": [12,13,14,15,16,17],  "durations": [2,2,2,2,2,2],    "loop": false }
  }
}
```

### Field semantics

- **`frames[i].rect`** — the pixel box of frame `i` inside `atlas.png`
  (`x,y` = top-left, `w,h` = `frameW,frameH`). Blit this rect; do not compute
  cells yourself.
- **`clips`** — the three lifecycle phases. `frames` are **indices into the
  `frames[]` array** (not rects). `durations[i]` is how many **60fps sim
  ticks** frame `i` of that clip is shown (parallel array, same length as
  `frames`). `loop` — `travel` loops until the projectile despawns; `spawn`
  and `impact` play once.
- Play order over a projectile's life: `spawn` (once) → `travel` (loop while
  in flight) → `impact` (once, on hit/expiry).

### Anchor convention (critical — this is the pivot)

`anchor{x,y}` is a **frame-local** point, measured in pixels from the frame's
top-left corner. It is the projectile's **hot-point**: draw the sprite so that
`anchor` sits exactly on the sim's `Projectile.{x,y}` world position. It is
both the spawn origin (where it leaves the caster's hand) and the point that
follows the projectile's position every tick. For these two kinds the anchor is
the bright leading core of the bolt, vertically centered
(`ion-bolt` = (62,48), `super-beam` = (104,64)).

### Mirroring for left-facing owners

Art is authored travelling **rightward** (`travelDir: "right"`). When the owner
faces left, mirror horizontally: flip the sprite on X and mirror the anchor to
`frameW - anchor.x` (so `ion-bolt` anchor x 62 → 34). `anchor.y` is unchanged.

## Atlas layout

Single **horizontal strip**, 4px padding around/between cells. Frame `i`'s rect
is `x = 4 + i*(frameW+4)`, `y = 4`, `w = frameW`, `h = frameH`. The
`frames[].rect` values are authoritative — read them rather than recomputing,
but this is the layout if you need to sanity-check.

## Current dimensions

| kind         | frameW | frameH | frames | spawn | travel(loop) | impact | anchor    |
|--------------|--------|--------|--------|-------|--------------|--------|-----------|
| `ion-bolt`   | 96     | 96     | 18     | 4     | 8            | 6      | (62,48)   |
| `super-beam` | 176    | 128    | 23     | 5     | 10           | 8      | (104,64)  |

## Rendering recommendation

These are bright, high-contrast energy sprites on transparent backgrounds.
Render with **additive / screen blend** so the core reads as light against the
busy stage. The travel loop is authored to loop seamlessly. Keep them large and
readable at speed — fireballs should be legible in a single frame at full
travel velocity.

## Review artifacts

`review/{spawn,travel,impact,lifecycle}.png` are filmstrips for eyeballing the
animation without running the game. They are for humans, not for loading.

---
_If you need a kind that isn't here (`Projectile.kind` values beyond these two),
ping the scripts agent — the generator (`scripts/generate-projectiles.ts`) emits
this exact shape and can add kinds without changing the contract._
