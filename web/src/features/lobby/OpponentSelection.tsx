import { useState, type CSSProperties } from 'react'
import type { Catalog, Opponent } from '../../domain/types'
import { COLORS, FACTIONS } from '../../domain/types'
import { useCardText } from '../../i18n/cards'
import { cardsText } from '../../i18n/ru'
import { Dialog } from '../../ui/Dialog'
import { OpponentDeck } from './OpponentDeck'

export function OpponentSelection({
  catalog,
  selected,
  onSelect,
}: {
  catalog: Catalog
  selected: string
  onSelect: (id: string) => void
}) {
  const [rosterOpen, setRosterOpen] = useState(false)
  const [deckOpen, setDeckOpen] = useState(false)
  const { name } = useCardText()
  const opponents = catalog.opponents ?? []
  const profile = opponents.find((p) => p.id === selected) ?? opponents[0]
  if (!profile) return null
  const total = profile.deck.reduce((sum, entry) => sum + entry.count, 0)
  const leader = catalog.leaders.find((l) => l.id === profile.leader)
  return (
    <>
      <section
        className="opponent-character"
        aria-label="Выбранный соперник"
        style={{ '--opponent-color': COLORS[profile.faction] } as CSSProperties}
      >
        <div className="opponent-character-heading">
          <img className="opponent-character-portrait" src={profile.image} alt="" />
          <div>
            <p className="eyebrow">{profile.title}</p>
            <h2>{profile.name}</h2>
            <span className="opponent-faction">
              <img src={`/img/icons/deck_shield_${profile.faction}.png`} alt="" />
              {FACTIONS[profile.faction]}
            </span>
            <small>{cardsText(total)} · 22 отряда</small>
          </div>
        </div>
        <p className="opponent-description">{profile.description}</p>
        <div className="opponent-signature" aria-label="Ключевые карты">
          {profile.signature.map((key) => {
            const card = catalog.cards.find((c) => c.key === key)
            return (
              card && (
                <span key={key}>
                  <img src={card.image} alt="" />
                  <span>{name(card)}</span>
                </span>
              )
            )
          })}
        </div>
        {leader && <p className="opponent-leader">Лидер: {name(leader)}</p>}
        <div className="opponent-actions">
          <button type="button" className="button" onClick={() => setRosterOpen(true)}>
            Выбрать соперника · {opponents.length}
          </button>
          <button type="button" className="button quiet" onClick={() => setDeckOpen(true)}>
            Рассмотреть колоду
          </button>
        </div>
        <details className="opponent-hint">
          <summary>Подсказка к испытанию</summary>
          <p>{profile.hint}</p>
        </details>
        <p className="opponent-rule">Состав колоды постоянный. Раздача меняется в каждой партии.</p>
      </section>
      {rosterOpen && (
        <Dialog
          title="Соперники"
          wide
          className="opponent-dialog"
          onClose={() => setRosterOpen(false)}
        >
          <p className="muted">
            12 авторских испытаний по мотивам Ведьмака. У каждого своя тактика и фиксированная
            колода.
          </p>
          <div className="opponent-roster">
            {opponents.map((opponent: Opponent) => (
              <button
                type="button"
                key={opponent.id}
                className={`opponent-tile ${profile.id === opponent.id ? 'selected' : ''}`}
                aria-label={opponent.name}
                aria-pressed={profile.id === opponent.id}
                style={{ '--opponent-color': COLORS[opponent.faction] } as CSSProperties}
                onClick={() => {
                  onSelect(opponent.id)
                  setRosterOpen(false)
                }}
              >
                <img src={opponent.image} alt="" />
                <span>
                  <small>{FACTIONS[opponent.faction]}</small>
                  <strong>{opponent.name}</strong>
                  <em>{opponent.title}</em>
                </span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {deckOpen && (
        <OpponentDeck profile={profile} catalog={catalog} onClose={() => setDeckOpen(false)} />
      )}
    </>
  )
}
