import { useRef, useState } from 'react'
import {
  COLORS,
  FACTIONS,
  PERKS,
  ROWS,
  SYMBOLS,
  type CardInfo,
  type Catalog,
  type Faction,
} from '../../domain/types'
import { Card, CardDetail, leaderInfo } from '../../ui/Card'
import { Dialog } from '../../ui/Dialog'
import { allowed, copyDeck, importDeck, starter, stats, type SavedDeck } from './model'
import { ABILITIES, cardsText } from '../../i18n/ru'
import { useCardText } from '../../i18n/cards'
export function DeckBuilder({
  catalog,
  decks,
  selected,
  onSelect,
  onChange,
  onUse,
  onBack,
}: {
  catalog: Catalog
  decks: SavedDeck[]
  selected: string
  onSelect: (id: string) => void
  onChange: (decks: SavedDeck[]) => void
  onUse: (id: string) => void
  onBack: () => void
}) {
  const { name, description, abilities, language } = useCardText()
  const deck = decks.find((d) => d.id === selected) ?? decks[0]
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [sort, setSort] = useState('power'),
    [ability, setAbility] = useState('all'),
    [inspect, setInspect] = useState<CardInfo | null>(null),
    [preview, setPreview] = useState<CardInfo | null>(null),
    [leaders, setLeaders] = useState(false),
    [notice, setNotice] = useState(''),
    [deleting, setDeleting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  if (!deck) return <p>Создайте колоду для начала игры.</p>
  const summary = stats(deck, catalog),
    leader = catalog.leaders.find((l) => l.key === deck.leaderKey)
  const update = (change: Partial<SavedDeck>) =>
    onChange(
      decks.map((d) =>
        d.id === deck.id ? { ...d, ...change, updatedAt: new Date().toISOString() } : d,
      ),
    )
  const count = (key: string) => deck.cards.find((c) => c.key === key)?.count ?? 0
  const changeCount = (key: string, delta: number) => {
    const card = catalog.cards.find((c) => c.key === key)!,
      next = count(key) + delta
    if (next < 0 || next > card.maxCopies) return
    update({
      cards: [...deck.cards.filter((e) => e.key !== key), ...(next ? [{ key, count: next }] : [])],
    })
  }
  const collection = catalog.cards
    .filter(
      (c) =>
        allowed(c, deck.faction) &&
        (ability === 'all' || c.ability.split(' ').includes(ability)) &&
        `${c.nameRu} ${c.name}`.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')) &&
        (filter === 'all' ||
          (filter === 'hero'
            ? c.ability.includes('hero')
            : filter === 'special'
              ? c.faction === 'special'
              : filter === 'weather'
                ? c.faction === 'weather'
                : filter === 'deck'
                  ? count(c.key) > 0
                  : c.row === filter)),
    )
    .sort((a, b) =>
      sort === 'name'
        ? name(a).localeCompare(name(b), language)
        : sort === 'copies'
          ? count(b.key) - count(a.key) || b.power - a.power
          : b.power - a.power || name(a).localeCompare(name(b), language),
    )
  const previewCard = (card: CardInfo) => {
    setPreview(card)
    if (window.matchMedia('(max-width: 850px)').matches) setInspect(card)
  }
  const addDeck = () => {
    const next = { ...starter(deck.faction, catalog), name: 'Новая колода' }
    onChange([...decks, next])
    onSelect(next.id)
  }
  const duplicate = () => {
    const next = copyDeck(deck)
    onChange([...decks, next])
    onSelect(next.id)
    setNotice('Копия колоды создана.')
  }
  const exportDeck = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ version: 2, ...deck }, null, 2)], {
        type: 'application/json',
      }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `${deck.name.replace(/[^\p{L}\p{N}\s_-]/gu, '') || 'Колода'}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const faction = (value: Faction) => {
    if (value === deck.faction) return
    if (
      !window.confirm(
        'Сменить фракцию? Карты прежней фракции будут убраны, нейтральные карты останутся.',
      )
    )
      return
    update({
      faction: value,
      leaderKey: catalog.leaders.find((l) => l.faction === value)!.key,
      cards: deck.cards.filter((e) => {
        const c = catalog.cards.find((c) => c.key === e.key)
        return c && allowed(c, value)
      }),
    })
    setPreview(null)
  }
  return (
    <div
      className="deck-screen"
      style={{ '--faction': COLORS[deck.faction] } as React.CSSProperties}
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">Ваша коллекция</p>
          <h1>Искусство подготовки</h1>
          <p className="muted">Выберите фракцию, найдите сочетания и соберите свою колоду.</p>
        </div>
        <button className="button quiet" onClick={onBack}>
          ← Назад
        </button>
      </div>
      <div className="deck-workspace">
        <aside className="deck-library">
          <div className="pane-heading">
            <h2>Мои колоды</h2>
            <span>{decks.length}</span>
          </div>
          <div className="library-items">
            {decks.map((d) => {
              const s = stats(d, catalog)
              return (
                <button
                  key={d.id}
                  className={`library-deck ${d.id === deck.id ? 'active' : ''}`}
                  onClick={() => {
                    onSelect(d.id)
                    setPreview(null)
                  }}
                >
                  <span style={{ color: COLORS[d.faction] }}>{SYMBOLS[d.faction]}</span>
                  <span>
                    <strong>{d.name}</strong>
                    <small>
                      {FACTIONS[d.faction]} · {cardsText(s.total)}
                    </small>
                  </span>
                  <i title={s.valid ? 'Готова к игре' : 'Неполная колода'}>{s.valid ? '✓' : '!'}</i>
                </button>
              )
            })}
          </div>
          <button className="button full" onClick={addDeck} disabled={decks.length >= 100}>
            + Новая колода
          </button>
          <div className="library-tools">
            <button onClick={() => fileRef.current?.click()}>Импорт</button>
            <button onClick={exportDeck}>Экспорт</button>
            <button onClick={duplicate} disabled={decks.length >= 100}>
              Копия
            </button>
            <button onClick={() => setDeleting(true)} disabled={decks.length <= 1}>
              Удалить
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0]
              e.currentTarget.value = ''
              if (!file) return
              try {
                if (decks.length >= 100)
                  throw new Error('В библиотеке уже 100 колод. Удалите лишнюю перед импортом.')
                if (file.size > 100000) throw new Error('Файл колоды слишком большой.')
                const next = importDeck(JSON.parse(await file.text()), catalog)
                onChange([...decks, next])
                onSelect(next.id)
                setNotice('Колода импортирована.')
              } catch (error) {
                setNotice(error instanceof Error ? error.message : 'Не удалось прочитать колоду.')
              }
            }}
          />
          <p role="status" className="inline-notice">
            {notice}
          </p>
        </aside>
        <section className="deck-collection">
          <div className="deck-meta">
            <label>
              Название
              <input
                aria-label="Название колоды"
                maxLength={50}
                value={deck.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <label>
              Фракция
              <select
                aria-label="Фракция колоды"
                value={deck.faction}
                onChange={(e) => faction(e.target.value as Faction)}
              >
                {catalog.factions.map((f) => (
                  <option key={f} value={f}>
                    {FACTIONS[f]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="faction-perk">
            {SYMBOLS[deck.faction]} {PERKS[deck.faction]}
          </p>
          <div className="collection-toolbar">
            <input
              className="search"
              placeholder="Найти карту…"
              aria-label="Поиск карт"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              aria-label="Способность карты"
              value={ability}
              onChange={(e) => setAbility(e.target.value)}
            >
              <option value="all">Все способности</option>
              {Object.entries(ABILITIES)
                .filter(([key]) =>
                  catalog.cards.some(
                    (c) => allowed(c, deck.faction) && c.ability.split(' ').includes(key),
                  ),
                )
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {abilities(key) || label}
                  </option>
                ))}
            </select>
            <select
              aria-label="Сортировка карт"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="power">По силе</option>
              <option value="name">По имени</option>
              <option value="copies">По числу в колоде</option>
            </select>
          </div>
          <div className="filter-tabs" aria-label="Фильтры карт">
            {[
              ['all', 'Все'],
              ['deck', 'В колоде'],
              ['close', 'Ближний'],
              ['ranged', 'Дальний'],
              ['siege', 'Осада'],
              ['agile', 'Проворные'],
              ['hero', 'Герои'],
              ['special', 'Особые'],
              ['weather', 'Погода'],
            ].map(([value, label]) => (
              <button
                key={value}
                className={filter === value ? 'active' : ''}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="collection-grid">
            {collection.map((c) => (
              <div key={c.key} className={`collection-item ${count(c.key) ? 'in-deck' : ''}`}>
                <Card
                  card={c}
                  count={`${count(c.key)} / ${c.maxCopies}`}
                  selected={preview?.key === c.key}
                  onClick={() => previewCard(c)}
                  onInspect={() => setInspect(c)}
                />
                <div className="copy-controls">
                  <button
                    aria-label={`Убрать ${name(c)}`}
                    disabled={!count(c.key)}
                    onClick={() => changeCount(c.key, -1)}
                  >
                    −
                  </button>
                  <span>{count(c.key) ? `${count(c.key)} в колоде` : 'Добавить'}</span>
                  <button
                    aria-label={`Добавить ${name(c)}`}
                    disabled={count(c.key) >= c.maxCopies}
                    onClick={() => changeCount(c.key, 1)}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
          {!collection.length && (
            <p className="empty-state">Карты не найдены. Попробуйте другой запрос или фильтр.</p>
          )}
        </section>
        <aside className="deck-summary">
          <CardDetail card={preview} />
          <button className="leader-choice" onClick={() => setLeaders(true)}>
            {leader && <img src={leader.image} alt="" />}
            <span>
              <small>Лидер · изменить</small>
              <strong>{leader ? name(leader) : 'Выберите лидера'}</strong>
            </span>
          </button>
          <div className="deck-stats">
            <div>
              <strong>{summary.total}</strong>
              <span>Всего карт</span>
            </div>
            <div className={summary.units < 22 ? 'invalid' : ''}>
              <strong>
                {summary.units}
                <small> / 22</small>
              </strong>
              <span>Отряды · минимум</span>
            </div>
            <div className={summary.special > 10 ? 'invalid' : ''}>
              <strong>
                {summary.special}
                <small> / 10</small>
              </strong>
              <span>Особые · максимум</span>
            </div>
            <div>
              <strong>{summary.strength}</strong>
              <span>Сила отрядов</span>
            </div>
          </div>
          <div className="deck-composition">
            {(['close', 'ranged', 'siege'] as const).map((row) => (
              <span key={row}>
                {ROWS[row]}{' '}
                <b>
                  {deck.cards.reduce(
                    (n, e) =>
                      n + (catalog.cards.find((c) => c.key === e.key)?.row === row ? e.count : 0),
                    0,
                  )}
                </b>
              </span>
            ))}
          </div>
          <div className="deck-validation" role="status">
            {summary.valid ? (
              <span>✓ Колода готова к игре</span>
            ) : (
              summary.errors.map((error, i) => <p key={i}>{error}</p>)
            )}
          </div>
          <button
            className="button primary full"
            disabled={!summary.valid}
            onClick={() => onUse(deck.id)}
          >
            Использовать колоду
          </button>
          <div className="library-tools">
            <button onClick={() => update({ cards: starter(deck.faction, catalog).cards })}>
              Автосборка
            </button>
            <button
              onClick={() => {
                if (window.confirm('Убрать все карты из этой колоды?')) update({ cards: [] })
              }}
            >
              Очистить
            </button>
          </div>
        </aside>
      </div>
      {leaders && (
        <Dialog title="Выберите лидера" wide onClose={() => setLeaders(false)}>
          <div className="leader-grid">
            {catalog.leaders
              .filter((l) => l.faction === deck.faction)
              .map((l) => (
                <div key={l.key}>
                  <Card
                    card={leaderInfo(l)}
                    selected={deck.leaderKey === l.key}
                    onClick={() => {
                      update({ leaderKey: l.key })
                      setLeaders(false)
                      setPreview(leaderInfo(l))
                    }}
                  />
                  <p>
                    {description(l)}
                    {l.passive ? ' · Пассивная способность' : ''}
                  </p>
                </div>
              ))}
          </div>
        </Dialog>
      )}
      {inspect && (
        <Dialog title={name(inspect)} onClose={() => setInspect(null)}>
          <CardDetail card={inspect} />
        </Dialog>
      )}
      {deleting && (
        <Dialog title="Удалить колоду?" onClose={() => setDeleting(false)}>
          <p>«{deck.name}» будет удалена из вашей библиотеки.</p>
          <div className="dialog-actions">
            <button className="button quiet" onClick={() => setDeleting(false)}>
              Отмена
            </button>
            <button
              className="button danger"
              onClick={() => {
                const rest = decks.filter((d) => d.id !== deck.id)
                onChange(rest)
                onSelect(rest[0].id)
                setDeleting(false)
              }}
            >
              Удалить
            </button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
