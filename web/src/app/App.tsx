import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { DeckBuilder } from '../features/decks/DeckBuilder'
import { loadLibrary, saveLibrary, toPayload, type SavedDeck } from '../features/decks/model'
import { Setup, type SetupState } from '../features/lobby/Setup'
import { MatchBoard } from '../features/match/MatchBoard'
import { useMatch } from '../features/match/useMatch'
import {
  FACTIONS,
  SYMBOLS,
  type BotSettings,
  type Catalog,
  type Faction,
  type Room,
  type RoomSummary,
} from '../domain/types'
import { Dialog } from '../ui/Dialog'
import { ERROR_TEXT } from '../i18n/ru'
import { CardLanguageToggle } from '../i18n/cards'
import { FullCard } from '../ui/Card'
import { Settings } from '../features/settings/Settings'
import { parseTimer } from '../features/settings/TimerSettings'
import { Icon } from '../ui/Icon'

const readSetup = (): SetupState => {
  let saved: Partial<SetupState> = {}
  try {
    saved = JSON.parse(localStorage.getItem('gwent-setup') ?? '{}') as Partial<SetupState>
  } catch {
    /* Fresh settings. */
  }
  return {
    timerMinutes:
      typeof saved.timerMinutes === 'string' &&
      saved.timerMinutes.trim() &&
      Number.isFinite(Number(saved.timerMinutes)) &&
      Number(saved.timerMinutes) >= 0
        ? saved.timerMinutes
        : '1',
    timerMode: saved.timerMode === 'soft' ? 'soft' : 'hard',
    name:
      typeof saved.name === 'string'
        ? saved.name
        : (localStorage.getItem('gc-player-name') ?? 'Игрок'),
    mode: saved.mode === 'pvp' ? 'pvp' : 'bot',
    playerDeck: typeof saved.playerDeck === 'string' ? saved.playerDeck : '',
    botDeck: typeof saved.botDeck === 'string' ? saved.botDeck : '',
    difficulty: ['easy', 'normal', 'hard'].includes(saved.difficulty ?? '')
      ? saved.difficulty!
      : 'normal',
    style: ['balanced', 'aggressive', 'economy'].includes(saved.style ?? '')
      ? saved.style!
      : 'balanced',
    deckMode: ['random', 'faction', 'custom'].includes(saved.deckMode ?? '')
      ? saved.deckMode!
      : 'random',
    botFaction: (['realms', 'nilfgaard', 'monsters', 'scoiatael', 'skellige'].includes(
      saved.botFaction ?? '',
    )
      ? saved.botFaction
      : 'realms') as Faction,
    botLeader: Number.isInteger(saved.botLeader) ? saved.botLeader! : 0,
  }
}
const routeCode = () => /^\/room\/([A-Z2-9]{12})\/?$/.exec(location.pathname)?.[1] ?? null
export function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [decks, setDecks] = useState<SavedDeck[]>([]),
    [screen, setScreen] = useState<'home' | 'setup' | 'decks' | 'match'>('home'),
    [settings, setSettings] = useState(readSetup),
    [editor, setEditor] = useState(''),
    [purpose, setPurpose] = useState<'player' | 'bot' | 'library'>('library'),
    [rooms, setRooms] = useState<RoomSummary[]>([]),
    [joinCode, setJoinCode] = useState<string | null>(routeCode),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [rules, setRules] = useState(false),
    [preferencesOpen, setPreferencesOpen] = useState(false)
  const match = useMatch()
  const change = (patch: Partial<SetupState>) => {
    setSettings((old) => ({ ...old, ...patch }))
    setError('')
  }
  const enter = (room: Room) => {
    if (location.pathname !== `/room/${room.code}`) history.pushState({}, '', `/room/${room.code}`)
    match.enter(room)
    setScreen('match')
    setError('')
  }
  const restore = async () => {
    const code = routeCode()
    setJoinCode(code)
    if (!code) {
      match.leave()
      setScreen('home')
      return
    }
    setBusy(true)
    try {
      enter(await api.getRoom(code))
    } catch (err) {
      match.leave()
      if (err instanceof ApiError && err.status === 403) {
        setSettings((old) => ({ ...old, mode: 'pvp' }))
        setScreen('setup')
      } else {
        setScreen('home')
        setError(err instanceof Error ? err.message : ERROR_TEXT.network)
      }
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    let canceled = false
    void api
      .catalog()
      .then((c) => {
        if (canceled) return
        setCatalog(c)
        const library = loadLibrary(c)
        setDecks(library)
        setSettings((old) => ({
          ...old,
          playerDeck: library.some((d) => d.id === old.playerDeck)
            ? old.playerDeck
            : (library[0]?.id ?? ''),
          botDeck: library.some((d) => d.id === old.botDeck)
            ? old.botDeck
            : (library.find((d) => d.faction === 'monsters')?.id ?? library[0]?.id ?? ''),
        }))
        void restore()
      })
      .catch((err) => {
        if (!canceled)
          setError(err instanceof Error ? err.message : 'Не удалось загрузить каталог.')
      })
    return () => {
      canceled = true
    }
  }, [])
  useEffect(() => {
    const pop = () => {
      void restore()
    }
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [])
  useEffect(() => {
    if (!catalog || !decks.length) return
    try {
      saveLibrary(decks)
      localStorage.setItem('gwent-setup', JSON.stringify(settings))
    } catch {
      setError(ERROR_TEXT.storage)
    }
  }, [catalog, decks, settings])
  useEffect(() => {
    if (screen !== 'home' || !catalog) return
    let canceled = false
    void api
      .rooms()
      .then((result) => {
        if (!canceled) setRooms(result.rooms.filter((r) => r.status !== 'finished'))
      })
      .catch(() => {
        if (!canceled) setError(ERROR_TEXT.network)
      })
    return () => {
      canceled = true
    }
  }, [screen, catalog])
  const home = () => {
    match.leave()
    history.pushState({}, '', '/')
    setJoinCode(null)
    setScreen('home')
    setError('')
  }
  const edit = (target: 'player' | 'bot' | 'library') => {
    setPurpose(target)
    setEditor(target === 'bot' ? settings.botDeck : settings.playerDeck)
    match.leave()
    setScreen('decks')
    setError('')
  }
  const start = async () => {
    if (!catalog || busy) return
    setBusy(true)
    setError('')
    try {
      const deck = decks.find((d) => d.id === settings.playerDeck) ?? decks[0],
        payload = toPayload(deck, catalog),
        name = settings.name.trim() || 'Игрок'
      if (joinCode) {
        enter(
          await api.join(joinCode, {
            name,
            faction: deck.faction,
            ...payload,
            expectedVersion: 0,
          }),
        )
        return
      }
      const timer = parseTimer(settings)
      if (!timer) {
        setError(ERROR_TEXT.invalid_timer)
        return
      }
      let bot: BotSettings | undefined
      if (settings.mode === 'bot') {
        bot = {
          difficulty: settings.difficulty,
          style: settings.style,
          deckMode: settings.deckMode,
        }
        if (settings.deckMode === 'faction') {
          bot.faction = settings.botFaction
          bot.leader = settings.botLeader
        }
        if (settings.deckMode === 'custom') {
          const b = decks.find((d) => d.id === settings.botDeck) ?? decks[0],
            bp = toPayload(b, catalog)
          bot.faction = b.faction
          bot.deck = bp.deck
          bot.leader = bp.leader
        }
      }
      enter(
        await api.create({
          name,
          faction: deck.faction,
          ...payload,
          mode: settings.mode,
          bot,
          timer,
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось начать партию.')
    } finally {
      setBusy(false)
    }
  }
  const resume = async (code: string) => {
    setBusy(true)
    try {
      enter(await api.getRoom(code))
    } catch (err) {
      setError(err instanceof Error ? err.message : ERROR_TEXT.network)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <header className={`app-header ${screen === 'match' ? 'match-app-header' : ''}`}>
        <button className="brand" onClick={home}>
          <span>♧</span>
          <strong>
            ГВИНТ<small>Классическая игра</small>
          </strong>
        </button>
        <nav aria-label="Основная навигация">
          <button
            className={screen === 'home' || screen === 'setup' ? 'active' : ''}
            onClick={home}
          >
            Играть
          </button>
          <button className={screen === 'decks' ? 'active' : ''} onClick={() => edit('library')}>
            Колоды
          </button>
          <button onClick={() => setRules(true)}>Правила</button>
        </nav>
        <CardLanguageToggle />
        <button
          className="settings-trigger"
          aria-label="Настройки"
          onClick={() => setPreferencesOpen(true)}
        >
          <Icon name="settings" />
          <span>Настройки</span>
        </button>
      </header>
      <main className={screen === 'match' ? 'app-main in-match' : 'app-main'}>
        {!catalog ? (
          <div className="boot-screen">
            <span>♧</span>
            <h1>{error ? 'Не удалось подготовить игру' : 'Раскладываем карты…'}</h1>
            <p role="status">{error || 'Готовим колоды и игровой стол.'}</p>
            {error && (
              <button className="button primary" onClick={() => location.reload()}>
                Повторить
              </button>
            )}
          </div>
        ) : (
          <>
            {screen === 'home' && (
              <div className="home-screen">
                <div className="home-hero">
                  <div className="hero-copy">
                    <p className="eyebrow">Таверна открыта</p>
                    <h1>
                      Ещё одну
                      <br />
                      <em>партию?</em>
                    </h1>
                    <p className="hero-description">
                      Соберите свою колоду. Прочитайте соперника.
                      <br />
                      Оставьте решающую карту напоследок.
                    </p>
                    <div className="hero-actions">
                      <button
                        className="button primary large"
                        onClick={() => {
                          change({ mode: 'bot' })
                          setScreen('setup')
                        }}
                      >
                        Сыграть с ботом <span>↗</span>
                      </button>
                      <button
                        className="button quiet large"
                        onClick={() => {
                          change({ mode: 'pvp' })
                          setScreen('setup')
                        }}
                      >
                        Пригласить друга
                      </button>
                    </div>
                    <button className="text-button hero-decks" onClick={() => edit('library')}>
                      Сначала соберу колоду →
                    </button>
                  </div>
                  <div className="hero-cards" aria-hidden="true">
                    {[8, 3, 15].map((id, i) => {
                      const c = catalog.cards.find((c) => c.id === id)
                      return c ? (
                        <div className={`hero-card hero-card-${i}`} key={id}>
                          <FullCard card={c} />
                        </div>
                      ) : null
                    })}
                    <span className="hero-seal">
                      Два камня жизни.
                      <br />
                      Одна хорошая рука.
                    </span>
                  </div>
                </div>
                <section className="faction-ribbon" aria-label="Пять фракций">
                  {catalog.factions.map((f) => (
                    <span key={f}>
                      <b>{SYMBOLS[f]}</b>
                      {FACTIONS[f]}
                    </span>
                  ))}
                </section>
                {error && (
                  <p className="error-banner" role="alert">
                    {error}
                  </p>
                )}
                <div className="home-lower">
                  <section className="active-rooms">
                    <div className="pane-heading">
                      <h2>Ваш стол</h2>
                      <span>
                        {rooms.length
                          ? `${rooms.length} активных партий`
                          : 'Новая история начинается здесь'}
                      </span>
                    </div>
                    {rooms.length ? (
                      <div className="room-list">
                        {rooms.slice(0, 5).map((room) => (
                          <button
                            key={room.code}
                            disabled={busy}
                            onClick={() => {
                              void resume(room.code)
                            }}
                          >
                            <span>{room.mode === 'bot' ? '♟' : '♧'}</span>
                            <div>
                              <strong>
                                {room.status === 'waiting' ? 'Ожидает друга' : 'Продолжить партию'}
                              </strong>
                              <small>
                                {room.code} · {room.mode === 'bot' ? 'Против бота' : 'С другом'}
                              </small>
                            </div>
                            <b>→</b>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-room">
                        <span>♧</span>
                        <p>Начните партию — сюда можно будет вернуться после перерыва.</p>
                      </div>
                    )}
                  </section>
                  <section className="home-note">
                    <p className="eyebrow">Не только сила</p>
                    <h2>Иногда лучший ход — пас.</h2>
                    <p>
                      Выиграйте два раунда, сохранив карты для решающего момента. Погода, шпионы и
                      медики способны перевернуть даже проигранную партию.
                    </p>
                    <button className="text-button" onClick={() => setRules(true)}>
                      Вспомнить правила →
                    </button>
                  </section>
                </div>
              </div>
            )}
            {screen === 'setup' && (
              <Setup
                state={settings}
                onChange={change}
                catalog={catalog}
                decks={decks}
                joinCode={joinCode}
                busy={busy}
                error={error}
                onStart={() => {
                  void start()
                }}
                onEdit={edit}
                onBack={home}
              />
            )}
            {screen === 'decks' && (
              <>
                <DeckBuilder
                  catalog={catalog}
                  decks={decks}
                  selected={editor}
                  onSelect={setEditor}
                  onChange={setDecks}
                  onBack={() => {
                    setScreen(purpose === 'library' ? 'home' : 'setup')
                  }}
                  onUse={(id) => {
                    change(
                      purpose === 'bot' ? { botDeck: id, deckMode: 'custom' } : { playerDeck: id },
                    )
                    setScreen('setup')
                  }}
                />
                {error && (
                  <p role="alert" className="error-banner">
                    {error}
                  </p>
                )}
              </>
            )}
            {screen === 'match' && match.room && match.display && (
              <MatchBoard
                room={match.room}
                display={match.display}
                event={match.event}
                busy={match.busy}
                animating={match.animating}
                live={match.live}
                error={match.error}
                send={match.send}
                catalog={catalog}
                onHome={home}
                onSettings={() => setPreferencesOpen(true)}
                onRematch={() => {
                  home()
                  setScreen('setup')
                }}
              />
            )}
          </>
        )}
      </main>
      {screen !== 'match' && (
        <footer className="app-footer">
          <span>Классический гвинт · до двух побед</span>
          <span>Без регистрации. С друзьями или против бота.</span>
        </footer>
      )}
      {preferencesOpen && (
        <Settings
          timer={settings}
          onTimer={change}
          activeTimer={
            screen === 'match' && match.room
              ? (match.room.timer ?? { minutes: 1, mode: 'hard' })
              : undefined
          }
          onClose={() => setPreferencesOpen(false)}
        />
      )}
      {rules && (
        <Dialog title="Правила гвинта" onClose={() => setRules(false)}>
          <div className="rules-copy">
            <p>
              Выиграйте два раунда. В начале у каждого по два камня жизни и десять карт. Можно
              заменить до двух карт стартовой руки.
            </p>
            <h3>Ваш ход</h3>
            <p>
              Сыграйте одну карту, используйте активную способность лидера или спасуйте. После паса
              вы не действуете до следующего раунда. Когда оба спасовали, сравнивается общая сила
              отрядов.
            </p>
            <h3>Результат раунда</h3>
            <p>
              Проигравший теряет камень жизни. При ничьей его теряют оба. Победитель начинает
              следующий раунд; при ничьей сохраняется прежний первый игрок.
            </p>
            <h3>Карты и ряды</h3>
            <p>
              У каждого отряда свой боевой ряд. Проворные отряды можно ставить в ближний или
              дальний. Шпионы идут на сторону соперника и дают две карты. Медики возвращают отряд из
              сброса.
            </p>
            <h3>Погода и усиления</h3>
            <p>
              Погода действует на обе стороны. Рог усиливает ряд, прочная связь — одинаковые отряды.
              Герои защищены от большинства эффектов. Казнь уничтожает сильнейшие негероические
              отряды, в том числе ваши.
            </p>
            <h3>Игра с другом</h3>
            <p>
              Создайте комнату, отправьте ссылку другу и дождитесь его выбора колоды. Время на ход и
              режим таймера выбираются до начала партии. Мягкий таймер только предупреждает, жёсткий
              автоматически объявляет пас. Комната живёт 24 часа.
            </p>
            <h3>Колоды</h3>
            <p>
              Нужно не менее 22 отрядов и не более 10 особых и погодных карт. Колоды хранятся в
              браузере, их можно экспортировать в файл и импортировать на другом устройстве.
            </p>
          </div>
        </Dialog>
      )}
    </>
  )
}
