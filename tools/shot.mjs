#!/usr/bin/env node
/**
 * Screenshot harness for Operators. THREE routes — and the default is now the
 * SHIPPED FIGHTING GAME, not the card battler.
 *
 * This repo ships two games behind one dev server:
 *   - the shipped 2D fighter → ?fight=1 (window.__FIGHT__, deterministic dev
 *     harness) and ?play=1 (window.__PLAY__, live match), both drawn by
 *     FightRenderer + FightVfx / ProjectileLayer.
 *   - a legacy card battler  → ?lab=1 (window.__OPS3D__), drawn by FightScene3D
 *     + VfxSubsystem.
 * For most of this project's life THIS TOOL hardcoded ?lab=1 and waited on
 * __OPS3D__, so every generic screenshot it ever took was of the card battler
 * — the game we do not sell. It now defaults to the shipped fighter. The lab is
 * still reachable, behind --route lab.
 *
 *   node tools/shot.mjs --port 5173 --out shots/x.png \
 *        --stage hypergrowth --a chesky --b lenny --do 'seek:177'
 *
 * ROUTES
 *   --route fight  (default) shipped fighter, deterministic harness (__FIGHT__).
 *                  The action is a scripted AI-vs-AI sim; you SEEK/STEP to the
 *                  frame you want rather than posing anyone. --a/--b pick the
 *                  visuals, --params 'p1=warden&p2=operator' the mechanics,
 *                  --params 'sim=mock&seed=1' full determinism.
 *   --route play   shipped fighter, live playable match (__PLAY__). Best-effort
 *                  wall-clock capture (the live sim is not frame-frozen).
 *   --route lab    legacy card battler (__OPS3D__). Opt-in only, and the ONLY
 *                  route that supports the puppet commands below, because that
 *                  API exists only on the card lab.
 *
 * --do is a semicolon-separated list. Commands by route:
 *   fight: seek:<frame>  wait:<frames>  phase:<name>  stage:<id>
 *   play:  wait:<frames>
 *   lab:   pose:<side>:<pose>  hp:<side>:<v>  super:<side>:<v>
 *          hit:<flavor>[:<side>[:<power>]]  ko:<side>  shatter:<side>
 *          quality:<q>  wait:<frames>  stage:<id>
 * A puppet command (hit/pose/hp/...) without --route lab is a HARD ERROR, not a
 * silent no-op — a screenshot that quietly ignored your hit: is exactly how
 * this tool spent the project photographing the wrong game.
 *
 * Frames advance on a FIXED timestep so two captures of the same moment are
 * directly comparable. --realtime falls back to wall-clock RAF; --dt <ms> sets
 * the step size.
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt
}
const flag = (name) => argv.includes(`--${name}`)

const route = arg('route', 'fight')
const HANDLES = { fight: '__FIGHT__', play: '__PLAY__', lab: '__OPS3D__' }
const HANDLE = HANDLES[route]
if (!HANDLE) {
  console.log(JSON.stringify({ ok: false, error: `unknown --route '${route}'; expected one of ${Object.keys(HANDLES).join(', ')}` }))
  process.exit(1)
}
const isLab = route === 'lab'

const port = arg('port', '5173')
const out = resolve(arg('out', '/tmp/opshots/shot.png'))
const stage = arg('stage', isLab ? 'hypergrowth' : 'ipo-prep')
const a = arg('a', 'chesky')
const b = arg('b', 'lenny')
const width = Number(arg('width', 1920))
const height = Number(arg('height', 1080))
const settle = Number(arg('settle', 30))
const quality = arg('quality', 'ultra')
const script = arg('do', '')
const timeoutMs = Number(arg('timeout', 60000))
const extraParams = arg('params', '')

// Command sets per game. The shipped fighter is a SIMULATION you step through;
// the card lab is a PUPPET you pose and hit directly. They share no API, so a
// command legal on one is illegal on the other — enforced up front, not hoped.
const CMDSET = {
  fight: new Set(['seek', 'wait', 'phase', 'stage']),
  play: new Set(['wait']),
  lab: new Set(['pose', 'hp', 'super', 'hit', 'ko', 'shatter', 'wait', 'quality', 'stage']),
}
const LAB_ONLY = new Set(['pose', 'hp', 'super', 'hit', 'ko', 'shatter', 'quality'])

const cmds = script.split(';').map((s) => s.trim()).filter(Boolean).map((raw) => {
  const parts = raw.split(':')
  return { cmd: parts[0], rest: parts.slice(1), raw }
})
// Validate BEFORE launching a browser: a card-only command or a typo fails in a
// millisecond with a clear message, never after a 60s render that ignored it.
for (const { cmd, raw } of cmds) {
  if (!CMDSET[route].has(cmd)) {
    const hint =
      LAB_ONLY.has(cmd) && !isLab
        ? `'${cmd}' is a card-battler puppet command; it exists only on --route lab. The shipped fighter is a simulation — drive it with seek:/wait:/phase:.`
        : `allowed for --route ${route}: ${[...CMDSET[route]].join(', ')}`
    console.log(JSON.stringify({ ok: false, error: `bad --do '${raw}': ${hint}` }))
    process.exit(1)
  }
}

mkdirSync(dirname(out), { recursive: true })

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: false,
  args: [
    '--use-angle=metal',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--hide-scrollbars',
    '--mute-audio',
    '--window-position=4000,4000',
    `--window-size=${width},${height}`,
  ],
})

const errors = []
try {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: Number(arg('dpr', 2)),
  })
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })

  // Route-specific URL. Only --route lab addresses the card battler.
  const qp = new URLSearchParams()
  if (route === 'lab') {
    qp.set('lab', '1'); qp.set('hud', '0'); qp.set('quality', quality)
    qp.set('stage', stage); qp.set('a', a); qp.set('b', b)
  } else if (route === 'fight') {
    qp.set('fight', '1'); qp.set('stage', stage); qp.set('a', a); qp.set('b', b)
  } else {
    // play → a matchup signal routes decideRoute() to the live shipped match.
    qp.set('stage', stage); qp.set('a', a); qp.set('b', b); qp.set('cpu', arg('cpu', 'dummy'))
  }
  let url = `http://localhost:${port}/?${qp.toString()}`
  if (extraParams) url += `&${extraParams}`
  await page.goto(url, { waitUntil: 'load', timeout: timeoutMs })

  await page.waitForFunction((h) => window[h]?.ready?.() === true, HANDLE, {
    timeout: timeoutMs,
  })

  // Freeze the loop before the script runs so the ENTIRE capture advances on the
  // virtual clock. __OPS3D__ stops its own engine; the shipped harness pauses.
  // The live match (__PLAY__) is not frame-frozen, so it stays on wall clock.
  if (!flag('realtime') && route !== 'play') {
    await page.evaluate(([h, r]) => {
      const api = window[h]
      if (r === 'lab') api.engine.stop()
      else api.pause()
    }, [HANDLE, route])
  }

  for (const { cmd, rest } of cmds) {
    await page.evaluate(
      ([h, r, cmd, rest]) => {
        const api = window[h]
        const n = (v) => Number(v)
        if (r === 'lab') {
          switch (cmd) {
            case 'pose': api.setPose(rest[0], rest[1]); break
            case 'hp': api.setHp(rest[0], n(rest[1])); break
            case 'super': api.setSuper(rest[0], n(rest[1])); break
            case 'hit': api.hit(rest[0], rest[1] ?? 'b', rest[2] ? n(rest[2]) : undefined); break
            case 'ko': api.ko(rest[0] ?? 'b'); break
            case 'shatter': api.shatter(rest[0] ?? 'b'); break
            case 'wait': api.step(n(rest[0]) || 1); break
            case 'quality': api.quality(rest[0]); break
            case 'stage': api.setStage(rest[0]); break
          }
        } else {
          switch (cmd) {
            case 'seek': api.seek(n(rest[0]) || 0); break
            case 'wait': api.step(n(rest[0]) || 1); break
            case 'stage': api.setStage(rest[0]); break
            case 'phase': {
              const want = rest[0]
              for (let i = 0; i < 2400 && api.phase && api.phase() !== want; i++) api.step(1)
              break
            }
          }
        }
      },
      [HANDLE, route, cmd, rest],
    )
  }

  // Deterministic settle on the virtual clock (fight/lab). The live match steps
  // a frame budget the rAF loop drains, so give it wall-clock time to catch up.
  if (route === 'play') {
    await page.evaluate(([h, n]) => window[h].step(n), [HANDLE, settle])
    await page.waitForTimeout(Math.max(250, Math.round((settle * 1000) / 60)))
  } else if (flag('realtime')) {
    await page.evaluate(([h, n]) => window[h].settle(n), [HANDLE, settle])
  } else {
    await page.evaluate(
      ([h, n, dt]) => window[h].step(n, dt),
      [HANDLE, settle, Number(arg('dt', 1000 / 60))],
    )
  }
  const canvas = page.locator('canvas').first()
  await canvas.screenshot({ path: out, animations: 'disabled' })
  if (flag('json')) {
    console.log(JSON.stringify({ ok: true, route, handle: HANDLE, out, errors }))
  } else {
    console.log(`saved ${out} (route=${route}, ${HANDLE})`)
    if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 12).join('\n'))
  }
} catch (err) {
  console.log(JSON.stringify({ ok: false, route, error: String(err), errors: errors.slice(0, 12) }))
  process.exitCode = 1
} finally {
  await browser.close()
}
