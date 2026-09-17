// Parity check, JS side. Snapshots the frontend's original indicators.js (so
// we're always testing the real file, not a hand-kept copy), feeds it several
// deterministic synthetic price series (random walk, trends, chop) so the
// BUY/SELL/STRONG branches and score-rounding edge cases actually get
// exercised, and dumps input+output for the Python side to compare against
// signal_engine.py's compute_signal.
//
// indicators.js was deleted once the Python port passed this check, so the
// snapshot is read from the last commit that still had it.
import { writeFileSync, unlinkSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const tmpPath = path.resolve(__dirname, '_indicators_snapshot.mjs')

const git = cmd => execSync(`git ${cmd}`, { cwd: __dirname, encoding: 'utf8' })
const deletedIn = git('log -n 1 --format=%H --diff-filter=D -- ../../src/indicators.js').trim()
writeFileSync(tmpPath, git(`show ${deletedIn}~1:src/indicators.js`))
let computeSignal
try {
  ;({ computeSignal } = await import(pathToFileURL(tmpPath).href))
} finally {
  unlinkSync(tmpPath)
}

function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function genSeries({ seed, drift, amp, n }) {
  const rand = mulberry32(seed)
  let price = 50000
  const closes = []
  for (let i = 0; i < n; i++) {
    price += drift + (rand() - 0.5) * amp
    price = Math.max(price, 1)
    closes.push(Math.round(price * 100) / 100)
  }
  return closes
}

const cases = {
  random_walk_1:     { seed: 42, drift: 0,   amp: 200, n: 400 },
  random_walk_2:      { seed: 7,  drift: 0,   amp: 150, n: 400 },
  uptrend:            { seed: 1,  drift: 15,  amp: 120, n: 400 },
  downtrend:          { seed: 2,  drift: -15, amp: 120, n: 400 },
  strong_uptrend:     { seed: 3,  drift: 40,  amp: 80,  n: 400 },
  strong_downtrend:   { seed: 4,  drift: -40, amp: 80,  n: 400 },
  choppy:             { seed: 5,  drift: 0,   amp: 400, n: 400 },
  mild_grind_up:      { seed: 6,  drift: 5,   amp: 250, n: 400 },
  mild_grind_down:    { seed: 8,  drift: -5,  amp: 250, n: 400 },
  tight_range:        { seed: 9,  drift: 0,   amp: 20,  n: 400 },
}

const out = {}
const summary = []
for (const [name, params] of Object.entries(cases)) {
  const closes = genSeries(params)
  const result = computeSignal(closes)
  out[name] = { closes, result }
  summary.push(`${name}: ${result.signal} strength=${result.strength} total=${result.total}`)
}

writeFileSync(path.resolve(__dirname, 'parity_cases.json'), JSON.stringify(out))
console.log('[js] generated %d cases:', Object.keys(cases).length)
for (const line of summary) console.log('  -', line)
