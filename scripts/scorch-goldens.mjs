#!/usr/bin/env node
// Independent rule oracle: execute original abilities.js callbacks and Row
// methods. Only card-zone storage, DOM work and animation waits are adapted.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'gwent.js'), 'utf8')
function method(signature, globals) {
  const start = source.indexOf(signature)
  if (start < 0 || source.indexOf(signature, start + 1) >= 0)
    throw new Error(`Non-unique method: ${signature}`)
  let depth = 0,
    end = -1
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}' && --depth === 0) {
      end = i + 1
      break
    }
  }
  if (end < 0) throw new Error(`Unbalanced method: ${signature}`)
  return vm.runInNewContext(
    `(${signature.startsWith('async ') ? 'async function ' : 'function '}${source.slice(start + (signature.startsWith('async ') ? 6 : 0), end)})`,
    globals,
    { timeout: 1000 },
  )
}
const game = { doubleSpyPower: false }
const globals = { game, isNumber: Number.isFinite }
const score = method('calcCardScore(card) {', globals)
const maxUnits = method('maxUnits(){', globals)
const updateState = method('updateState(card, activate){', globals)
let seed = 0x73636f72
const next = () => {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return seed >>> 0
}
const choice = (values) => values[next() % values.length]
const kinds = ['', '', 'spy', 'bond', 'morale', 'horn', 'hero']
const names = ['close', 'ranged', 'siege']
const cases = []
for (const mode of ['special', 'unit', ...names]) {
  for (let n = 0; n < 24; n++) {
    const weather = choice(['', '', 'frost', 'fog', 'rain', 'storm'])
    const input = { mode, weather: weather ? [weather] : [], horns: [], units: [] }
    const players = [0, 1].map((owner) => ({
      owner,
      grave: [],
      hand: { cards: [] },
      opponent: () => players[1 - owner],
    }))
    const rows = [0, 1].flatMap((owner) =>
      names.map((row) => {
        const horn = next() % 4 === 0
        input.horns.push(horn)
        const effects = {
          weather:
            row === 'close'
              ? weather === 'frost'
              : row === 'ranged'
                ? ['fog', 'storm'].includes(weather)
                : ['rain', 'storm'].includes(weather),
          halfWeather: false,
          bond: {},
          morale: 0,
          horn: Number(horn),
          mardroeme: 0,
        }
        const result = {
          owner,
          type: row,
          cards: [],
          effects,
          total: 0,
          calcCardScore: score,
          maxUnits,
          updateState,
        }
        result.updateScore = () => {
          result.total = result.cards.reduce((sum, card) => {
            card.power = score.call(result, card)
            return sum + card.power
          }, 0)
        }
        return result
      }),
    )
    function add(definition) {
      input.units.push(definition)
      const card = {
        ...definition,
        holder: players[definition.owner],
        basePower: definition.power,
        hero: definition.ability === 'hero',
        abilities: definition.ability && definition.ability !== 'hero' ? [definition.ability] : [],
        animate: async () => {},
        id: () => definition.name,
      }
      card.isUnit = () => !card.hero && names.includes(card.row)
      const row = rows[card.owner * 3 + names.indexOf(card.row)]
      row.cards.push(card)
      updateState.call(row, card, true)
      return card
    }
    for (const row of rows) {
      const count = next() % 5
      for (let i = 0; i < count; i++) {
        const ability = choice(kinds)
        add({
          uid: `u-${row.owner}-${row.type}-${i}`,
          name: ability === 'bond' ? 'Bonded unit' : `Unit ${row.owner}-${row.type}-${i}`,
          owner: row.owner,
          row: row.type,
          power: next() % 17,
          ability,
        })
      }
    }
    const sourceRow = mode === 'unit' ? 'ranged' : mode === 'special' ? '' : mode
    const sourceAbility = names.includes(mode) ? `scorch_${mode[0]}` : 'scorch'
    const sourceDef = {
      uid: 'source',
      name: 'Scorch source',
      owner: 0,
      row: sourceRow,
      power: mode === 'unit' ? 6 : 0,
      ability: sourceAbility,
    }
    const card = mode === 'special' ? { ...sourceDef, holder: players[0] } : add(sourceDef)
    if (mode === 'special') players[0].hand.cards.push(card)
    for (const row of rows) row.updateScore()
    const board = {
      row: rows,
      getRow: (_card, row, player) => rows[player.owner * 3 + names.indexOf(row)],
      toGrave: async (card, from) => {
        const index = from.cards.indexOf(card)
        if (index < 0) throw new Error('Legacy callback removed a card twice')
        from.cards.splice(index, 1)
        players[card.holder.owner].grave.push(card.uid)
        if (from.effects) {
          updateState.call(from, card, false)
          from.updateScore()
        }
      },
    }
    const scorchRow = method('async scorch() {', { board })
    for (const row of rows) row.scorch = scorchRow
    const abilities = vm.runInNewContext(
      readFileSync(join(root, 'abilities.js'), 'utf8') + '\nability_dict',
      { board },
      { timeout: 1000 },
    )
    if (mode === 'special') await abilities.scorch.activated(card)
    else if (mode === 'unit') await abilities.scorch.placed(card, rows[names.indexOf(sourceRow)])
    else await abilities[sourceAbility].placed(card)
    input.expected = {
      rows: rows.map((row) => row.cards.map((card) => card.uid).sort()),
      graves: players.map((player) => player.grave.sort()),
      scores: [0, 1].map((owner) =>
        rows.filter((row) => row.owner === owner).reduce((sum, row) => sum + row.total, 0),
      ),
    }
    cases.push(input)
  }
}
const output =
  JSON.stringify(
    { source: 'abilities.js Scorch callbacks + gwent.js Row methods', seed: '0x73636f72', cases },
    null,
    2,
  ) + '\n'
const target = join(root, 'internal/game/testdata/original-scorch-goldens.json')
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) {
    console.error(
      'Original Scorch behavior changed; regenerate fixtures with node scripts/scorch-goldens.mjs',
    )
    process.exitCode = 1
  } else console.log(`Verified ${cases.length} original JavaScript Scorch transitions`)
} else {
  writeFileSync(target, output)
  console.log(`Generated ${cases.length} original JavaScript Scorch transitions`)
}
