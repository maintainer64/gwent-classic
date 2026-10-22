import { useAudio } from '../settings/Audio'
import { timerLabel } from '../settings/TimerSettings'
import { LayoutGroup, AnimatePresence } from 'motion/react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  COLORS,
  FACTIONS,
  PERKS,
  ROWS,
  type BattleRow,
  type CardInfo,
  type Catalog,
  type GameCard,
  type MatchEvent,
  type Move,
  type Player,
  type Room,
} from '../../domain/types'
import { Card, FullCard, leaderInfo } from '../../ui/Card'
import { Dialog } from '../../ui/Dialog'
import { Icon } from '../../ui/Icon'
import {
  CardBrowser,
  CardChoice,
  CardEffect,
  CardInspection,
  HandPreview,
  MulliganPreview,
} from './HandPreview'
import { MatchAnnouncements } from './MatchAnnouncements'
import { MatchResult } from './MatchResult'
import { CardLanguageToggle, cardName, useCardText, type CardLanguage } from '../../i18n/cards'
import { cardsText } from '../../i18n/ru'
import { has, isUnit, legalRows } from './rules'

type Choice = {
  title: string
  cards: GameCard[]
  count?: number
  onChoose: (cards: GameCard[]) => void
  mandatory?: boolean
  gallery?: boolean
  actionLabel?: string
  readOnly?: boolean
}
export function eventLabel(event: MatchEvent, room: Room, language: CardLanguage = 'ru') {
  const actor = room.players[event.actor]?.name ?? ''
  const card = event.card ? cardName(event.card, language) : 'карту'
  const text: Record<string, string> = {
    played: `${actor}: ${card}`,
    placed: `На поле: ${card}`,
    resolved: `Способность завершена`,
    draw: `${actor} берёт карту`,
    destroyed: `Уничтожена: ${card}`,
    transform: `Преображение: ${card}`,
    leader: `${actor}: способность лидера`,
    weather: `Погода: ${card}`,
    round_end: event.actor < 0 ? 'Раунд завершён вничью' : `${actor} выигрывает раунд`,
    round_start: `Начинается раунд ${event.frame.round}`,
    match_end: 'Матч завершён',
    pass: `${actor} пасует`,
    timeout: `${actor}: время вышло`,
  }
  return text[event.type] ?? 'Состояние поля обновлено'
}
function useTimer(room: Room) {
  const [seconds, setSeconds] = useState(60)
  const enabled =
    (room.timer?.minutes ?? 1) > 0 &&
    room.status === 'playing' &&
    room.phase === 'turn' &&
    !room.initiative
  useEffect(() => {
    if (!enabled) {
      setSeconds(0)
      return
    }
    const sampled = performance.now(),
      remaining = Date.parse(room.turnDeadline ?? '') - Date.parse(room.serverTime)
    const tick = () =>
      setSeconds(
        Number.isFinite(remaining)
          ? Math.ceil((remaining - (performance.now() - sampled)) / 1000)
          : 0,
      )
    tick()
    const timer = setInterval(tick, 200)
    return () => clearInterval(timer)
  }, [room.turnDeadline, room.serverTime, enabled])
  const value = room.timer?.mode === 'soft' ? seconds : Math.max(0, seconds)
  const absolute = Math.abs(value)
  return {
    seconds,
    enabled,
    text: `${value < 0 ? '+' : ''}${Math.floor(absolute / 60)
      .toString()
      .padStart(2, '0')}:${(absolute % 60).toString().padStart(2, '0')}`,
  }
}
function PlayerPanel({
  player,
  active,
  me,
  portrait,
  onLeader,
}: {
  player: Player
  active: boolean
  me: boolean
  portrait: string
  onLeader: () => void
}) {
  const { name } = useCardText()
  return (
    <section
      className={`player-panel ${me ? 'is-self' : 'is-opponent'} ${active ? 'active' : ''}`}
      aria-label={me ? 'Ваше состояние' : 'Состояние соперника'}
      title={PERKS[player.faction]}
    >
      <div className="player-summary">
        <div className="player-portrait">
          <img src="/img/icons/profile.png" alt="" />
          <img className="portrait-frame" src="/img/icons/icon_player_border.png" alt="" />
          <img
            className="faction-shield"
            src={`/img/icons/deck_shield_${player.faction}.png`}
            alt={FACTIONS[player.faction]}
          />
        </div>
        <div className="player-heading">
          <strong>{player.name}</strong>
          <span>{FACTIONS[player.faction]}</span>
        </div>
        <strong
          className="total-score"
          data-digits={String(player.score).length}
          aria-label={`${me ? 'Ваш счёт' : 'Счёт соперника'}: ${player.score}`}
        >
          {player.score}
        </strong>
        <div className="lives" aria-label={`Осталось жизней: ${player.lives}`}>
          {[1, 2].map((n) => (
            <img
              key={n}
              src={`/img/icons/icon_gem_${player.lives >= n ? 'on' : 'off'}.png`}
              alt=""
            />
          ))}
        </div>
        <span className="hand-count" title={cardsText(player.handCount)}>
          <img src="/img/icons/icon_card_count.png" alt="" />
          {player.handCount}
        </span>
        {player.passed && <p className="passed-label">ПАС</p>}
      </div>
      <button
        className={`leader-mini ${player.leaderUsed ? 'used' : ''}`}
        onClick={onLeader}
        aria-label={`Лидер: ${name({ name: player.leader, nameRu: player.leaderRu })}`}
        title={`${name({ name: player.leader, nameRu: player.leaderRu })} · ${player.leaderUsed ? 'Способность использована' : player.leaderPassive ? 'Пассивная способность' : 'Открыть способность'}`}
      >
        <img src={portrait} alt="" />
        <span className="leader-crown">
          <img src="/img/icons/icon_leader_active.png" alt="" />
        </span>
      </button>
    </section>
  )
}
function CardFan({
  cards,
  zone,
  render,
}: {
  cards: GameCard[]
  zone: 'row-cards' | 'hand-cards'
  render: (card: GameCard) => ReactNode
}) {
  return (
    <div className={`${zone} card-fan`}>
      <AnimatePresence initial={false}>
        {cards.map((card) => (
          <div className="fan-slot" key={card.uid}>
            {render(card)}
          </div>
        ))}
      </AnimatePresence>
    </div>
  )
}
function CardPiles({
  player,
  seat,
  me,
  onGrave,
  onDeck,
}: {
  player: Player
  seat: number
  me: boolean
  onGrave: () => void
  onDeck?: () => void
}) {
  const top = player.grave.at(-1)
  return (
    <div className={`card-piles ${me ? 'is-self' : 'is-opponent'}`}>
      <div
        className="pile grave-pile"
        title={`${me ? 'Ваш сброс' : 'Сброс соперника'} · ${player.grave.length}`}
      >
        {top ? (
          <Card card={top} classic uid={top.uid + '-grave'} zone="grave" onClick={onGrave} />
        ) : (
          <button
            className="empty-pile"
            onClick={onGrave}
            aria-label={me ? 'Ваш сброс' : 'Сброс соперника'}
          />
        )}
        <span className="pile-label">Сброс · {player.grave.length}</span>
      </div>
      <button
        className="pile deck-pile"
        onClick={onDeck}
        disabled={!onDeck}
        data-draw-source={seat}
        aria-label={`${me ? 'Ваша колода' : 'Колода соперника'}: ${cardsText(player.deckCount)}`}
        title={me ? 'Посмотреть оставшиеся карты · порядок скрыт' : 'Колода соперника'}
      >
        <img src={`/img/icons/deck_back_${player.faction}.jpg`} alt="" />
        <strong>{player.deckCount}</strong>
      </button>
    </div>
  )
}
export function MatchBoard({
  room,
  display,
  event,
  busy,
  animating,
  live,
  error,
  catalog,
  send,
  onHome,
  onRematch,
  onSettings,
}: {
  room: Room
  display: Room
  event: MatchEvent | null
  busy: boolean
  animating: boolean
  live: boolean
  error: string
  catalog: Catalog
  send: (move: Move) => Promise<void>
  onHome: () => void
  onRematch: () => void
  onSettings: () => void
}) {
  const { name, language } = useCardText()
  const { playEffect } = useAudio()
  const [selected, setSelected] = useState<GameCard | null>(null),
    [inspect, setInspect] = useState<CardInfo | null>(null),
    [choice, setChoice] = useState<Choice | null>(null),
    [picked, setPicked] = useState<string[]>([]),
    [revivalRow, setRevivalRow] = useState<{
      card: GameCard
      choose: (row: BattleRow) => void
    } | null>(null),
    [leaderPreview, setLeaderPreview] = useState<number | null>(null),
    [copied, setCopied] = useState(false),
    [showLog, setShowLog] = useState(false),
    [showMenu, setShowMenu] = useState(false),
    [handOpen, setHandOpen] = useState(false)
  const me = room.players[room.seat],
    op = room.players[1 - room.seat],
    own = display.players[room.seat],
    other = display.players[1 - room.seat]
  const warned = useRef('')
  const timer = useTimer(room),
    canPlay =
      room.status === 'playing' &&
      room.phase === 'turn' &&
      !room.initiative &&
      !room.pendingOwner &&
      room.turn === room.seat &&
      !busy &&
      !animating &&
      live &&
      !(timer.enabled && room.timer?.mode !== 'soft' && timer.seconds <= 0)
  const invite = `${location.origin}/room/${room.code}`
  useEffect(() => {
    setSelected(null)
    setHandOpen(false)
    setChoice(null)
    setRevivalRow(null)
    setPicked([])
  }, [room.version])
  useEffect(() => {
    if (!event) return
    const sound =
      event.type === 'played'
        ? (event.card?.ability
            .split(' ')
            .filter((a) =>
              [
                'spy',
                'bond',
                'morale',
                'hero',
                'medic',
                'horn',
                'muster',
                'scorch',
                'mardroeme',
                'decoy',
                'frost',
                'rain',
                'fog',
                'clear',
              ].includes(a),
            )
            .at(-1) ??
          `common_${event.row ?? (event.card?.row === 'agile' ? 'close' : event.card?.row) ?? 'close'}`)
        : event.type === 'draw'
          ? 'draw'
          : null
    if (sound) playEffect(sound)
  }, [event, room.seat, room.winner, playEffect])
  useEffect(() => {
    if (
      timer.enabled &&
      timer.seconds <= 0 &&
      room.turn === room.seat &&
      room.turnDeadline &&
      warned.current !== room.turnDeadline
    ) {
      warned.current = room.turnDeadline
      playEffect('warning')
    }
  }, [timer.seconds, timer.enabled, room.turn, room.seat, room.turnDeadline, playEffect])
  const ask = (next: Choice) => {
    setPicked([])
    setChoice(next)
  }
  const inspectCards = (title: string, cards: GameCard[]) =>
    ask({
      title,
      cards,
      readOnly: true,
      onChoose: () => {},
    })
  const chooseRevivalRow = (target: GameCard, choose: (row?: BattleRow) => void) => {
    if (target.row === 'agile') setRevivalRow({ card: target, choose })
    else choose()
  }
  const play = async (card: GameCard, row?: BattleRow) => {
    if (!canPlay) return
    if (
      has(card, 'medic') &&
      me.grave.some(isUnit) &&
      !room.players.some(
        (p) =>
          catalog.leaders.find((l) => l.id === p.leaderId)?.ability === 'emhyr_invader' &&
          !p.leaderUsed,
      )
    ) {
      ask({
        title: 'Медик · выберите отряд из сброса',
        gallery: true,
        actionLabel: 'Возродить отряд',
        cards: me.grave.filter(isUnit),
        onChoose: (cards) => {
          chooseRevivalRow(cards[0], (targetRow) => {
            void send({ type: 'play', uid: card.uid, row, target: cards[0].uid, targetRow })
          })
        },
      })
      return
    }
    await send({ type: 'play', uid: card.uid, row })
  }
  const activateLeader = () => {
    const leader = catalog.leaders.find((l) => l.id === me.leaderId)
    setLeaderPreview(null)
    if (!leader || !canPlay) return
    const ability = leader.ability
    if (ability === 'emhyr_relentless' || ability === 'eredin_bringer_of_death') {
      const cards = (ability === 'emhyr_relentless' ? op.grave : me.grave).filter(isUnit)
      if (cards.length)
        ask({
          title: 'Выберите отряд из сброса',
          cards,
          onChoose: (cards) => {
            void send({ type: 'leader', target: cards[0].uid })
          },
        })
      else void send({ type: 'leader' })
    } else if (ability === 'eredin_king') {
      const cards = (me.deckChoices ?? []).filter((c) => c.row === 'weather')
      if (cards.length)
        ask({
          title: 'Выберите погоду из колоды',
          cards,
          onChoose: (cards) => {
            void send({ type: 'leader', target: cards[0].uid })
          },
        })
      else void send({ type: 'leader' })
    } else if (ability === 'eredin_destroyer') {
      if ((me.hand?.length ?? 0) < 2 || !me.deckChoices?.length) {
        setInspect(leaderInfo(leader))
        return
      }
      ask({
        title: 'Выберите две карты для сброса',
        count: 2,
        cards: me.hand ?? [],
        onChoose: (discard) =>
          ask({
            title: 'Выберите карту из колоды',
            cards: me.deckChoices ?? [],
            onChoose: (draw) => {
              void send({
                type: 'leader',
                targets: discard.map((c) => c.uid),
                draw: draw[0].uid,
              })
            },
          }),
      })
    } else void send({ type: 'leader' })
  }
  const row = (seat: number, kind: BattleRow) => {
    const player = display.players[seat],
      legal = Boolean(
        canPlay &&
        selected &&
        legalRows(selected, me).includes(kind) &&
        seat === (has(selected, 'spy') ? 1 - room.seat : room.seat),
      ),
      weather =
        kind === 'close'
          ? display.weather.includes('frost')
            ? 'frost'
            : ''
          : kind === 'ranged'
            ? display.weather.some((w) => ['fog', 'storm'].includes(w))
              ? 'fog'
              : ''
            : display.weather.some((w) => ['rain', 'storm'].includes(w))
              ? 'rain'
              : ''
    const score = player.rows[kind].reduce((n, c) => n + c.power, 0)
    return (
      <div
        key={`${seat}-${kind}`}
        data-side={seat === room.seat ? 'self' : 'opponent'}
        className={`battle-row ${legal ? 'legal' : ''} weather-${weather} ${event?.type === 'placed' && event.actor === seat && event.row === kind ? 'just-placed' : ''}`}
        data-row={kind}
        data-seat={seat}
      >
        <div
          className="row-destination"
          aria-label={`${ROWS[kind]}${seat !== room.seat ? ' соперника' : ''}: ${score}`}
        >
          <strong data-digits={String(score).length}>{score}</strong>
        </div>
        <div className="row-special">
          {player.special[kind]?.map((c) => (
            <Card
              key={c.uid}
              card={c}
              small
              classic
              uid={c.uid}
              zone="special"
              onClick={() => setInspect(c)}
            />
          ))}
        </div>
        <CardFan
          cards={player.rows[kind]}
          zone="row-cards"
          render={(c) => (
            <Card
              key={c.uid}
              card={c}
              small
              classic
              uid={c.uid}
              zone="board"
              selected={Boolean(
                canPlay && selected && has(selected, 'decoy') && seat === room.seat && isUnit(c),
              )}
              onClick={() => {
                if (
                  canPlay &&
                  selected &&
                  has(selected, 'decoy') &&
                  seat === room.seat &&
                  isUnit(c)
                )
                  void send({
                    type: 'play',
                    uid: selected.uid,
                    target: c.uid,
                  })
                else if (legal && selected) void play(selected, kind)
                else {
                  setInspect(c)
                }
              }}
              onInspect={() => setInspect(c)}
            />
          )}
        />
        {legal && (
          <button
            className="row-play-area"
            aria-label={`Сыграть: ${ROWS[kind]}${seat !== room.seat ? ' соперника' : ''}`}
            onClick={() => {
              if (selected) void play(selected, kind)
            }}
          />
        )}
      </div>
    )
  }
  const currentState =
    room.status === 'finished'
      ? 'Матч окончен'
      : room.status === 'waiting'
        ? 'Ожидаем соперника'
        : room.phase === 'mulligan'
          ? 'Замена стартовой руки'
          : room.initiative
            ? 'Выбор первого игрока'
            : room.pendingOwner
              ? 'Выбор отряда для медика'
              : animating
                ? 'Ход разыгрывается'
                : room.turn === room.seat
                  ? 'Ваш ход'
                  : 'Ход соперника'
  const hand = [...(own.hand ?? [])].sort(
    (a, b) => a.power - b.power || name(a).localeCompare(name(b), language),
  )
  const pick = (card: GameCard) => {
    if (!me.hand?.some((c) => c.uid === card.uid)) {
      setInspect(card)
      return
    }
    playEffect('ui_card')
    setSelected((old) => (old?.uid === card.uid ? null : card))
    setHandOpen(false)
  }
  const openHand = (card = selected ?? hand[0]) => {
    if (!card || !me.hand?.some((c) => c.uid === card.uid)) return
    playEffect('ui_card')
    setSelected(card)
    setHandOpen(true)
  }
  const unavailableCard = (card: GameCard) => {
    if (has(card, 'decoy') && !Object.values(me.rows).flat().some(isUnit))
      return 'На поле нет своего отряда, который можно вернуть приманкой.'
    if (
      card.special &&
      (has(card, 'horn') || has(card, 'mardroeme')) &&
      !legalRows(card, me).length
    )
      return 'Все ячейки особых карт заняты. Выберите другую карту.'
    return ''
  }
  const commitHand = (card: GameCard) => {
    if (!canPlay || unavailableCard(card) || !me.hand?.some((c) => c.uid === card.uid)) return
    setHandOpen(false)
  }
  const closeHand = () => {
    setHandOpen(false)
    setSelected(null)
  }
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void document.documentElement.requestFullscreen?.().catch(() => {})
  }
  const finishChoice = (cards: GameCard[]) => {
    const next = choice
    setChoice(null)
    setPicked([])
    next?.onChoose(cards)
  }
  const previewedLeader =
    leaderPreview === null
      ? null
      : catalog.leaders.find((l) => l.id === room.players[leaderPreview]?.leaderId)
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error()
      await navigator.clipboard.writeText(invite)
      setCopied(true)
    } catch {
      const input = document.querySelector<HTMLInputElement>('#invite-link')
      input?.select()
      setCopied(true)
    }
  }
  if (!op || !other)
    return (
      <div className="waiting-screen">
        <p className="eyebrow">Комната {room.code}</p>
        <span className="waiting-symbol">♧</span>
        <h1>Место напротив свободно</h1>
        <p>Отправьте другу приглашение. Он выберет колоду, и партия начнётся.</p>
        <label>
          Ссылка приглашения
          <input
            id="invite-link"
            readOnly
            value={invite}
            onClick={(e) => e.currentTarget.select()}
          />
        </label>
        <div className="dialog-actions">
          <button
            className="button primary"
            onClick={() => {
              void copy()
            }}
          >
            {copied ? 'Ссылка скопирована или выделена' : 'Скопировать приглашение'}
          </button>
          <button className="button quiet" onClick={onHome}>
            В главное меню
          </button>
        </div>
        <p className="muted">
          Комната доступна до {new Date(room.expiresAt).toLocaleString('ru-RU')}.
        </p>
      </div>
    )
  return (
    <div
      className="match-screen classic-match"
      style={{ '--faction': COLORS[me.faction] } as CSSProperties}
    >
      <header className="match-heading">
        <div className="match-brand">
          <span className="match-wordmark">ГВИНТ</span>
          <span className={`connection ${live ? 'online' : ''}`} role="status">
            <i aria-hidden="true" />
            {live ? 'В сети' : 'Переподключение'}
          </span>
        </div>
        <div className={`match-status ${canPlay ? 'your-turn' : ''}`}>
          <span className="match-round">
            Раунд <b>{display.round}</b>
          </span>
          <strong>{currentState}</strong>
          {timer.enabled && (
            <time
              className={timer.seconds <= 0 ? 'overdue' : timer.seconds <= 10 ? 'urgent' : ''}
              title={timerLabel(room.timer)}
              aria-label={`${timer.seconds < 0 ? 'Превышено время' : 'Осталось на ход'}: ${timer.text}`}
            >
              {timer.text}
            </time>
          )}
        </div>
        <div className="match-controls">
          <button className="toolbar-button history-control" onClick={() => setShowLog(true)}>
            <Icon name="history" />
            <span>История</span>
          </button>
          <button className="toolbar-button" onClick={() => setShowMenu(true)}>
            <Icon name="menu" />
            <span>Меню</span>
          </button>
        </div>
      </header>
      {showMenu && (
        <Dialog title="Меню партии" className="match-menu" onClose={() => setShowMenu(false)}>
          <CardLanguageToggle />
          <p className="match-menu-room">Комната {room.code}</p>
          <p className="match-menu-timer">{timerLabel(room.timer)}</p>
          {room.mode === 'pvp' && (
            <label className="match-menu-invite">
              Приглашение в партию
              <input
                id="invite-link"
                readOnly
                value={invite}
                onClick={(e) => e.currentTarget.select()}
              />
            </label>
          )}
          <div className="match-menu-actions">
            {room.mode === 'pvp' && (
              <button
                onClick={() => {
                  void copy()
                }}
              >
                <Icon name="link" />
                <span>
                  {copied ? 'Ссылка скопирована или выделена' : 'Скопировать приглашение'}
                </span>
              </button>
            )}
            <button
              onClick={() => {
                setShowMenu(false)
                setShowLog(true)
              }}
            >
              <Icon name="history" />
              <span>История ходов</span>
            </button>
            <button
              onClick={() => {
                setShowMenu(false)
                onSettings()
              }}
            >
              <Icon name="settings" />
              <span>Настройки</span>
            </button>
            <button
              onClick={() => {
                fullscreen()
                setShowMenu(false)
              }}
            >
              <Icon name="expand" />
              <span>На весь экран</span>
            </button>
            <button onClick={onHome}>
              <Icon name="home" />
              <span>В главное меню</span>
            </button>
          </div>
        </Dialog>
      )}
      {handOpen && selected && hand.some((c) => c.uid === selected.uid) && (
        <HandPreview
          cards={hand}
          actionLabel="Выбрать карту"
          selected={selected}
          canPlay={canPlay && !unavailableCard(selected)}
          onSelect={setSelected}
          onPlay={commitHand}
          onClose={closeHand}
          hint={
            !canPlay
              ? !live
                ? 'Восстанавливаем соединение с сервером.'
                : `${currentState}. Можно рассмотреть карты.`
              : unavailableCard(selected) ||
                (has(selected, 'decoy')
                  ? 'После подтверждения выберите свой отряд на поле.'
                  : legalRows(selected, me).length > 1
                    ? 'После подтверждения выберите подсвеченный ряд на поле.'
                    : legalRows(selected, me).length
                      ? 'Выберите карту, затем нажмите подсвеченный ряд на поле.'
                      : 'Выберите карту, затем подтвердите её розыгрыш на поле.')
          }
        />
      )}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {!live && (
        <p className="network-banner" role="status">
          Связь прервана. Игра восстановится после подключения; ходы сейчас недоступны.
        </p>
      )}
      <div className="board-viewport">
        <div
          className="gc-board"
          aria-label="Игровое поле"
          style={{ '--faction': COLORS[me.faction] } as CSSProperties}
        >
          <div className="match-layout">
            <PlayerPanel
              player={other}
              me={false}
              active={room.turn !== room.seat}
              portrait={
                catalog.leaders.find((l) => l.id === other.leaderId)?.image ??
                `/img/icons/deck_shield_${other.faction}.png`
              }
              onLeader={() => setLeaderPreview(1 - room.seat)}
            />
            <PlayerPanel
              player={own}
              me
              active={room.turn === room.seat}
              portrait={
                catalog.leaders.find((l) => l.id === own.leaderId)?.image ??
                `/img/icons/deck_shield_${own.faction}.png`
              }
              onLeader={() => setLeaderPreview(room.seat)}
            />
            <CardPiles
              player={other}
              seat={1 - room.seat}
              me={false}
              onGrave={() => inspectCards('Сброс соперника', op.grave)}
            />
            <CardPiles
              player={own}
              seat={room.seat}
              me
              onGrave={() => inspectCards('Ваш сброс', me.grave)}
              onDeck={() =>
                inspectCards('Оставшиеся карты колоды · порядок скрыт', me.deckChoices ?? [])
              }
            />
            <div className="round-counter">
              {(room.roundHistory ?? []).map((result, i) => (
                <span
                  key={i}
                  className={
                    result.winner === room.seat ? 'won' : result.winner < 0 ? 'drawn' : 'lost'
                  }
                  title={`${result.scoreA} : ${result.scoreB}`}
                >
                  {i + 1} ·{' '}
                  {result.winner === room.seat
                    ? 'Победа'
                    : result.winner < 0
                      ? 'Ничья'
                      : 'Поражение'}
                </span>
              ))}
            </div>
            <div className="weather-well" aria-label="Погода">
              {room.weatherCards?.length ? (
                room.weatherCards.map((c) => (
                  <Card key={c.uid} card={c} classic zone="weather" onClick={() => setInspect(c)} />
                ))
              ) : (
                <span>Погодные эффекты</span>
              )}
            </div>
            <button
              className="button pass-button"
              disabled={!canPlay}
              onClick={() => {
                void send({ type: 'pass' })
              }}
            >
              Спасовать
            </button>
            {me.peek?.length ? (
              <button
                className="recon-button"
                onClick={() => inspectCards('Разведка · карты соперника', me.peek ?? [])}
              >
                Разведка
              </button>
            ) : null}
            <LayoutGroup id={room.code}>
              <div className="table">
                {(['siege', 'ranged', 'close'] as BattleRow[]).map((kind) =>
                  row(1 - room.seat, kind),
                )}
                {(['close', 'ranged', 'siege'] as BattleRow[]).map((kind) => row(room.seat, kind))}
                <section className="hand" aria-label="Ваша рука">
                  <CardFan
                    cards={hand}
                    zone="hand-cards"
                    render={(c) => (
                      <Card
                        card={c}
                        classic
                        uid={c.uid}
                        zone="hand"
                        selected={selected?.uid === c.uid}
                        onClick={() => pick(c)}
                        onInspect={() => openHand(c)}
                      />
                    )}
                  />
                </section>
              </div>
            </LayoutGroup>
            <div className="board-selection" aria-live="polite">
              {selected && !handOpen ? (
                <>
                  <span>
                    <strong>{name(selected)}</strong>
                    <small>
                      {has(selected, 'decoy')
                        ? 'Выберите свой отряд на поле'
                        : legalRows(selected, me).length
                          ? 'Выберите подсвеченный ряд'
                          : 'Подтвердите розыгрыш'}
                    </small>
                  </span>
                  <button onClick={() => openHand()}>Рассмотреть руку</button>
                  <button onClick={() => setSelected(null)}>Отменить выбор</button>
                </>
              ) : (
                <>
                  <span className="board-hint">
                    {canPlay ? 'Выберите карту и нажмите подсвеченный ряд' : currentState}
                  </span>
                  <button disabled={!hand.length} onClick={() => openHand()}>
                    Рассмотреть руку
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      {selected &&
        !handOpen &&
        !choice &&
        !revivalRow &&
        !room.pendingOwner &&
        !inspect &&
        leaderPreview === null && (
          <aside className="selected-card-preview" aria-label="Выбранная карта">
            <div className="focused-card">
              <FullCard card={selected} />
            </div>
            <CardEffect card={selected} className="selected-card-effect" />
            {(unavailableCard(selected) || !canPlay) && (
              <p className="selected-card-hint">{unavailableCard(selected) || currentState}</p>
            )}
            {!has(selected, 'decoy') && !legalRows(selected, me).length && (
              <button
                className="button primary"
                disabled={!canPlay || !!unavailableCard(selected)}
                onClick={() => {
                  const card = selected
                  setSelected(null)
                  void play(card)
                }}
              >
                Сыграть карту
              </button>
            )}
          </aside>
        )}
      <p className="portrait-hint">
        Поле можно сдвигать в сторону. В альбомной ориентации видно весь стол.
      </p>
      {showLog && (
        <Dialog title="Ход партии" onClose={() => setShowLog(false)}>
          <ol className="game-history">
            {(room.transitions ?? [])
              .filter((e) => !['placed', 'resolved'].includes(e.type))
              .slice(-20)
              .reverse()
              .map((e) => (
                <li key={e.id}>{eventLabel(e, room, language)}</li>
              ))}
          </ol>
        </Dialog>
      )}
      {!(room.status === 'finished' && !animating) && (
        <MatchAnnouncements room={room} animating={animating} />
      )}
      {room.phase === 'mulligan' && room.status === 'playing' && (
        <MulliganPreview
          cards={hand}
          redraws={me.redraws}
          ready={me.ready}
          busy={busy || animating || !live}
          onRedraw={(card) => {
            playEffect('redraw')
            void send({ type: 'redraw', uid: card.uid })
          }}
          onReady={() => {
            void send({ type: 'ready' })
          }}
        />
      )}
      {room.phase === 'turn' && room.initiative !== 0 && room.status === 'playing' && (
        <Dialog title="Кто сделает первый ход?">
          {room.initiative === room.seat + 1 ? (
            <>
              <p>Скоя’таэли выбирают, кто начинает партию.</p>
              <div className="dialog-actions">
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => {
                    void send({ type: 'initiative', target: 'self' })
                  }}
                >
                  Начну я
                </button>
                <button
                  className="button quiet"
                  disabled={busy}
                  onClick={() => {
                    void send({ type: 'initiative', target: 'opponent' })
                  }}
                >
                  Пусть начнёт соперник
                </button>
              </div>
            </>
          ) : (
            <p>Соперник выбирает первого игрока.</p>
          )}
        </Dialog>
      )}
      {Boolean(room.pendingOwner) &&
        room.status === 'playing' &&
        (room.pendingOwner === room.seat + 1 ? (
          <CardChoice
            title="Цепочка медиков"
            instruction="Выберите следующий отряд для возрождения"
            cards={me.grave.filter(isUnit)}
            canChoose={!busy && !animating && live}
            actionLabel="Возродить отряд"
            onChoose={(card) =>
              chooseRevivalRow(card, (targetRow) => {
                void send({ type: 'revive', target: card.uid, targetRow })
              })
            }
          />
        ) : (
          <Dialog title="Цепочка медиков">
            <p>Соперник выбирает отряд для возрождения.</p>
          </Dialog>
        ))}
      {choice?.readOnly ? (
        <CardBrowser title={choice.title} cards={choice.cards} onClose={() => setChoice(null)} />
      ) : choice?.gallery ? (
        <CardChoice
          title={choice.title}
          cards={choice.cards}
          canChoose={!busy && !animating && live}
          actionLabel={choice.actionLabel}
          onChoose={(card) => finishChoice([card])}
          onClose={choice.mandatory ? undefined : () => setChoice(null)}
        />
      ) : (
        choice && (
          <Dialog
            title={choice.title}
            wide
            onClose={choice.mandatory ? undefined : () => setChoice(null)}
          >
            {choice.cards.length ? (
              <>
                <p>
                  {choice.count
                    ? `Выберите ${choice.count} карты · выбрано ${picked.length}`
                    : 'Нажмите на карту, чтобы выбрать.'}
                </p>
                <div className="choice-grid">
                  {choice.cards.map((c) => (
                    <Card
                      key={c.uid}
                      card={c}
                      selected={picked.includes(c.uid)}
                      onClick={() => {
                        if (!choice.count) {
                          finishChoice([c])
                          return
                        }
                        setPicked((old) =>
                          old.includes(c.uid)
                            ? old.filter((id) => id !== c.uid)
                            : old.length < choice.count!
                              ? [...old, c.uid]
                              : old,
                        )
                      }}
                    />
                  ))}
                </div>
                {choice.count && (
                  <button
                    className="button primary"
                    disabled={picked.length !== choice.count}
                    onClick={() => finishChoice(choice.cards.filter((c) => picked.includes(c.uid)))}
                  >
                    Подтвердить выбор
                  </button>
                )}
              </>
            ) : (
              <p className="empty-state">Здесь пока нет карт.</p>
            )}
          </Dialog>
        )
      )}
      {revivalRow && (
        <Dialog title="Выберите ряд для возрождения" onClose={() => setRevivalRow(null)}>
          <p>«{name(revivalRow.card)}» — проворный отряд. В какой ряд его вернуть?</p>
          <div className="dialog-actions">
            {(['close', 'ranged'] as BattleRow[]).map((row) => (
              <button
                key={row}
                className="button primary"
                disabled={busy || animating || !live}
                onClick={() => {
                  const choose = revivalRow.choose
                  setRevivalRow(null)
                  choose(row)
                }}
              >
                {ROWS[row]}
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {inspect && (
        <CardInspection
          card={inspect}
          onPlay={() => setInspect(null)}
          onClose={() => setInspect(null)}
        />
      )}
      {previewedLeader && leaderPreview !== null && (
        <CardInspection
          card={leaderInfo(previewedLeader)}
          onClose={() => setLeaderPreview(null)}
          canPlay={
            leaderPreview !== room.seat ||
            !(
              !canPlay ||
              me.leaderUsed ||
              me.leaderPassive ||
              (previewedLeader.ability === 'eredin_destroyer' &&
                ((me.hand?.length ?? 0) < 2 || !me.deckChoices?.length))
            )
          }
          onPlay={leaderPreview === room.seat ? activateLeader : () => setLeaderPreview(null)}
          actionLabel={
            leaderPreview !== room.seat
              ? 'Закрыть'
              : me.leaderUsed
                ? 'Способность использована'
                : me.leaderPassive
                  ? 'Пассивная способность'
                  : 'Применить способность'
          }
        />
      )}
      {room.status === 'finished' && !animating && (
        <MatchResult room={room} onHome={onHome} onRematch={onRematch} />
      )}
    </div>
  )
}
