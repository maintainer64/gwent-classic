import { TimerSettings, parseTimer, type TimerDraft } from '../settings/TimerSettings'
import { useCardText } from '../../i18n/cards'
import type { SavedDeck } from '../decks/model'
import { stats } from '../decks/model'
import {
  COLORS,
  DIFFICULTIES,
  FACTIONS,
  PERKS,
  STYLES,
  STYLES_HELP,
  SYMBOLS,
  type BotDifficulty,
  type BotStyle,
  type Catalog,
  type Faction,
  type MatchMode,
} from '../../domain/types'
import { cardsText } from '../../i18n/ru'
export type SetupState = TimerDraft & {
  name: string
  mode: MatchMode
  playerDeck: string
  botDeck: string
  difficulty: BotDifficulty
  style: BotStyle
  deckMode: 'random' | 'faction' | 'custom'
  botFaction: Faction
  botLeader: number
}
export function Setup({
  state,
  onChange,
  catalog,
  decks,
  joinCode,
  busy,
  error,
  onStart,
  onEdit,
  onBack,
}: {
  state: SetupState
  onChange: (patch: Partial<SetupState>) => void
  catalog: Catalog
  decks: SavedDeck[]
  joinCode: string | null
  busy: boolean
  error: string
  onStart: () => void
  onEdit: (purpose: 'player' | 'bot') => void
  onBack: () => void
}) {
  const { name } = useCardText()
  const player = decks.find((d) => d.id === state.playerDeck) ?? decks[0],
    bot = decks.find((d) => d.id === state.botDeck) ?? decks[0],
    valid =
      (joinCode || parseTimer(state)) &&
      player &&
      stats(player, catalog).valid &&
      (state.mode !== 'bot' || state.deckMode !== 'custom' || (bot && stats(bot, catalog).valid))
  const leader = catalog.leaders.find((l) => l.key === player?.leaderKey)
  return (
    <div className="setup-screen">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{joinCode ? `Приглашение · ${joinCode}` : 'Время для партии'}</p>
          <h1>{joinCode ? 'Вас ждут за столом' : 'Выберите соперника'}</h1>
          <p className="muted">Одна колода. Три раунда. Два камня жизни.</p>
        </div>
        <button className="button quiet" onClick={onBack}>
          ← Назад
        </button>
      </div>
      <div className="setup-grid">
        <section className="setup-player panel">
          <p className="eyebrow">Ваша сторона</p>
          <label>
            Имя игрока
            <input
              maxLength={24}
              value={state.name}
              onChange={(e) => onChange({ name: e.target.value })}
              autoComplete="nickname"
            />
          </label>
          <label>
            Ваша колода
            <select
              aria-label="Ваша колода"
              value={player?.id ?? ''}
              onChange={(e) => onChange({ playerDeck: e.target.value })}
            >
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {stats(d, catalog).valid ? '' : ' · не готова'}
                </option>
              ))}
            </select>
          </label>
          <div className="setup-factions">
            {catalog.factions.map((f) => (
              <button
                key={f}
                type="button"
                style={{ '--faction': COLORS[f] } as React.CSSProperties}
                className={player?.faction === f ? 'active' : ''}
                aria-pressed={player?.faction === f}
                onClick={() => {
                  const d = decks.find((d) => d.faction === f)
                  if (d) onChange({ playerDeck: d.id })
                }}
              >
                <span>{SYMBOLS[f]}</span>
                <small>{FACTIONS[f]}</small>
              </button>
            ))}
          </div>
          {player && (
            <div
              className="deck-ticket"
              style={{ '--faction': COLORS[player.faction] } as React.CSSProperties}
            >
              <span className="faction-symbol">{SYMBOLS[player.faction]}</span>
              <h2>{FACTIONS[player.faction]}</h2>
              <p>{PERKS[player.faction]}</p>
              <small>
                {cardsText(stats(player, catalog).total)} · {leader ? name(leader) : ''}
              </small>
            </div>
          )}
          <button className="button quiet full" onClick={() => onEdit('player')}>
            Открыть колодострой
          </button>
        </section>
        <section className="setup-opponent panel">
          <p className="eyebrow">По ту сторону стола</p>
          {!joinCode && (
            <div className="mode-options">
              {(['bot', 'pvp'] as const).map((mode) => (
                <button
                  key={mode}
                  className={state.mode === mode ? 'active' : ''}
                  aria-pressed={state.mode === mode}
                  onClick={() => onChange({ mode })}
                >
                  <span>{mode === 'bot' ? '♟' : '♧'}</span>
                  <strong>{mode === 'bot' ? 'Против бота' : 'С другом'}</strong>
                  <small>{mode === 'bot' ? 'Партия в своём темпе' : 'По ссылке приглашения'}</small>
                </button>
              ))}
            </div>
          )}
          {state.mode === 'bot' && !joinCode ? (
            <>
              <label>Сложность</label>
              <div className="segmented">
                {(Object.keys(DIFFICULTIES) as BotDifficulty[]).map((d) => (
                  <button
                    key={d}
                    className={state.difficulty === d ? 'active' : ''}
                    aria-pressed={state.difficulty === d}
                    onClick={() => onChange({ difficulty: d })}
                  >
                    {DIFFICULTIES[d]}
                  </button>
                ))}
              </div>
              <label>
                Характер соперника
                <select
                  value={state.style}
                  onChange={(e) => onChange({ style: e.target.value as BotStyle })}
                >
                  {(Object.keys(STYLES) as BotStyle[]).map((style) => (
                    <option key={style} value={style}>
                      {STYLES[style]}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">{STYLES_HELP[state.style]}</p>
              <label>
                Колода соперника
                <select
                  value={state.deckMode}
                  onChange={(e) =>
                    onChange({
                      deckMode: e.target.value as SetupState['deckMode'],
                    })
                  }
                >
                  <option value="random">Случайная фракция</option>
                  <option value="faction">Выбранная фракция</option>
                  <option value="custom">Колода из моей библиотеки</option>
                </select>
              </label>
              {state.deckMode === 'faction' && (
                <>
                  <label>
                    Фракция соперника
                    <select
                      value={state.botFaction}
                      onChange={(e) =>
                        onChange({
                          botFaction: e.target.value as Faction,
                          botLeader: 0,
                        })
                      }
                    >
                      {catalog.factions.map((f) => (
                        <option key={f} value={f}>
                          {FACTIONS[f]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Лидер соперника
                    <select
                      value={state.botLeader}
                      onChange={(e) => onChange({ botLeader: Number(e.target.value) })}
                    >
                      <option value={0}>Первый лидер фракции</option>
                      {catalog.leaders
                        .filter((l) => l.faction === state.botFaction)
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {name(l)}
                          </option>
                        ))}
                    </select>
                  </label>
                </>
              )}
              {state.deckMode === 'custom' && (
                <>
                  <label>
                    Колода бота
                    <select
                      aria-label="Колода бота"
                      value={bot?.id ?? ''}
                      onChange={(e) => onChange({ botDeck: e.target.value })}
                    >
                      {decks.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} · {FACTIONS[d.faction]}
                          {stats(d, catalog).valid ? '' : ' · не готова'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="button quiet full" onClick={() => onEdit('bot')}>
                    Редактировать колоду бота
                  </button>
                </>
              )}
            </>
          ) : (
            <div className="friend-explainer">
              <span>♧</span>
              <h2>{joinCode ? 'Друг уже создал комнату' : 'Сыграйте с другом'}</h2>
              <p>
                {joinCode
                  ? 'Выберите свою колоду и присоединяйтесь.'
                  : 'После создания комнаты появится ссылка. Отправьте её другу: он сможет выбрать свою фракцию, лидера и колоду.'}
              </p>
              <small>Обновление страницы и возвращение в меню сохраняют ваше место.</small>
            </div>
          )}
          {!joinCode && <TimerSettings value={state} onChange={onChange} />}
        </section>
      </div>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <div className="setup-bottom">
        <p>
          {valid
            ? '✓ Колода готова к игре'
            : !parseTimer(state)
              ? 'Проверьте время на ход.'
              : 'Колода неполная. Откройте колодострой и проверьте состав.'}
        </p>
        <button className="button primary large" disabled={busy || !valid} onClick={onStart}>
          {busy
            ? 'Готовим стол…'
            : joinCode
              ? 'Присоединиться к партии'
              : state.mode === 'bot'
                ? 'Начать партию'
                : 'Создать комнату'}
        </button>
      </div>
    </div>
  )
}
