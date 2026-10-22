import { api } from '../api/client'
import { MainMenu } from '../components/MainMenu'
import { SetupScreen, type SetupState } from '../components/SetupScreen'
import { TurnTimer } from '../components/TurnTimer'
import { BotDeckMode, BotDifficulty, MatchMode, RoomStatus, type Faction, type BotSettings, type Catalog, type DeckEntry, type GameCard, type Move, type Player, type Room } from '../domain/types'
import { BoardEffects, type AmbientRow } from '../effects/BoardEffects'

// These globals come from the original, unmodified Gwent Classic scripts loaded
// before this module. Their DOM, card art, faction carousel and SavedDeck logic
// remain the source of truth for the CLASSIC presentation.
type LegacyDefinition = { name: string; deck: string; filename: string; ability: string; row: string; strength: string; count?: string }
type LegacyDeckEntry = { index: number; count: number; elem?: HTMLElement }
declare const card_dict: LegacyDefinition[]
declare const dm: {
  faction: string; leader: { index: number }; deck: LegacyDeckEntry[]; bank: LegacyDeckEntry[]
  opponentData: { faction?: string; leader?: number; cards?: LegacyDeckEntry[] }
  stats: { units: number; special: number }
  startNewGame: () => void
}
type LegacyCarousel = {
  previews: HTMLCollectionOf<HTMLElement>
  elem: HTMLElement
  start(): void
  exit(): void
  shift(e: MouseEvent, n: number): void
  select(e: MouseEvent): void
  nudge(n: number): void
  cancel(): void
}
declare const Carousel: {
  curr: LegacyCarousel | null
  clearCurrent(): void
  new (container: { cards: Card[] }, count: number, action: (container: { cards: Card[] }, index: number) => void | Promise<void>, predicate: ((card: Card) => boolean) | null, bSort: boolean, bExit?: boolean, title?: string): LegacyCarousel
}
declare const ui: { carousels: unknown[]; quitCarousel(): void; enablePlayer(on: boolean): void }
declare const Popup: { curr: null | { selectYes(): void; selectNo(): void } }
declare class Card {
  elem: HTMLElement
  constructor(data: LegacyDefinition, holder: object)
  setPower(n: number): void
}

const codeFromUrl = (): string | null => /^\/room\/([A-Z2-9]{12})\/?$/.exec(location.pathname)?.[1] ?? null
const element = (id: string): HTMLElement => {
  const result = document.getElementById(id)
  if (!result) throw new Error(`Missing classic UI node: ${id}`)
  return result
}

/** The original visuals and deck editor remain; every actual game transition,
 * including bot matches, is performed by Go. Legacy JavaScript is view-only. */
export class ClassicController {
  private readonly mainMenu: MainMenu
  private readonly setup: SetupScreen
  private readonly timer: TurnTimer
  private mode = localStorage.getItem('gc-online-mode') === 'pvp' ? 'pvp' : 'bot'
  private botDifficulty = localStorage.getItem('gc-bot-difficulty') ?? BotDifficulty.Normal
  private botDeckMode = localStorage.getItem('gc-bot-deck-mode') ?? BotDeckMode.Random
  private botFaction = localStorage.getItem('gc-bot-faction') ?? 'realms'
  private room: Room | null = null
  private selected: GameCard | null = null
  private pendingMedicTarget = ''
  private catalog: Catalog | null = null
  private renderedCardIDs = new Set<string>()
  private cardElements = new Map<string, {legacy: Card, element: HTMLElement}>()
  private hasRenderedBoard = false
  private busy = false
  private refreshing = false
  private mulliganRunning = false
  private mulliganReadySent = false
  private mulliganUids = new Map<Card, string>()
  // Viewport rect of every visible card after the previous render, used to
  // fly a played card from its hand slot into the row (legacy card animation).
  private lastCardRects = new Map<string, { rect: DOMRect; owner: string }>()
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  private stopWatch: (() => void) | null = null
  // Canvas particle overlay: weather ambience, scorch bursts, round shimmer.
  private readonly fx = new BoardEffects()
  private weatherFx: AmbientRow[] = []
  private scorchFx: HTMLElement[] = []
  private lastRounds = -1
  private endCelebrated = false
  private liveUpdates = 0
  private message = ''
  private customOpponentDeck: DeckEntry[] = []
  private loadBotDeck(faction: string): DeckEntry[] {
    try {
      const raw=localStorage.getItem(`gc-custom-bot-${faction}`)
      if (!raw) return []
      const parsed:unknown=JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter((x):x is DeckEntry => Boolean(x && Number.isInteger(x.def) && Number.isInteger(x.count) && x.count>0))
    } catch { return [] }
  }

  constructor() {
    if (codeFromUrl()) this.mode='pvp'
    // Do not replace the original faction/deck editor. Its SavedDeck persists
    // each faction, and its .card-lg > div shows original preview_count.png.
    this.customOpponentDeck=this.loadBotDeck(this.botFaction)
    this.setup = new SetupScreen({
      initial: {
        mode: this.mode === 'pvp' ? 'pvp' : 'bot',
        name: localStorage.getItem('gc-player-name') || 'Player',
        difficulty: this.botDifficulty as BotDifficulty,
        deckMode: this.botDeckMode as BotDeckMode,
        faction: this.botFaction as Faction
      },
      change: state => this.applySetup(state),
      next: () => this.showDeckMaker(),
      back: () => this.goHome(),
      editBotDeck: () => void this.showBotDeckEditor()
    })
    this.mountChrome()
    this.timer = new TurnTimer(element('classic-turn-host'))
    this.mainMenu = new MainMenu({
      start: mode => { this.mainMenu.hide(); this.setup.setMode(mode === MatchMode.PvP ? 'pvp' : 'bot'); this.setup.setNotice(''); this.setup.show() },
      decks: () => this.showDeckMaker(),
      resume: code => { void this.resumeRoom(code) }
    })
    this.mountClassicCarouselEvents()
    // Keep the "already in deck" badges truthful after every edit, including
    // a faction change that rebuilds both card arrays.
    for (const id of ['card-bank','card-deck']) element(id).addEventListener('click', () => this.decorateDeckCounts())
    const bank = document.getElementById('card-bank')
    if (bank) new MutationObserver(() => this.decorateDeckCounts()).observe(bank, { childList: true })
    dm.startNewGame = () => { void this.createOrJoin() }
    document.addEventListener('click', e => this.captureOnlineClick(e), true)
    window.addEventListener('popstate', () => { void this.restoreRoute() })
    void api.catalog().then(c => { this.catalog = c }).catch(e => this.warn(e))
    void this.restoreRoute()
  }

  private applySetup(state: SetupState) {
    this.mode = state.mode
    this.botDifficulty = state.difficulty
    this.botDeckMode = state.deckMode
    this.botFaction = state.faction
    this.customOpponentDeck = this.loadBotDeck(this.botFaction)
    for (const [key,value] of [['gc-online-mode',this.mode],['gc-bot-difficulty',this.botDifficulty],['gc-bot-deck-mode',this.botDeckMode],['gc-bot-faction',this.botFaction]]) localStorage.setItem(key,value)
    const name = state.name.trim()
    if (name) localStorage.setItem('gc-player-name', name)
  }

  // In-match HUD, the deck-editor back button and the shared modal overlay.
  // Match options themselves live in the visual SetupScreen component.
  private mountChrome() {
    // Compact top-right chip: the collapsed state is one small badge that
    // never covers the board; expanding reveals room, turn, timer and actions.
    const hud = document.createElement('div')
    hud.id = 'classic-online-hud'
    hud.hidden = true
    hud.innerHTML =
      `<button id="online-hud-toggle" type="button" aria-expanded="false"><span id="online-hud-dot"></span><span id="online-hud-brief"></span></button>` +
      `<div class="classic-hud-body">` +
        `<span id="online-match-state"></span>` +
        `<div id="classic-turn-host"></div>` +
        `<div class="classic-hud-actions"><button id="online-copy" type="button">Ссылка на комнату</button><button id="online-back" type="button">Главное меню</button></div>` +
        `<span id="online-match-error" role="status"></span>` +
        `<span id="online-match-hint" role="status"></span>` +
      `</div>`
    document.body.appendChild(hud)
    const rotate = document.createElement('div')
    rotate.id = 'classic-rotate-hint'
    rotate.textContent = 'Поверните устройство горизонтально — поле рассчитано на широкий экран'
    document.body.appendChild(rotate)
    const back = document.createElement('button')
    back.id = 'classic-deck-back'
    back.type = 'button'
    back.textContent = '← Главное меню'
    back.addEventListener('click', () => this.goHome())
    element('deck-customization').append(back)
    const overlay = document.createElement('div')
    overlay.id = 'classic-online-overlay'
    overlay.hidden = true
    document.body.appendChild(overlay)
  }

  // Old HTML used inline onclick attributes which strict CSP blocks. Attach
  // equivalent event handlers here, retaining the original animation classes.
  private mountClassicCarouselEvents() {
    const cards=document.querySelectorAll<HTMLElement>('#carousel > div:first-child > .card-lg')
    cards.forEach((node,i)=> {
      const offset=i-2
      node.addEventListener('click',e=>{if(offset===0)Carousel.curr?.select(e);else Carousel.curr?.shift(e,offset)})
      node.addEventListener('mouseenter',()=>Carousel.curr?.nudge(offset))
    })
    const buttons=element('popup').querySelectorAll<HTMLButtonElement>('button')
    buttons[0]?.addEventListener('click',()=>Popup.curr?.selectYes())
    buttons[1]?.addEventListener('click',()=>Popup.curr?.selectNo())
  }

  private updateStartButton() {
    element('start-game').textContent = codeFromUrl() ? 'Join game' : 'Create game'
  }
  private warn(e: unknown) {
    this.message = e instanceof Error ? e.message : String(e)
    if (this.room) element('online-match-error').textContent = this.message
    else this.setup.setNotice(this.message)
  }
  private playerDeck(): DeckEntry[] {
    const selected = dm.deck.filter(c => c.count > 0).map(c => ({ def: c.index, count: c.count }))
    if (dm.stats.units < 22 || dm.stats.special > 10) throw new Error('Колода должна иметь не менее 22 отрядов и не более 10 особых карт.')
    return selected
  }
  private botSettings() {
    const settings: BotSettings = { difficulty: this.botDifficulty as BotDifficulty, deckMode: this.botDeckMode as BotDeckMode }
    if (this.botDeckMode !== BotDeckMode.Random) settings.faction = this.botFaction as Faction
    if (this.botDeckMode === BotDeckMode.Custom) {
      const original = dm.opponentData
      const imported = original?.faction === this.botFaction ? original.cards?.map(c => ({ def: c.index, count: c.count })) : undefined
      settings.deck = this.customOpponentDeck.length ? this.customOpponentDeck : imported
      if (!settings.deck?.length) throw new Error('Соберите колоду бота или загрузите её оригинальной кнопкой Opponent’s Deck.')
    }
    return settings
  }
  private async createOrJoin() {
    if (this.busy) return
    this.busy = true
    try {
      const deck = this.playerDeck()
      const name = this.setup.snapshot().name.trim() || 'Player'
      localStorage.setItem('gc-player-name',name)
      const payload = { name, faction: dm.faction as Faction, leader: dm.leader.index + 1, deck }
      const code = codeFromUrl()
      const room = code
        ? await api.join(code, { ...payload, expectedVersion: 0 })
        : await api.create({ ...payload, mode: this.mode === 'pvp' ? MatchMode.PvP : MatchMode.Bot, ...(this.mode === 'bot' ? { bot: this.botSettings() } : {}) })
      if (!code) history.pushState({}, '', `/room/${room.code}`)
      this.activateRoom(room)
    } catch (e) { this.warn(e) }
    finally { this.busy = false }
  }

  private async resumeRoom(code: string) {
    try {
      const room = await api.getRoom(code)
      if (room.status === RoomStatus.Finished) { await this.showMainMenu(); return }
      history.pushState({}, '', `/room/${room.code}`)
      this.activateRoom(room)
    } catch {
      await this.showMainMenu()
      this.mainMenu.setError('Эта комната уже закрыта или вы не участник.')
    }
  }
  private async showMainMenu() {
    this.stopWatching()
    this.room = null
    this.selected = null
    document.body.classList.remove('classic-local-turn','classic-opponent-turn')
    // Back at the menu the board is inert again, like at legacy startup.
    document.querySelector('main')?.classList.add('noclick')
    this.setup.hide()
    this.showDeckMaker()
    this.mainMenu.show()
    try {
      const { rooms } = await api.rooms()
      if (!this.mainMenuIsVisible()) return
      this.mainMenu.setRooms(rooms, localStorage.getItem('gc-last-room'))
    } catch { this.mainMenu.setError('Не удалось загрузить комнаты. Попробуйте позже.') }
  }
  private mainMenuIsVisible(): boolean { return !element('classic-main-menu').hidden }
  private goHome() {
    history.pushState({}, '', '/')
    void this.showMainMenu()
  }
  private async restoreRoute() {
    const code = codeFromUrl()
    if (!code) { await this.showMainMenu(); return }
    try { this.activateRoom(await api.getRoom(code)) }
    catch { this.stopWatching(); this.room = null; this.showDeckMaker(); this.setup.setMode('pvp'); this.setup.setNotice(`Комната ${code}: выберите колоду и нажмите Join game.`); this.setup.show() }
  }
  private showDeckMaker() {
    this.mainMenu.hide()
    this.setup.hide()
    this.setSettingsInGame(false)
    // Outside a match the board is inert (legacy startup state).
    document.querySelector('main')?.classList.add('noclick')
    element('end-screen').classList.add('hide')
    element('deck-customization').classList.remove('hide')
    element('classic-online-hud').hidden = true
    element('classic-online-overlay').hidden = true
    this.decorateDeckCounts()
    this.updateStartButton()
  }
  /** The classic editor already stores how many copies sit in the deck, but
   * the original badge only showed what was LEFT in the bank. Add the missing
   * signal: a clear "already in deck" badge and a tooltip with the cap. */
  private decorateDeckCounts() {
    const deckCounts = new Map(dm.deck.map(x => [x.index, x.count]))
    for (const [isBank, entries] of [[true, dm.bank], [false, dm.deck]] as const) {
      for (const entry of entries) {
        const el = entry.elem
        if (!el) continue
        const def = card_dict[entry.index]
        if (!def) continue
        const inDeck = deckCounts.get(entry.index) ?? 0
        const max = Number(def.count) || 3
        el.title = `${def.name}: в колоде ${inDeck} из ${max}${isBank ? ` · осталось выбрать ${Math.max(0, max - inDeck)}` : ''}`
        if (isBank) {
          el.classList.toggle('classic-in-deck', inDeck > 0)
          el.classList.toggle('classic-count-zero', inDeck >= max)
          if (inDeck > 0) el.dataset.inDeck = `${inDeck}/${max} в колоде`
          else delete el.dataset.inDeck
        }
      }
    }
  }
  /** Legacy ui.toggleSettings parked music/sfx on the deck-editor slots
   * (.deck-menu) and moved them to the in-game corner on gameOpened; the
   * deck-editor slots overlap hand-card centers, so a match must switch
   * exactly like the original did. Notifications stay untouched (legacy
   * keeps .deck-menu on it, which hides it). */
  private setSettingsInGame(inGame: boolean) {
    for (const id of ['toggle-music','toggle-sfx']) element(id).classList.toggle('deck-menu', !inGame)
  }
  private activateRoom(room: Room) {
    this.mainMenu.hide()
    this.setup.hide()
    this.setSettingsInGame(true)
    localStorage.setItem('gc-last-room', room.code)
    this.room = room
    this.selected = null
    this.pendingMedicTarget = '' 
    this.message = ''
    this.renderedCardIDs.clear()
    this.cardElements.clear()
    this.hasRenderedBoard = false
    this.lastRounds = -1
    this.endCelebrated = false
    this.liveUpdates = 0
    this.mulliganReadySent = false
    this.closeCarousel()
    element('deck-customization').classList.add('hide')
    element('end-screen').classList.add('hide')
    element('classic-online-hud').hidden = false
    this.startWatch(room.code)
    this.renderRoom()
  }

  /** Live room updates: the Go hub pushes each state change over WebSocket.
   * Reconnects re-request a snapshot, so no fallback polling exists. The
   * body[data-transport] marker ("ws"/"off") is observable for checks. */
  private startWatch(code: string) {
    this.stopWatch?.()
    this.stopWatch = api.watch(
      code,
      next => this.applyLive(next),
      live => { document.body.dataset.transport = live ? 'ws' : 'off' }
    )
  }
  private stopWatching() {
    this.stopWatch?.()
    this.stopWatch = null
    delete document.body.dataset.transport
  }
  private applyLive(next: Room) {
    if (!this.room || next.code !== this.room.code || next.version <= this.room.version) return
    this.room = next
    this.selected = null
    this.pendingMedicTarget = ''
    // Observable for automated checks: pushed updates must arrive without polling.
    document.body.dataset.liveUpdates = String(++this.liveUpdates)
    this.renderRoom()
  }
  /** One-shot HTTP resync used only after a failed action (version conflict).
   * Live updates themselves arrive exclusively over the WebSocket. */
  private async resync() {
    if (!this.room || this.refreshing) return
    this.refreshing = true
    try {
      const next = await api.getRoom(this.room.code)
      if (next.version !== this.room.version) { this.room = next; this.selected = null; this.pendingMedicTarget = ''; this.renderRoom() }
    } catch(e) { this.warn(e) }
    finally { this.refreshing = false }
  }
  private async action(move: Move) {
    if (!this.room || this.busy || (this.room.turn !== this.room.seat && !['initiative','redraw','ready','revive'].includes(move.type)) || this.room.status !== RoomStatus.Playing) return
    this.busy = true
    try { this.room = await api.move(this.room.code,this.room.version,move); this.selected = null; this.pendingMedicTarget = ''; this.renderRoom() }
    catch(e) { this.warn(e); await this.resync() }
    finally { this.busy = false }
  }
  private async chooseCard(title: string, cards: GameCard[]): Promise<GameCard | null> {
    if (!cards.length) return null
    return new Promise(resolve => {
      const overlay = element('classic-online-overlay')
      overlay.hidden = false
      overlay.classList.add('classic-target-modal')
      const head = document.createElement('h2'); head.textContent = title
      const list = document.createElement('div'); list.className = 'classic-target-cards'
      const end = (choice: GameCard | null) => {
        overlay.hidden = true; overlay.classList.remove('classic-target-modal')
        overlay.replaceChildren(); resolve(choice)
      }
      for (const item of cards) {
        const image = document.createElement('button')
        image.className = 'classic-target-card';image.title=item.name
        const legacy = card_dict[item.def]
        image.style.backgroundImage = `url('/img/sm/${legacy.deck}_${legacy.filename}.jpg')`
        image.onclick = () => end(item)
        list.appendChild(image)
      }
      const cancel=document.createElement('button');cancel.textContent='Отмена';cancel.onclick=()=>end(null)
      overlay.replaceChildren(head,list,cancel)
    })
  }

  /** Mulligan through the ORIGINAL deal UI: the legacy #carousel fan of large
   * card previews with its title bar ("Выберите 2 карт для замены"), exactly
   * how the classic engine opened a redraw. The server keeps the count. */
  private driveMulligan(me: Player) {
    const overlay = element('classic-online-overlay')
    overlay.classList.remove('classic-mulligan-modal','classic-medic-modal')
    if (me.ready) {
      // Done replacing: the fan closes and only the wait note remains.
      this.finishMulligan(false)
      overlay.hidden = false
      overlay.replaceChildren()
      const title=document.createElement('h2')
      title.textContent='Ожидаем, пока противник закончит замену карт…'
      overlay.append(title)
      return
    }
    if (me.redraws <= 0) {
      // No redraws left: the fan closes itself and the server is told we are
      // done, so the "Выберите до 0 карт" dead end can never appear.
      this.finishMulligan(true)
      overlay.hidden = false
      overlay.replaceChildren()
      const title=document.createElement('h2')
      title.textContent='Замена завершена…'
      overlay.append(title)
      return
    }
    overlay.hidden = true
    overlay.replaceChildren()
    const hand = me.hand ?? []
    // The redraw fan can open before the hand row has rendered, so make sure
    // every hand card has its original Card object (same one the hand reuses).
    const cards = hand.map(c => this.legacyFor(c).legacy)
    if (!cards.length) return
    this.mulliganUids = new Map(cards.map((card, i) => [card, hand[i].uid]))
    const curr = Carousel.curr as (LegacyCarousel & { container: { cards: Card[] }, count: number, update(): void }) | null
    if (curr && this.mulliganRunning) {
      // Server-confirmed redraw: refresh the existing fan in place instead of
      // restarting it, so the deal stays smooth.
      curr.container.cards = cards
      curr.count = Math.min(me.redraws, cards.length)
      curr.update()
      return
    }
    this.mulliganRunning = true
    const container = { cards }
    const carousel = new Carousel(container, Math.min(me.redraws, hand.length),
      async (_c: unknown, index: number) => {
        const legacy = container.cards[index]
        const uid = legacy ? this.mulliganUids.get(legacy) : undefined
        if (uid) { try { await this.action({type:'redraw',uid}) } catch(e) { this.warn(e) } }
      },
      () => true, false, true, `Выберите до ${me.redraws} карт для замены.`)
    // Leaving the fan (background click or selections exhausted) ends the
    // mulligan; the count itself is never below zero.
    carousel.exit = () => { this.finishMulligan(true) }
    carousel.start()
    // Start with the fan centred, like the original deal (index 0 would only
    // fill the right half of the carousel).
    if (cards.length > 2) {
      const centred = carousel as LegacyCarousel & { index: number; update(): void }
      centred.index = 2
      centred.update()
    }
  }

  /** Closes the redraw fan and, once the current request settles, tells the
   * server we are done. Never sends twice for the same mulligan. */
  private finishMulligan(sendReady: boolean) {
    this.mulliganRunning = false
    this.closeCarousel()
    const room = this.room
    if (!sendReady || !room || room.phase !== 'mulligan') return
    const me = room.players[room.seat]
    if (!me || me.ready || this.mulliganReadySent) return
    this.mulliganReadySent = true
    // The update that brought us here may still hold the action lock; let it
    // release before the ready move goes out.
    setTimeout(() => { void this.action({type:'ready'}) }, 0)
  }

  /** Any running carousel is torn down with the original exit() visuals. */
  private closeCarousel() {
    const curr = Carousel.curr
    if (curr) {
      for (const x of curr.previews) x.style.backgroundImage = ''
      curr.elem.classList.add('hide')
      Carousel.clearCurrent()
    }
  }

  /** Legacy ui.viewCard(leader, callback): first a big carousel preview of the
   * leader card with its ability description, and only when the player picks
   * it does the ability actually go out to the server. */
  private async viewLeader() {
    if (!this.room) return
    const me = this.room.players[this.room.seat]
    const data = card_dict.find(c => c.name === me.leader)
    if (!data) { void this.activateLeader(); return }
    const used = me.leaderUsed || me.leaderPassive || this.room.turn !== this.room.seat
    const legacy = new Card(data, {}) as Card & { desc?: string; desc_name?: string }
    // Show the server's localised ability text in the original description
    // panel: the leader is only applied after this big preview is confirmed.
    if (me.leaderDescription) legacy.desc = me.leaderDescription
    legacy.desc_name = used ? 'Способность вождя' : 'Нажмите на карту, чтобы применить'
    const container = { cards: [legacy] }
    const carousel = new Carousel(container, 1,
      async () => { if (!used) { try { await this.activateLeader() } catch(e) { this.warn(e) } } },
      () => true, false, true,
      used ? `${me.leader} — способность уже использована` : `${me.leader} — выберите карту, чтобы применить способность`)
    carousel.start()
  }

  private async activateLeader() {
    if (!this.room) return
    const me = this.room.players[this.room.seat]
    const ability = this.catalog?.leaders.find(l => l.name === me?.leader)?.ability ?? ''
    if (ability === 'emhyr_relentless' || ability === 'eredin_bringer_of_death') {
      const grave = this.room.players[ability === 'emhyr_relentless' ? 1-this.room.seat : this.room.seat]?.grave ?? []
      const cards=grave.filter(c => !c.ability.includes('hero') && ['close','ranged','siege','agile'].includes(c.row))
      // The legacy leader can be consumed even if the graveyard is empty.
      if (cards.length === 0) { await this.action({type:'leader'}); return }
      const choice=await this.chooseCard('Выберите отряд из сброса',cards)
      if (choice) await this.action({type:'leader',target:choice.uid})
      return
    }
    if (ability === 'eredin_king') {
      const cards = (me.deckChoices ?? []).filter(c => c.row === 'weather')
      // Eredin can activate without a weather card, losing this turn.
      if (cards.length === 0) { await this.action({type:'leader'}); return }
      const choice=await this.chooseCard('Выберите погодную карту',cards)
      if (choice) await this.action({type:'leader',target:choice.uid})
      return
    }
    if (ability === 'eredin_destroyer') {
      const first=await this.chooseCard('Выберите первую карту для сброса',me.hand??[])
      if (!first) return
      const second=await this.chooseCard('Выберите вторую карту для сброса',(me.hand??[]).filter(c=>c.uid!==first.uid))
      if (!second) return
      const draw=await this.chooseCard('Выберите карту из колоды',me.deckChoices??[])
      if (draw) await this.action({type:'leader',targets:[first.uid,second.uid],draw:draw.uid})
      return
    }
    await this.action({type:'leader'})
  }

  private async prepareMedic(card: GameCard) {
    if (!this.room) return
    const me=this.room.players[this.room.seat]
    const grave=(me.grave??[]).filter(c=>!c.ability.includes('hero')&&['close','ranged','siege','agile'].includes(c.row))
    if (grave.length) {
      const choice=await this.chooseCard('Медик: выберите отряд для возрождения',grave)
      if (!choice) {this.selected=null; this.renderRoom();return}
      this.pendingMedicTarget=choice.uid
    }
    this.selected=card
    this.renderRoom()
  }

  private captureOnlineClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    // The original carousel (mulligan, leader preview) cancels when its dark
    // backdrop is clicked; our own handler must not double-process that.
    if (target.closest('#click-background') && !document.getElementById('carousel')?.classList.contains('hide')) return
    if (target.closest('#online-copy')) {
      void navigator.clipboard.writeText(`${location.origin}/room/${this.room?.code}`).catch(err => this.warn(err)); return
    }
    if (target.closest('#online-back')) { this.goHome(); return }
    if (target.closest('#online-hud-toggle')) { element('classic-online-hud').classList.toggle('classic-hud-open'); return }
    if (!this.room) return
    const endButton=target.closest<HTMLButtonElement>('#end-screen button')
    if (endButton) {
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation()
      const buttons=[...element('end-screen').querySelectorAll('button')]
      const newMatch=buttons.indexOf(endButton)!==0
      this.stopWatching()
      this.room=null;this.selected=null;history.pushState({},'', '/');this.showDeckMaker()
      if (newMatch) void this.createOrJoin()
      return
    }
    const card = target.closest<HTMLElement>('.card[data-card-uid]')
    const field = target.closest<HTMLElement>('.field-row[data-row]')
    const pass = target.closest('#pass-button')
    const leader = target.closest('#leader-me')
    const exit = target.closest('#exit-game')
    if (!card && !field && !pass && !leader && !exit) return
    // Original engine must not process online clicks; the Go server owns the match.
    e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation()
    if (exit) { this.goHome(); return }
    if (pass) { void this.action({type:'pass'}); return }
    if (leader) { void this.viewLeader().catch(e=>this.warn(e)); return }
    if (card) {
      const uid = card.dataset.cardUid!
      const owner = card.dataset.owner
      if (this.selected && owner === 'me' && this.selected.ability.includes('decoy')) { void this.action({type:'play',uid:this.selected.uid,target:uid}); return }
      if (owner !== 'hand') return
      const own = this.room.players[this.room.seat]
      this.selected = own.hand?.find(c => c.uid === uid) ?? null
      this.pendingMedicTarget=''
      if (!this.selected) return
      const abil = this.selected.ability.split(' ')
      if (abil.includes('medic')) {void this.prepareMedic(this.selected).catch(e=>this.warn(e));return}
      if (this.selected.special && !/horn|decoy|mardroeme/.test(this.selected.ability)) {
        // Weather, Scorch and the other specials need no row: replay the
        // original playCardAction beat — big preview flash, then the server.
        this.fx.ring(card)
        void this.action({type:'play',uid:this.selected.uid,row:this.selected.row}); return
      }
      this.renderRoom();return
    }
    // Rows are hints, not guesses: only the legal ones (legacy setSelectable)
    // take a placement, everything else is ignored before the server can
    // ever answer "invalid row".
    if (field && this.selected && this.legalRows(this.selected).includes(field.dataset.row ?? '')) {
      const placed = document.querySelector<HTMLElement>(`.card[data-card-uid="${this.selected.uid}"]`)
      if (placed) this.fx.ring(placed)
      void this.action({type:'play',uid:this.selected.uid,row:field.dataset.row,target:this.pendingMedicTarget}); return
    }
  }

  /** Replica of the legacy ui.setSelectable destination rules: which
   * battlefield rows a selected hand card may legally be placed on. */
  private legalRows(card: GameCard): string[] {
    const def = card_dict[card.def]
    const abil = card.ability.split(' ')
    if (def?.deck === 'weather' || (def?.deck === 'special' && abil.includes('scorch'))) return []
    if (def?.deck === 'special' && abil.includes('decoy')) {
      const me = this.room!.players[this.room!.seat]
      return (['close','ranged','siege'] as const).filter(r => (me.rows?.[r] ?? []).some(u => !u.ability.split(' ').includes('hero')))
    }
    if (def?.deck === 'special' && (abil.includes('horn') || abil.includes('mardroeme'))) {
      const me = this.room!.players[this.room!.seat]
      return (['close','ranged','siege'] as const).filter(r => !(me.special?.[r]?.length) && !(me.horn?.[r]))
    }
    return card.row === 'agile' ? ['close','ranged'] : [card.row]
  }

  private legacyFor(card: GameCard) {
    // Persist each physical original Card DOM node across renders. This
    // preserves transitions and makes a hand -> row move the same visual card.
    let cache = this.cardElements.get(card.uid)
    if (!cache) {
      const legacy = new Card(card_dict[card.def], {})
      const el = legacy.elem
      // Enter animations must play exactly once per card: DOM moves restart
      // CSS animations, so drop each class as soon as its animation ends.
      const stop = (e: AnimationEvent) => {
        if (e.target !== el) return
        el.classList.remove(e.animationName)
      }
      el.addEventListener('animationend', stop)
      cache = { legacy, element: el }
      this.cardElements.set(card.uid, cache)
    }
    return cache
  }

  private createCard(card: GameCard, owner: 'hand'|'me'|'op'): HTMLElement {
    const cache = this.legacyFor(card)
    // The legacy engine only ever calls setPower for unit cards: weather,
    // special and leader elements have no power-number node, so calling it
    // there would throw (children[0].children[0] is undefined) and abort the
    // whole render — which is exactly what a redrawn weather card did.
    if (['close','ranged','siege','agile'].includes(card.row)) cache.legacy.setPower(card.power)
    const el = cache.element
    el.dataset.cardUid = card.uid
    el.dataset.owner = owner
    const flewFromHand = this.lastCardRects.get(card.uid)?.owner === 'hand'
    if (owner !== 'hand' && this.hasRenderedBoard && !this.renderedCardIDs.has(card.uid) && !flewFromHand) {
      el.classList.add('classic-card-enter')
      if (card.ability.includes('scorch')) { el.classList.add('classic-scorch-enter'); this.scorchFx.push(el) }
    }
    if (owner !== 'hand') this.renderedCardIDs.add(card.uid)
    el.classList.toggle('classic-selected',owner === 'hand' && this.selected?.uid === card.uid)
    el.classList.toggle('classic-selectable',owner === 'me' && Boolean(this.selected?.ability.includes('decoy')))
    return el
  }
  /** Replace a container's children with the given nodes, touching the DOM
   * only where it actually differs. replaceChildren() would detach and
   * re-attach every card on each render, restarting CSS animations and
   * hover/transition state — which made cards visibly "replay" their entry
   * on every push. */
  private syncChildren(container: HTMLElement, next: HTMLElement[]) {
    const current = Array.from(container.children) as HTMLElement[]
    if (current.length === next.length && next.every((el, i) => el === current[i])) return
    const wanted = new Set(next)
    for (const el of current) if (!wanted.has(el)) container.removeChild(el)
    let cursor: ChildNode | null = container.firstChild
    for (const el of next) {
      if (cursor === el) { cursor = el.nextSibling; continue }
      container.insertBefore(el, cursor)
    }
  }
  /** Replica of the original CardContainer.resizeCardContainer: below the
   * overlap threshold cards keep a tiny gap; at/above it each card gets
   * calculated margins so the whole container width is used evenly, with a
   * small growing overlap (negative margin) for very crowded rows. */
  private layoutCards(container: HTMLElement, overlapCount: number, gap: number, coef: number) {
    const n = container.children.length
    if (!n) return
    const param = n < overlapCount
      ? `${gap}vw`
      : `calc((100% - (4.45vw * ${n})) / (2*${n}) - (${coef}vw * ${n}))`
    for (const child of container.children) {
      const card = child as HTMLElement
      card.style.marginLeft = card.style.marginRight = param
    }
  }
  /** The classic engine animated a played card from the hand to its row. The
   * server confirms the move instead, so replay that beat here: measure where
   * the card was in the previous frame and fly it to its new slot. */
  private animatePlacements() {
    if (this.reducedMotion) { this.captureCardRects(); return }
    for (const el of document.querySelectorAll<HTMLElement>('.card[data-card-uid]')) {
      const uid = el.dataset.cardUid
      const owner = el.dataset.owner
      if (!uid || owner === 'hand') continue
      const prev = this.lastCardRects.get(uid)
      if (!prev || prev.owner !== 'hand' || !prev.rect.width) continue
      const to = el.getBoundingClientRect()
      if (!to.width) continue
      el.classList.remove('classic-card-enter')
      const dx = prev.rect.left - to.left
      const dy = prev.rect.top - to.top
      const scale = prev.rect.width / to.width
      el.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: .7 },
        { transform: 'none', opacity: 1 },
      ], { duration: 430, easing: 'cubic-bezier(.14,.74,.4,1)' })
      this.fx.ring(el)
    }
    this.captureCardRects()
  }
  private captureCardRects() {
    this.lastCardRects.clear()
    for (const el of document.querySelectorAll<HTMLElement>('.card[data-card-uid]')) {
      const uid = el.dataset.cardUid
      if (uid) this.lastCardRects.set(uid, { rect: el.getBoundingClientRect(), owner: el.dataset.owner ?? '' })
    }
  }
  /** Replica of the original Hand ordering (Card.compare): special and
   * weather cards first, then base power, then name. Presentation only; the
   * server keeps authoritative hand state. */
  private sortedHand(): GameCard[] {
    const hand = [...(this.room!.players[this.room!.seat].hand ?? [])]
    const rank = (c: GameCard) => { const deck = card_dict[c.def]?.deck; return deck === 'special' ? -2 : deck === 'weather' ? -1 : 0 }
    const power = (c: GameCard) => Number(card_dict[c.def]?.strength) || 0
    return hand.sort((a, b) => rank(a) - rank(b) || power(a) - power(b) || a.name.localeCompare(b.name))
  }
  private renderRow(side: 'me'|'op', kind:'close'|'ranged'|'siege', cards:GameCard[]) {
    const row = document.querySelector<HTMLElement>(`#field-${side} .field-row[data-row="${kind}"]`)
    if (!row) return
    const slot = row.querySelector<HTMLElement>('.row-cards')!
    const special = row.querySelector<HTMLElement>('.row-special')!
    this.syncChildren(slot, cards.map(c => this.createCard(c,side)))
    this.layoutCards(slot, 10, 0.075, .00325)
    const owner=side==='me'?this.room!.seat:1-this.room!.seat
    this.syncChildren(special, (this.room!.players[owner].special?.[kind]??[]).map(c=>this.createCard(c,side)))
    row.querySelector<HTMLElement>('.row-score')!.textContent = String(cards.reduce((s,c)=>s+c.power,0))
    // Reuse the original weather textures on BOTH sides of the battlefield.
    // Storm acts as fog for ranged rows and rain for siege rows.
    const overlay = row.querySelector<HTMLElement>('.row-weather')!
    const effects = this.room?.weather ?? []
    const kindWeather = kind === 'close' ? (effects.includes('frost') ? 'frost' : '')
      : kind === 'ranged' ? (effects.includes('fog') || effects.includes('storm') ? 'fog' : '')
      : (effects.includes('rain') || effects.includes('storm') ? 'rain' : '')
    for (const weather of ['frost','fog','rain']) overlay.classList.toggle(weather, kindWeather === weather)
    overlay.style.opacity = kindWeather ? '1' : '0'
    if (kindWeather) this.weatherFx.push({ el: row, kind: kindWeather === 'frost' ? 'snow' : kindWeather === 'fog' ? 'fog' : 'rain' })
    // Legacy setSelectable semantics: only rows the selected card may legally
    // enter are highlighted, everything else stays inert.
    row.classList.toggle('row-selectable', Boolean(this.selected && side === 'me' && this.legalRows(this.selected).includes(kind)))
  }
  private renderRoom() {
    const room = this.room
    if (!room) return
    this.weatherFx = []
    this.scorchFx = []
    this.fx.syncWeather(this.weatherFx)
    this.timer.update(room)
    const me = room.players[room.seat]
    const op = room.players[1-room.seat]
    if (!me || !op) { // Waiting room retains the classic artwork behind a small info overlay.
      element('online-match-state').textContent = `Комната ${room.code} · ожидаем друга · до ${new Date(room.expiresAt).toLocaleTimeString()}`
      element('online-hud-brief').textContent = `Комната ${room.code}`
      element('online-hud-toggle').setAttribute('aria-expanded', String(element('classic-online-hud').classList.contains('classic-hud-open')))
      const overlay = element('classic-online-overlay')
      overlay.hidden = false
      overlay.classList.remove('classic-target-modal','classic-mulligan-modal','classic-medic-modal')
      overlay.replaceChildren()
      const heading = document.createElement('h2')
      heading.textContent = 'Ожидаем второго игрока'
      const hint = document.createElement('p')
      hint.textContent = 'Отправьте другу ссылку-приглашение:'
      const link = document.createElement('div')
      link.className = 'classic-invite-link'
      link.textContent = `${location.origin}/room/${room.code}`
      const copy = document.createElement('button')
      copy.type = 'button'
      copy.textContent = 'Скопировать ссылку'
      copy.addEventListener('click', () => {
        void navigator.clipboard.writeText(link.textContent ?? '').then(() => { copy.textContent = 'Скопировано ✓' })
          .catch(err => this.warn(err))
      })
      const expiry = document.createElement('small')
      expiry.textContent = `Комната живёт до ${new Date(room.expiresAt).toLocaleTimeString()}`
      overlay.append(heading, hint, link, copy, expiry)
      return
    }
    if (room.pendingOwner) {
      const overlay=element('classic-online-overlay')
      overlay.hidden=false
      overlay.classList.add('classic-medic-modal')
      overlay.replaceChildren()
      const heading=document.createElement('h2')
      heading.textContent=room.pendingOwner===room.seat+1?'Медик: выберите следующий отряд для возрождения':'Противник выбирает карту для возрождения…'
      overlay.append(heading)
      if (room.pendingOwner===room.seat+1) {
        const cards=(me.grave??[]).filter(c=>!c.ability.includes('hero')&&['close','ranged','siege','agile'].includes(c.row))
        const list=document.createElement('div');list.className='classic-target-cards'
        for (const card of cards) {
          const entry=document.createElement('button');entry.type='button';entry.className='classic-target-card'
          const def=card_dict[card.def]
          entry.style.backgroundImage=`url('/img/sm/${def.deck}_${def.filename}.jpg')`
          entry.title=card.name
          entry.onclick=()=>void this.action({type:'revive',target:card.uid})
          list.append(entry)
        }
        overlay.append(list)
      }
    } else if (room.phase === 'mulligan') {
      this.driveMulligan(me)
    } else if (room.initiative === room.seat + 1) {
      const overlay=element('classic-online-overlay')
      overlay.hidden=false
      overlay.classList.remove('classic-mulligan-modal','classic-medic-modal')
      overlay.replaceChildren()
      const heading=document.createElement('h2');heading.textContent='Скоя’таэли: выберите, кто ходит первым'
      const first=document.createElement('button');first.textContent='Ходить первым';first.onclick=()=>void this.action({type:'initiative',target:'self'})
      const second=document.createElement('button');second.textContent='Пусть противник начинает';second.onclick=()=>void this.action({type:'initiative',target:'opponent'})
      overlay.append(heading,first,second)
    } else if (!element('classic-online-overlay').classList.contains('classic-target-modal') && !element('classic-online-overlay').classList.contains('classic-bot-editor')) {
      element('classic-online-overlay').hidden = room.status !== RoomStatus.Finished
      element('classic-online-overlay').classList.remove('classic-mulligan-modal','classic-medic-modal')
    }
    if (room.status === RoomStatus.Finished) element('classic-online-overlay').hidden = true
    if (room.phase !== 'mulligan') {
      // Leaving the redraw phase always dismisses the fan (ready on both
      // sides) and re-arms it for the next match.
      if (this.mulliganRunning) this.finishMulligan(false)
      this.mulliganReadySent = false
    }
    const myTurn = room.turn === room.seat && room.status === RoomStatus.Playing && room.phase !== 'mulligan' && !room.initiative && !room.pendingOwner
    document.body.classList.toggle('classic-local-turn', myTurn)
    document.body.classList.toggle('classic-opponent-turn', !myTurn && room.status === RoomStatus.Playing && room.phase === 'turn' && !room.initiative)
    // Legacy gwent.js gated the whole board through ui.enablePlayer() (it adds
    // .noclick = pointer-events:none to <main> at startup). We own interaction
    // now but keep its rule: board clicks only during our turn, plus the end
    // screen (its buttons live inside <main> and the original enables them).
    // A legacy carousel (mulligan, leader preview) lives inside <main> and
    // owns its own pointer gating, so it must stay clickable.
    const carouselOpen = Boolean(Carousel.curr)
    document.querySelector('main')?.classList.toggle('noclick', !myTurn && room.status !== RoomStatus.Finished && !carouselOpen)
    const state = room.status===RoomStatus.Finished?'Матч окончен':room.phase==='mulligan'?'Замена стартовой руки':myTurn?'Ваш ход':'Ход противника'
    element('online-match-state').textContent = `Комната ${room.code} · Раунд ${room.round} · ${state} · до ${new Date(room.expiresAt).toLocaleTimeString()}`
    element('online-hud-brief').textContent = `${state} · Раунд ${room.round}`
    element('online-hud-dot').classList.toggle('online-turn-me', myTurn)
    element('online-hud-toggle').setAttribute('aria-expanded', String(element('classic-online-hud').classList.contains('classic-hud-open')))
    element('online-match-error').textContent = this.message
    for (const [side, p] of [['me', me],['op', op]] as const) {
      element(`name-${side}`).textContent = p.name
      element(`deck-name-${side}`).textContent = p.faction
      element(`hand-count-${side}`).textContent = String(p.handCount)
      element(`score-total-${side}`).firstElementChild!.textContent = String(p.score)
      element(`passed-${side}`).style.visibility = p.passed ? 'visible' : 'hidden'
      element(`gem1-${side}`).classList.toggle('gem-on',p.wins < 1)
      element(`gem2-${side}`).classList.toggle('gem-on',p.wins < 2)
      for (const kind of ['close','ranged','siege'] as const) this.renderRow(side,kind,p.rows[kind]||[])
    }
    this.syncChildren(element('hand-row'), this.sortedHand().map(c => this.createCard(c,'hand')))
    this.layoutCards(element('hand-row'), 11, 0.075, .00225)
    // The selected card's destination is named, not guessed: decoy picks a
    // unit on the board, everything else shows its legal rows.
    const hint = element('online-match-hint')
    if (this.selected?.ability.split(' ').includes('decoy')) hint.textContent = 'Выберите отряд на своём поле для замены на Приманку'
    else if (this.selected) {
      const rows = this.legalRows(this.selected)
      const names: Record<string,string> = { close:'Ближний бой', ranged:'Дальний бой', siege:'Осада' }
      hint.textContent = rows.length ? `Куда поставить: ${rows.map(r => names[r] ?? r).join(' · ')}` : 'Карта срабатывает сама'
    }
    else hint.textContent = ''
    // The placement hint must be visible without opening the HUD panel: it
    // temporarily replaces the turn label in the collapsed chip.
    element('online-hud-brief').textContent = hint.textContent || `${state} · Раунд ${room.round}`
    for (const [side,p] of [['me',me],['op',op]] as const) {
      element(`grave-${side}`).title=`Сброс (${p.grave?.length ?? 0})`
      element(`deck-${side}`).title=`Колода (${p.deckCount})`
    }
    element('pass-button').classList.toggle('classic-disabled',!myTurn)
    element('leader-me').classList.toggle('classic-disabled',!myTurn||me.leaderUsed||me.leaderPassive)
    const weather = element('weather')
    this.syncChildren(weather, (room.weatherCards?.length ? room.weatherCards : room.weather.map(w => {
      const card = this.catalog?.cards.find(c => c.ability.split(' ').includes(w))
      if (!card) return document.createElement('span')
      return {uid:`weather-${w}`,def:card.id,name:card.name,power:0,ability:w,row:'weather',image:card.image,special:true}
    })).map(card => card instanceof HTMLElement ? card : this.createCard(card,'op')))
    this.layoutCards(weather, 4, 0.075, .045)
    if (me.peek?.length) {
      element('online-match-error').textContent = `Подсмотренные карты противника: ${me.peek.map(c=>c.name).join(' · ')}`
    }
    this.fx.syncWeather(this.weatherFx)
    for (const el of this.scorchFx) this.fx.scorch(el)
    const rounds = room.roundHistory?.length ?? 0
    if (this.lastRounds >= 0 && rounds > this.lastRounds) {
      const result = room.roundHistory?.[rounds - 1]
      if (result && result.winner !== -1) this.fx.roundWon(element(`score-total-${result.winner === room.seat ? 'me' : 'op'}`))
    }
    this.lastRounds = rounds
    if (room.status === RoomStatus.Finished && !this.endCelebrated) { this.endCelebrated = true; this.fx.wash(0.4) }
    this.hasRenderedBoard=true
    this.animatePlacements()
    if (room.status === RoomStatus.Finished) this.showOriginalEndScreen(room)
    for (const [side,p] of [['me',me],['op',op]] as const) {
      const holder = element(`leader-${side}`).querySelector<HTMLElement>('.leader-container')!
      const data = card_dict.find(c => c.name===p.leader)
      holder.replaceChildren()
      if (data) holder.style.backgroundImage=`url('/img/sm/${data.deck}_${data.filename}.jpg')`
      else holder.style.backgroundImage=''
    }
  }

  private showOriginalEndScreen(room: Room) {
    const screen=element('end-screen')
    const rows=screen.querySelectorAll<HTMLTableRowElement>('tr')
    const me=room.players[room.seat], opponent=room.players[1-room.seat]
    if (!me || !opponent) return
    if (rows[1]?.cells[0]) rows[1].cells[0].textContent=me.name
    if (rows[2]?.cells[0]) rows[2].cells[0].textContent=opponent.name
    for(let n=0;n<3;n++) {
      const result=room.roundHistory?.[n]
      if (rows[1]?.cells[n+1]) {
        rows[1].cells[n+1].textContent=String(result ? (room.seat===0?result.scoreA:result.scoreB) : 0)
        rows[1].cells[n+1].style.color=result?.winner===room.seat?'goldenrod':''
      }
      if (rows[2]?.cells[n+1]) {
        rows[2].cells[n+1].textContent=String(result ? (room.seat===0?result.scoreB:result.scoreA) : 0)
        rows[2].cells[n+1].style.color=result?.winner===1-room.seat?'goldenrod':''
      }
    }
    const image=screen.firstElementChild as HTMLElement | null
    if (image) image.className=room.winner===-1?'end-draw':room.winner===room.seat?'end-win':'end-lose'
    const tie=screen.querySelector<HTMLElement>('p')
    if(tie) tie.classList.toggle('hide',room.winner!==-1)
    screen.classList.remove('hide')
    screen.style.opacity='1'
  }

  private async showBotDeckEditor() {
    if (!this.catalog) { this.warn('Справочник карт загружается');return }
    const editor = element('classic-online-overlay')
    editor.hidden = false
    editor.classList.add('classic-bot-editor')
    const saved = new Map(this.customOpponentDeck.map(c => [c.def,c.count]))
    if (!saved.size && dm.opponentData.faction===this.botFaction) for(const e of dm.opponentData.cards??[]) saved.set(e.index,e.count)
    const redraw = () => {
      const items=this.catalog!.cards.filter(c => c.faction===this.botFaction || ['neutral','special','weather'].includes(c.faction))
      const list=editor.querySelector<HTMLElement>('.classic-deck-cards')
      if (!list) return
      list.replaceChildren(...items.map(c => {
        const wrap=document.createElement('button');wrap.type='button';wrap.className='classic-deck-option'
        wrap.title=`${c.name} · ${saved.get(c.id)??0}/${c.maxCopies}`
        // Use original full art and the original count overlay.
        wrap.style.backgroundImage=`url('/img/sm/${c.faction}_${card_dict[c.id].filename}.jpg')`
        const count=document.createElement('span');count.textContent=String(saved.get(c.id)??0);wrap.append(count)
        wrap.onclick = () => {let n=saved.get(c.id)??0;n=n===c.maxCopies?0:n+1;saved.set(c.id,n);count.textContent=String(n)}
        return wrap
      }))
    }
    editor.innerHTML='<h2>Колода бота · выберите карты</h2><p>Нажимайте на карту, чтобы изменить число копий (после максимума — ноль).</p><div class="classic-deck-cards"></div><button id="classic-save-opponent">Сохранить колоду</button><button id="classic-cancel-opponent">Отмена</button>'
    redraw()
    element('classic-save-opponent').onclick=()=>{this.customOpponentDeck=[...saved.entries()].filter(([,count])=>count>0).map(([def,count])=>({def,count}));localStorage.setItem(`gc-custom-bot-${this.botFaction}`,JSON.stringify(this.customOpponentDeck));editor.hidden=true;editor.classList.remove('classic-bot-editor');this.setup.setNotice(`Выбрано ${this.customOpponentDeck.reduce((n,c)=>n+c.count,0)} карт для бота`)}
    element('classic-cancel-opponent').onclick=()=>{editor.hidden=true;editor.classList.remove('classic-bot-editor')}
  }
}
