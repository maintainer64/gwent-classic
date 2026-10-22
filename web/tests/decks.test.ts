import { describe, expect, it } from 'vitest'
import definitions from '../../internal/game/catalog.json'
import type { Catalog, Faction, GameCard, Player } from '../src/domain/types'
import {
  copyDeck,
  importDeck,
  loadLibrary,
  saveLibrary,
  starter,
  stats,
  toPayload,
} from '../src/features/decks/model'
import { legalRows } from '../src/features/match/rules'
import { cardsText } from '../src/i18n/ru'
const catalog: Catalog = {
  factions: ['realms', 'nilfgaard', 'monsters', 'scoiatael', 'skellige'],
  cards: definitions.flatMap((d, id) =>
    d.row === 'leader' || !Number(d.count)
      ? []
      : [
          {
            ...d,
            id,
            faction: d.deck,
            power: Number(d.strength) || 0,
            maxCopies: Number(d.count),
            description: 'Описание',
            image: '',
            descriptionEn: 'Description',
          },
        ],
  ),
  leaders: definitions.flatMap((d, id) =>
    d.row === 'leader'
      ? [
          {
            id: id + 1,
            key: d.key,
            name: d.name,
            nameRu: d.nameRu,
            faction: d.deck as Faction,
            image: '',
            ability: d.ability,
            description: 'Способность',
            descriptionEn: 'Ability',
            passive: false,
          },
        ]
      : [],
  ),
}
class MemoryStorage implements Storage {
  data = new Map<string, string>()
  get length() {
    return this.data.size
  }
  clear() {
    this.data.clear()
  }
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
  setItem(key: string, value: string) {
    this.data.set(key, value)
  }
}
describe('library of decks', () => {
  it('builds a legal starter for every faction using stable IDs', () => {
    for (const f of catalog.factions) {
      const deck = starter(f, catalog)
      expect(stats(deck, catalog).valid).toBe(true)
      const payload = toPayload(deck, catalog)
      expect(payload.deck.every((e) => e.key && e.def >= 0)).toBe(true)
    }
  })
  it('preserves multiple decks and imports legacy storage without modifying it', () => {
    const storage = new MemoryStorage(),
      deck = starter('realms', catalog),
      payload = toPayload(deck, catalog),
      legacy = JSON.stringify({
        faction: deck.faction,
        leader: payload.leader - 1,
        cards: payload.deck.map((c) => [c.def, c.count]),
      })
    storage.setItem('gc-deck-realms', legacy)
    const library = loadLibrary(catalog, storage)
    expect(library).toHaveLength(6)
    expect(stats(library[5], catalog).valid).toBe(true)
    expect(storage.getItem('gc-deck-realms')).toBe(legacy)
    const copy = copyDeck(library[5])
    saveLibrary([...library, copy], storage)
    const loaded = loadLibrary(catalog, storage)
    expect(loaded.map((d) => d.id)).toEqual([...library, copy].map((d) => d.id))
    expect(loaded[6].cards).toEqual(copy.cards)
  })
  it('refuses foreign factions, extra copies and duplicate entries', () => {
    const deck = starter('realms', catalog)
    for (const cards of [
      [
        {
          key: catalog.cards.find((c) => c.faction === 'monsters')!.key,
          count: 1,
        },
      ],
      [{ ...deck.cards[0], count: 100 }],
      [deck.cards[0], deck.cards[0]],
    ])
      expect(() => importDeck({ ...deck, cards }, catalog)).toThrow()
    expect(() => toPayload({ ...deck, cards: [] }, catalog)).toThrow()
  })
  it('round-trips an exported deck and its leader', () => {
    const deck = starter('skellige', catalog)
    deck.leaderKey = catalog.leaders.filter((l) => l.faction === 'skellige')[1].key
    const result = importDeck(JSON.parse(JSON.stringify({ version: 2, ...deck })), catalog)
    expect(result.cards).toEqual(deck.cards)
    expect(result.leaderKey).toBe(deck.leaderKey)
    expect(stats(result, catalog).valid).toBe(true)
  })
})
it('allows only actual destinations and a free special slot', () => {
  const me = {
    special: { close: [], ranged: [{ uid: 'horn' }], siege: [] },
  } as unknown as Player
  const card = { row: 'agile', ability: '', special: false } as GameCard
  expect(legalRows(card, me)).toEqual(['close', 'ranged'])
  expect(legalRows({ ...card, row: '', ability: 'horn', special: true }, me)).toEqual([
    'close',
    'siege',
  ])
  expect(legalRows({ ...card, row: 'weather', ability: 'frost', special: true }, me)).toEqual([])
})
it('uses Russian card plurals', () => {
  expect([1, 2, 5, 11, 21, 22, 25].map(cardsText)).toEqual([
    '1 карта',
    '2 карты',
    '5 карт',
    '11 карт',
    '21 карта',
    '22 карты',
    '25 карт',
  ])
})
