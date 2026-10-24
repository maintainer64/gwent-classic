import { useState } from 'react'
import type { CardInfo, Catalog, Opponent } from '../../domain/types'
import { FACTIONS } from '../../domain/types'
import { CardLanguageToggle, useCardText } from '../../i18n/cards'
import { cardsText } from '../../i18n/ru'
import { Card, FullCard, leaderInfo } from '../../ui/Card'
import { Dialog } from '../../ui/Dialog'

export function OpponentDeck({
  profile,
  catalog,
  onClose,
}: {
  profile: Opponent
  catalog: Catalog
  onClose: () => void
}) {
  const { name } = useCardText()
  const entries = profile.deck.flatMap((entry) => {
    const card = catalog.cards.find((c) => (entry.key ? c.key === entry.key : c.id === entry.def))
    return card ? [{ card, count: entry.count }] : []
  })
  const leader = catalog.leaders.find((l) => l.id === profile.leader)
  const [selected, setSelected] = useState<CardInfo | undefined>(
    leader ? leaderInfo(leader) : entries[0]?.card,
  )
  const special = (card: CardInfo) => ['special', 'weather'].includes(card.faction)
  const total = entries.reduce((sum, e) => sum + e.count, 0)
  const units = entries.filter((e) => !special(e.card)).reduce((sum, e) => sum + e.count, 0)
  const groups = [
    { title: 'Отряды', entries: entries.filter((e) => !special(e.card)) },
    { title: 'Особые карты и погода', entries: entries.filter((e) => special(e.card)) },
  ]
  return (
    <Dialog
      title={`${profile.name} · ${profile.title}`}
      className="opponent-deck"
      wide
      onClose={onClose}
    >
      <div className="opponent-deck-summary">
        <span>
          {FACTIONS[profile.faction]} · {cardsText(total)} · {units} отряда
        </span>
        <CardLanguageToggle />
      </div>
      <div className="opponent-deck-layout">
        <section className="opponent-deck-list" aria-label="Состав колоды">
          {leader && (
            <button
              type="button"
              className={`opponent-deck-leader ${selected?.key === leader.key ? 'selected' : ''}`}
              aria-pressed={selected?.key === leader.key}
              onClick={() => setSelected(leaderInfo(leader))}
            >
              <img src={leader.image} alt="" />
              <span>
                <small>Лидер</small>
                <strong>{name(leader)}</strong>
              </span>
            </button>
          )}
          {groups.map((group) => (
            <section className="opponent-deck-group" key={group.title} aria-label={group.title}>
              <h3>
                {group.title}
                <span>{group.entries.reduce((sum, e) => sum + e.count, 0)}</span>
              </h3>
              <div className="opponent-deck-grid">
                {group.entries.map(({ card, count }) => (
                  <div className="opponent-deck-entry" key={card.key}>
                    <Card
                      card={card}
                      classic
                      count={`×${count}`}
                      selected={selected?.key === card.key}
                      onClick={() => setSelected(card)}
                      onInspect={() => setSelected(card)}
                    />
                    <span>{name(card)}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </section>
        <aside
          className="opponent-deck-detail"
          aria-label="Выбранная карта колоды"
          aria-live="polite"
        >
          {selected && <FullCard card={selected} />}
        </aside>
      </div>
      <footer className="opponent-deck-footer">
        <span>× — число копий. Состав колоды постоянный.</span>
        <button type="button" className="button quiet" onClick={onClose}>
          К выбору соперника
        </button>
      </footer>
    </Dialog>
  )
}
