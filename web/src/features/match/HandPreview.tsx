import { useEffect, useRef, useState, type ReactNode } from 'react'
import { type CardInfo, type GameCard } from '../../domain/types'
import { cardsText } from '../../i18n/ru'
import { useCardText, CardLanguageToggle } from '../../i18n/cards'
import { FullCard } from '../../ui/Card'
import { Dialog } from '../../ui/Dialog'
import { Icon } from '../../ui/Icon'

export function CardEffect({
  card,
  className = 'hand-card-description',
}: {
  card: CardInfo
  className?: string
}) {
  const { name, description, abilities, row: rowName } = useCardText()
  const keyword = card.ability
    .split(' ')
    .filter((a) => a !== 'hero' && a !== 'vildkarrl')
    .at(-1)
  const ability = keyword?.startsWith('scorch_')
    ? 'scorch'
    : keyword?.startsWith('avenger')
      ? 'avenger'
      : keyword
  const icon =
    card.row === 'leader'
      ? 'icon_leader_active'
      : ability
        ? `card_ability_${ability}`
        : card.ability.includes('hero')
          ? 'power_hero'
          : `card_row_${card.row}`
  return (
    <section className={className} aria-label="Описание выбранной карты" aria-live="polite">
      <img className="hand-ability-icon" src={`/img/icons/${icon}.png`} alt="" />
      <h3>{abilities(card.ability) || rowName(card.row)}</h3>
      <span className="visually-hidden">{name(card)}</span>
      <p>{description(card)}</p>
    </section>
  )
}

export function HandPreview<T extends CardInfo & { uid: string }>({
  cards,
  selected,
  canPlay,
  hint,
  onSelect,
  onPlay,
  onClose,
  title = 'Карты в руке',
  instruction = 'Выберите карту для розыгрыша',
  actionLabel = 'Сыграть карту',
  footer,
  readOnly = false,
}: {
  cards: T[]
  selected: T
  canPlay: boolean
  hint: string
  onSelect: (card: T) => void
  onPlay: (card: T) => void
  onClose?: () => void
  title?: string
  instruction?: string
  actionLabel?: string
  footer?: ReactNode
  readOnly?: boolean
}) {
  const { name } = useCardText()
  const rail = useRef<HTMLDivElement>(null)
  const index = cards.findIndex((c) => c.uid === selected.uid)
  const order = cards.map((c) => c.uid).join(' ')
  const step = (direction: number) =>
    onSelect(cards[(index + direction + cards.length) % cards.length])
  useEffect(() => {
    const container = rail.current
    const active = container?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
    if (!container || !active) return
    const center = () => {
      const card = active.getBoundingClientRect(),
        rail = container.getBoundingClientRect()
      container.scrollTo({
        left:
          container.scrollLeft + card.left - rail.left - (container.clientWidth - card.width) / 2,
      })
    }
    center()
    const resize = new ResizeObserver(center)
    resize.observe(container)
    resize.observe(active)
    active.focus({ preventScroll: true })
    return () => resize.disconnect()
  }, [selected.uid, order])
  return (
    <Dialog title={title} className="hand-preview" wide onClose={onClose}>
      <div className="hand-instruction">{instruction}</div>
      <div
        className="hand-preview-layout"
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault()
            step(e.key === 'ArrowLeft' ? -1 : 1)
          }
        }}
      >
        <div className="hand-gallery">
          <div className="hand-gallery-rail" ref={rail}>
            {cards.map((card) => (
              <div
                key={card.uid}
                className={`hand-gallery-slot ${card.uid === selected.uid ? 'active' : ''}`}
              >
                <button
                  type="button"
                  className="hand-gallery-card focused-card"
                  aria-label={name(card)}
                  aria-pressed={card.uid === selected.uid}
                  data-zone="preview"
                  data-card-uid={card.uid}
                  onClick={() =>
                    card.uid === selected.uid ? canPlay && onPlay(card) : onSelect(card)
                  }
                >
                  <FullCard card={card} />
                </button>
              </div>
            ))}
          </div>
          <nav
            className="hand-navigation"
            aria-label="Выбор карты в руке"
            hidden={cards.length < 2}
          >
            <button
              aria-label="Предыдущая карта"
              disabled={cards.length < 2}
              onClick={() => step(-1)}
            >
              <Icon name="left" />
            </button>
            <span>
              {index + 1} <small>/ {cards.length}</small>
            </span>
            <button
              aria-label="Следующая карта"
              disabled={cards.length < 2}
              onClick={() => step(1)}
            >
              <Icon name="right" />
            </button>
          </nav>
        </div>
        <CardEffect card={selected} />
      </div>
      <footer className="hand-preview-footer">
        <div className="hand-preview-tools">
          <CardLanguageToggle />
          {cards.length > 1 && <span>{cardsText(cards.length)}</span>}
        </div>
        <div className="hand-play-action">
          <span>{hint}</span>
          {!readOnly && (
            <button className="button quiet" disabled={!canPlay} onClick={() => onPlay(selected)}>
              {actionLabel}
            </button>
          )}
          {footer}
        </div>
      </footer>
    </Dialog>
  )
}

export function CardBrowser({
  title,
  cards,
  onClose,
}: {
  title: string
  cards: GameCard[]
  onClose: () => void
}) {
  const [uid, setUid] = useState(cards.at(-1)?.uid)
  const selected = cards.find((card) => card.uid === uid) ?? cards.at(-1)
  const close = (
    <button className="button quiet" onClick={onClose}>
      Вернуться к игре
    </button>
  )
  if (!selected)
    return (
      <Dialog title={title} className="hand-preview" wide onClose={onClose}>
        <div className="hand-instruction">{title}</div>
        <div className="card-gallery-empty" role="status">
          <img src="/img/icons/icon_card_count.png" alt="" />
          <p>Здесь пока нет карт</p>
        </div>
        <footer className="hand-preview-footer">
          <span>0 карт</span>
          <div className="hand-play-action">{close}</div>
        </footer>
      </Dialog>
    )
  return (
    <HandPreview
      title={title}
      instruction={title}
      cards={cards}
      selected={selected}
      readOnly
      canPlay={false}
      hint=""
      onSelect={(card) => setUid(card.uid)}
      onPlay={() => {}}
      onClose={onClose}
      footer={close}
    />
  )
}

export function CardInspection({
  card,
  canPlay = true,
  actionLabel = 'Закрыть',
  onPlay,
  onClose,
  notice = '',
}: {
  card: CardInfo
  canPlay?: boolean
  actionLabel?: string
  onPlay: () => void
  onClose: () => void
  notice?: string
}) {
  const { name } = useCardText()
  const preview = { ...card, uid: card.key }
  return (
    <HandPreview
      cards={[preview]}
      selected={preview}
      title={name(card)}
      instruction={notice || (card.row === 'leader' ? 'Способность лидера' : 'Просмотр карты')}
      canPlay={canPlay}
      hint=""
      actionLabel={actionLabel}
      onPlay={onPlay}
      onSelect={() => {}}
      onClose={onClose}
    />
  )
}

export function CardChoice({
  title,
  instruction = title,
  cards,
  canChoose,
  actionLabel = 'Выбрать карту',
  onChoose,
  onClose,
}: {
  title: string
  instruction?: string
  cards: GameCard[]
  canChoose: boolean
  actionLabel?: string
  onChoose: (card: GameCard) => void
  onClose?: () => void
}) {
  const [uid, setUid] = useState(cards[0]?.uid)
  const selected = cards.find((card) => card.uid === uid) ?? cards[0]
  if (!selected)
    return (
      <Dialog title={title} onClose={onClose}>
        <p>Здесь пока нет доступных карт.</p>
      </Dialog>
    )
  return (
    <HandPreview
      title={title}
      instruction={instruction}
      cards={cards}
      selected={selected}
      canPlay={canChoose}
      actionLabel={actionLabel}
      hint="Выберите отряд и подтвердите выбор"
      onSelect={(card) => setUid(card.uid)}
      onPlay={onChoose}
      onClose={onClose}
    />
  )
}

export function MulliganPreview({
  cards,
  redraws,
  ready,
  busy,
  onRedraw,
  onReady,
}: {
  cards: GameCard[]
  redraws: number
  ready: boolean
  busy: boolean
  onRedraw: (card: GameCard) => void
  onReady: () => void
}) {
  const [selected, setSelected] = useState(cards[0]?.uid)
  const card = cards.find((c) => c.uid === selected) ?? cards[0]
  if (!card) return null
  return (
    <HandPreview
      title="Подготовьте стартовую руку"
      instruction={
        ready
          ? 'Вы готовы. Ожидаем соперника.'
          : redraws
            ? `Выберите карты для замены · можно заменить ещё ${redraws}`
            : 'Стартовая рука готова'
      }
      cards={cards}
      selected={card}
      canPlay={!ready && !busy && redraws > 0}
      onSelect={(c) => setSelected(c.uid)}
      onPlay={onRedraw}
      actionLabel="Заменить карту"
      hint={
        ready
          ? 'Ожидаем готовности второго игрока'
          : 'Повторное нажатие на выбранную карту заменит её'
      }
      footer={
        <button className="button primary" disabled={ready || busy} onClick={onReady}>
          {ready ? 'Ожидаем соперника…' : 'Готово · начать партию'}
        </button>
      }
    />
  )
}
