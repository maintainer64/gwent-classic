import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { CardInfo, LeaderChoice } from '../domain/types'
import { CardLanguageToggle, useCardText } from '../i18n/cards'
export const leaderInfo = (leader: LeaderChoice): CardInfo => ({
  key: leader.key,
  name: leader.name,
  nameRu: leader.nameRu,
  description: leader.description,
  power: 0,
  ability: leader.ability,
  row: 'leader',
  image: leader.image,
  descriptionEn: leader.descriptionEn,
  faction: leader.faction,
})
export function Card({
  card,
  onClick,
  onInspect,
  selected = false,
  disabled = false,
  small = false,
  count,
  uid,
  zone,
  classic = false,
}: {
  card: CardInfo
  onClick?: () => void
  onInspect?: () => void
  selected?: boolean
  disabled?: boolean
  small?: boolean
  count?: string
  uid?: string
  zone?: string
  classic?: boolean
}) {
  const { name, description, abilities, row } = useCardText()
  return (
    <motion.button
      layout={Boolean(uid)}
      layoutId={uid}
      initial={uid ? { opacity: 0, scale: 0.94 } : false}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{
        layout: { duration: 0.48, ease: [0.22, 1, 0.36, 1] },
        opacity: { duration: 0.28, ease: 'easeOut' },
        scale: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
      }}
      type="button"
      className={`game-card ${classic ? 'classic-card' : ''} ${small ? 'small' : ''} ${selected ? 'selected' : ''} ${card.ability.split(' ').includes('hero') ? 'hero' : ''}`}
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault()
        onInspect?.()
      }}
      disabled={disabled}
      aria-label={name(card)}
      aria-pressed={selected}
      title={`${name(card)}\n${description(card)}`}
      data-card-uid={uid}
      data-zone={zone}
    >
      <CardArtwork card={card} classic={classic} />
      {count && <span className="card-count">{count}</span>}
      <span className={`card-caption ${classic ? 'visually-hidden' : ''}`}>
        <strong>{name(card)}</strong>
        <span>{abilities(card.ability) || row(card.row === 'leader' ? 'leader' : 'unit')}</span>
      </span>
    </motion.button>
  )
}
// One image and the same overlays serve compact cards and full previews.
function CardArtwork({ card, classic }: { card: CardInfo; classic: boolean }) {
  const identity = `${card.key}:${'uid' in card ? card.uid : ''}`
  const previous = useRef({ identity, power: card.power })
  const [change, setChange] = useState('')
  useEffect(() => {
    const old = previous.current
    previous.current = { identity, power: card.power }
    if (old.identity !== identity) {
      setChange('')
      return
    }
    if (old.power === card.power) return
    setChange(card.power > old.power ? 'up' : 'down')
    const timer = setTimeout(() => setChange(''), 850)
    return () => clearTimeout(timer)
  }, [identity, card.power])
  const unit = ['close', 'ranged', 'siege', 'agile'].includes(card.row)
  const hero = card.ability.split(' ').includes('hero')
  const keyword = card.ability
    .split(' ')
    .filter((a) => a !== 'hero' && a !== 'vildkarrl')
    .at(-1)
  const ability = keyword?.startsWith('avenger')
    ? 'avenger'
    : keyword?.startsWith('scorch_')
      ? 'scorch'
      : keyword
  const powerIcon = hero ? 'hero' : unit ? 'normal' : card.ability.split(' ')[0] || 'normal'
  return (
    <>
      <span className="card-art">
        <img src={card.image} alt="" loading="lazy" draggable={false} />
      </span>
      <span
        className="card-faction-ribbon"
        data-faction={card.faction || card.key.split('.')[0]}
        aria-hidden="true"
      />
      {card.row !== 'leader' &&
        (classic ? (
          <span
            className="card-strength"
            style={{ backgroundImage: `url(/img/icons/power_${powerIcon}.png)` }}
          >
            {unit && (
              <b
                data-power-change={change}
                data-power-state={
                  card.power > (card.basePower ?? card.power)
                    ? 'boosted'
                    : card.power < (card.basePower ?? card.power)
                      ? 'reduced'
                      : 'normal'
                }
              >
                {card.power}
              </b>
            )}
          </span>
        ) : (
          <span className="card-strength">
            {['weather', ''].includes(card.row) ? '✦' : card.power}
          </span>
        ))}
      {classic && unit && (
        <span
          className="classic-row-icon"
          style={{ backgroundImage: `url(/img/icons/card_row_${card.row}.png)` }}
        />
      )}
      {classic && (ability || card.row === 'agile') && unit && (
        <span
          className="classic-ability-icon"
          style={{ backgroundImage: `url(/img/icons/card_ability_${ability || 'agile'}.png)` }}
        />
      )}
    </>
  )
}

export function FullCard({ card }: { card: CardInfo }) {
  const { language, name, description, abilities, row, faction } = useCardText()
  return (
    <article className="full-card" lang={language} aria-label={name(card)} data-card-key={card.key}>
      <div
        className={`game-card classic-card full-card-art ${card.ability.split(' ').includes('hero') ? 'hero' : ''}`}
      >
        <CardArtwork card={card} classic />
      </div>
      <div className="full-card-copy">
        <span className="full-card-type">
          {faction(card.faction || card.key.split('.')[0])} · {row(card.row)}
        </span>
        <h3>{name(card)}</h3>
        {abilities(card.ability) && (
          <strong className="full-card-ability">{abilities(card.ability)}</strong>
        )}
        <p>{description(card)}</p>
      </div>
    </article>
  )
}

export function CardDetail({ card }: { card: CardInfo | null }) {
  const { language } = useCardText()
  return (
    <aside className="card-detail">
      {card ? (
        <>
          <CardLanguageToggle />
          <FullCard card={card} />
        </>
      ) : (
        <div className="empty-detail">
          <h2>{language === 'ru' ? 'У каждой карты — свой ход' : 'Every card has its moment'}</h2>
          <p>
            {language === 'ru'
              ? 'Выберите карту, чтобы рассмотреть её и прочитать способность.'
              : 'Select a card to inspect its ability.'}
          </p>
        </div>
      )}
    </aside>
  )
}
