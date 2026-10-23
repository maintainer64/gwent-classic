#!/usr/bin/env node
// Regression oracle: execute the REAL original Row.calcCardScore method from
// gwent.js and store its results for the authoritative Go implementation.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'gwent.js'), 'utf8')
const signature = 'calcCardScore(card) {'
const start = source.indexOf(signature)
if (start < 0 || source.indexOf(signature, start + 1) >= 0) {
  throw new Error('Original Row.calcCardScore method not found exactly once')
}
let depth = 0
let end = -1
for (let i = source.indexOf('{', start); i < source.length; i++) {
  if (source[i] === '{') depth++
  if (source[i] === '}' && --depth === 0) { end = i + 1; break }
}
if (end < 0) throw new Error('Unbalanced original Row.calcCardScore method')
const originalMethod = `function ${source.slice(start, end)}`
const game = { doubleSpyPower: false }
const legacyScore = vm.runInNewContext(`(${originalMethod})`, {
  game,
  isNumber: (value) => typeof value === 'number' && Number.isFinite(value),
}, { timeout: 1000 })

let seed = 0x6b77656e
const next = () => {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return seed >>> 0
}
const choice = (array) => array[next() % array.length]
const rows = ['close', 'ranged', 'siege']
const kinds = ['normal', 'normal', 'normal', 'spy', 'bond', 'bond', 'morale', 'horn', 'hero']
const cases = []
for (let n = 0; n < 384; n++) {
  const row = rows[n % 3]
  const weatherKind = choice(['none', 'none', 'frost', 'fog', 'rain', 'storm'])
  const weather = weatherKind === 'none' ? [] : [weatherKind]
  const activeWeather = (row === 'close' && weatherKind === 'frost') ||
    (row === 'ranged' && ['fog', 'storm'].includes(weatherKind)) ||
    (row === 'siege' && ['rain', 'storm'].includes(weatherKind))
  const bran = (next() % 3) === 0
  const doubleSpy = (next() % 4) === 0
  const virtualHorn = (next() % 3) === 0
  const count = 1 + (next() % 7)
  const units = []
  for (let j = 0; j < count; j++) {
    const kind = choice(kinds)
    const name = kind === 'bond' ? choice(['Bond A', 'Bond B']) : `Unit ${n}-${j}`
    units.push({
      uid: `unit-${j}`,
      name,
      power: next() % 19,
      ability: kind === 'normal' ? '' : kind,
    })
  }
  const bond = Object.create(null)
  let morale = 0
  let horn = Number(virtualHorn)
  for (const card of units) {
    if (card.ability === 'bond') bond[card.name] = (bond[card.name] ?? 0) + 1
    if (card.ability === 'morale') morale++
    if (card.ability === 'horn') horn++
  }
  game.doubleSpyPower = doubleSpy
  const effects = { weather: activeWeather, halfWeather: bran, bond, morale, horn }
  const expected = units.map(card => legacyScore.call({ effects }, {
    name: card.name,
    basePower: card.power,
    hero: card.ability === 'hero',
    abilities: card.ability ? [card.ability] : [],
    id: () => card.name,
  }))
  cases.push({ row, weather, bran, doubleSpy, virtualHorn, units, expected })
}
const output = JSON.stringify({ source: 'gwent.js Row.calcCardScore', seed: '0x6b77656e', cases }, null, 2) + '\n'
const target = join(root, 'internal/game/testdata/original-score-goldens.json')
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) {
    console.error('Original JS scoring changed or golden fixtures are stale: run node scripts/score-goldens.mjs')
    process.exitCode = 1
  } else {
    console.log(`Verified ${cases.length} golden row-score cases by executing original gwent.js`)
  }
} else {
  writeFileSync(target, output)
  console.log(`Generated ${cases.length} original JS row-score cases`)
}
