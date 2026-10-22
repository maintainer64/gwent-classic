import {
  FACTIONS,
  type Catalog,
  type DeckCard,
  type DeckEntry,
  type Faction,
} from '../../domain/types'
export type SavedDeck = {
  id: string
  name: string
  faction: Faction
  leaderKey: string
  cards: { key: string; count: number }[]
  updatedAt: string
}
export const LIBRARY_KEY = 'gwent-deck-library-v2'
const id = () =>
  globalThis.crypto?.randomUUID?.() ?? `deck-${Date.now()}-${Math.random().toString(36).slice(2)}`
export const allowed = (c: DeckCard, f: Faction) =>
  c.faction === f || ['neutral', 'special', 'weather'].includes(c.faction)
export function stats(deck: SavedDeck, catalog: Catalog) {
  let units = 0,
    special = 0,
    strength = 0,
    heroes = 0
  const errors: string[] = [],
    seen = new Set<string>()
  for (const e of deck.cards) {
    const c = catalog.cards.find((c) => c.key === e.key)
    if (!c || !allowed(c, deck.faction)) {
      errors.push('В колоде есть недоступная карта.')
      continue
    }
    if (seen.has(e.key) || !Number.isInteger(e.count) || e.count < 1 || e.count > c.maxCopies)
      errors.push(`Недопустимое число копий: ${c.nameRu}.`)
    seen.add(e.key)
    if (['special', 'weather'].includes(c.faction)) special += e.count
    else units += e.count
    strength += c.power * e.count
    if (c.ability.split(' ').includes('hero')) heroes += e.count
  }
  if (units < 22) errors.push(`Нужно ещё ${22 - units} отрядов.`)
  if (special > 10) errors.push('Особых и погодных карт должно быть не больше 10.')
  if (!catalog.leaders.some((l) => l.key === deck.leaderKey && l.faction === deck.faction))
    errors.push('Выберите лидера своей фракции.')
  return {
    units,
    special,
    strength,
    heroes,
    total: units + special,
    errors,
    valid: errors.length === 0,
  }
}
export function starter(faction: Faction, catalog: Catalog): SavedDeck {
  const cards: { key: string; count: number }[] = []
  let n = 22
  const units = catalog.cards
    .filter((c) => allowed(c, faction) && !['special', 'weather'].includes(c.faction))
    .sort(
      (a, b) =>
        b.power +
          (b.ability.includes('medic') ? 8 : 0) +
          (b.ability.includes('spy') ? 14 : 0) -
          (a.power +
            (a.ability.includes('medic') ? 8 : 0) +
            (a.ability.includes('spy') ? 14 : 0)) || a.key.localeCompare(b.key),
    )
  for (const c of units) {
    const count = Math.min(n, c.maxCopies)
    if (count > 0) cards.push({ key: c.key, count })
    n -= count
    if (!n) break
  }
  for (const key of ['special.decoy', 'special.horn', 'weather.clear', 'weather.frost']) {
    const c = catalog.cards.find((c) => c.key === key)
    if (c)
      cards.push({
        key: c.key,
        count: Math.min(c.maxCopies, key === 'special.decoy' ? 2 : 1),
      })
  }
  return {
    id: id(),
    name: FACTIONS[faction],
    faction,
    leaderKey: catalog.leaders.find((l) => l.faction === faction)!.key,
    cards,
    updatedAt: new Date().toISOString(),
  }
}
export function toPayload(
  deck: SavedDeck,
  catalog: Catalog,
): { leader: number; deck: DeckEntry[] } {
  if (!stats(deck, catalog).valid)
    throw new Error('Колода не готова к игре. Проверьте её состав и лидера.')
  return {
    leader: catalog.leaders.find((l) => l.key === deck.leaderKey)!.id,
    deck: deck.cards.map((e) => ({
      key: e.key,
      def: catalog.cards.find((c) => c.key === e.key)!.id,
      count: e.count,
    })),
  }
}
export function importDeck(value: unknown, catalog: Catalog): SavedDeck {
  if (!value || typeof value !== 'object') throw new Error('В файле нет колоды.')
  const obj = value as Record<string, unknown>
  const faction = obj.faction as Faction
  if (!catalog.factions.includes(faction)) throw new Error('Неизвестная фракция в файле колоды.')
  let cards: SavedDeck['cards'] = []
  if (!Array.isArray(obj.cards)) throw new Error('В файле нет списка карт.')
  cards = obj.cards.map((e: unknown) => {
    if (Array.isArray(e)) {
      const c = catalog.cards.find((c) => c.id === e[0])
      if (!c) throw new Error('Неизвестная карта в старом файле.')
      return { key: c.key, count: Number(e[1]) }
    }
    if (!e || typeof e !== 'object') throw new Error('Некорректная запись карты.')
    const entry = e as Record<string, unknown>
    const c = catalog.cards.find(
      (c) =>
        c.key === entry.key || (entry.key === undefined && c.id === (entry.def ?? entry.index)),
    )
    if (!c) throw new Error('Неизвестная карта в файле.')
    return { key: c.key, count: Number(entry.count) }
  })
  if (cards.length > catalog.cards.length) throw new Error('В файле слишком много записей.')
  const leader = catalog.leaders.find(
    (l) => l.key === obj.leaderKey || (typeof obj.leader === 'number' && l.id === obj.leader + 1),
  )
  const deck: SavedDeck = {
    id: id(),
    name: typeof obj.name === 'string' ? obj.name.slice(0, 50) : `Импорт · ${FACTIONS[faction]}`,
    faction,
    leaderKey: leader?.key ?? catalog.leaders.find((l) => l.faction === faction)!.key,
    cards,
    updatedAt: new Date().toISOString(),
  }
  // Incomplete decks may be edited, but malformed entries may not enter storage.
  const seen = new Set<string>()
  for (const e of cards) {
    const c = catalog.cards.find((c) => c.key === e.key)!
    if (
      seen.has(e.key) ||
      !Number.isInteger(e.count) ||
      e.count < 1 ||
      e.count > c.maxCopies ||
      !allowed(c, faction)
    )
      throw new Error('Проверьте фракцию и число копий в импортируемой колоде.')
    seen.add(e.key)
  }
  if (leader && leader.faction !== faction) throw new Error('Лидер не соответствует фракции.')
  return deck
}
export function loadLibrary(catalog: Catalog, storage: Storage = localStorage): SavedDeck[] {
  const raw = storage.getItem(LIBRARY_KEY)
  if (raw) {
    const parsed = JSON.parse(raw) as { version: number; decks: SavedDeck[] }
    if (parsed.version !== 2 || !Array.isArray(parsed.decks) || parsed.decks.length > 100)
      throw new Error(
        'Библиотека колод повреждена. Экспортируйте резервную копию из настроек браузера.',
      )
    if (!parsed.decks.length) return catalog.factions.map((f) => starter(f, catalog))
    const seen = new Set<string>()
    return parsed.decks.map((d) => {
      if (typeof d.id !== 'string' || !d.id || seen.has(d.id))
        throw new Error('В библиотеке колод повреждены идентификаторы.')
      seen.add(d.id)
      return {
        ...importDeck(d, catalog),
        id: d.id,
        updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : new Date().toISOString(),
      }
    })
  }
  const decks = catalog.factions.map((f) => starter(f, catalog))
  for (const faction of catalog.factions) {
    const saved = storage.getItem(`gc-deck-${faction}`)
    if (saved) {
      try {
        decks.push({
          ...importDeck(JSON.parse(saved), catalog),
          name: `Моя старая колода · ${FACTIONS[faction]}`,
        })
      } catch {
        /* Keep the untouched legacy entry for manual recovery. */
      }
    }
  }
  return decks
}
export function saveLibrary(decks: SavedDeck[], storage: Storage = localStorage) {
  storage.setItem(LIBRARY_KEY, JSON.stringify({ version: 2, decks }))
}
export const copyDeck = (deck: SavedDeck): SavedDeck => ({
  ...deck,
  id: id(),
  name: `${deck.name} · копия`,
  cards: deck.cards.map((e) => ({ ...e })),
  updatedAt: new Date().toISOString(),
})
