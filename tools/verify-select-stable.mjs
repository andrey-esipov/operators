import { chromium } from 'playwright-core'
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args:['--use-angle=metal','--no-sandbox'] })
const p = await b.newPage()
await p.goto('http://localhost:5399/?select=1', { waitUntil: 'domcontentloaded' })
let n = 0
p.on('framenavigated', (f) => { if (f === p.mainFrame()) n++ })
await new Promise((r) => setTimeout(r, 16000))
await b.close()
process.exit(n === 0 ? 0 : 1)
