import { BotDeckMode, BotDifficulty, FACTIONS, FACTION_ABILITIES, FACTION_ART, type Faction } from '../domain/types'
import './SetupScreen.css'

export type SetupMode = 'bot' | 'pvp'
export type SetupState = {
  mode: SetupMode
  name: string
  difficulty: BotDifficulty
  deckMode: BotDeckMode
  faction: Faction
}

// Visual match-setup screen: segmented controls and faction art cards instead
// of dropdowns. Owns no game state; the controller receives every change.
export class SetupScreen {
  private readonly root = document.createElement('section')
  private readonly notice = document.createElement('div')
  private readonly botOptions = document.createElement('div')
  private readonly pvpNote = document.createElement('div')
  private readonly factionGrid = document.createElement('div')
  private readonly nameInput = document.createElement('input')
  private readonly modeSegment: HTMLElement
  private readonly difficultySegment: HTMLElement
  private readonly deckModeSegment: HTMLElement
  private readonly editBot = document.createElement('button')
  private state: SetupState

  constructor(private readonly actions: {
    change: (state: SetupState) => void
    next: () => void
    back: () => void
    editBotDeck: () => void
    initial: SetupState
  }) {
    this.state = { ...actions.initial }
    this.root.id = 'classic-setup'
    this.root.setAttribute('aria-label', 'Настройка партии')
    this.root.hidden = true

    const panel = document.createElement('div')
    panel.className = 'setup-panel'

    const header = document.createElement('header')
    header.className = 'setup-brand'
    const eyebrow = document.createElement('span')
    eyebrow.textContent = 'GWENT · НАСТРОЙКА ПАРТИИ'
    const title = document.createElement('h1')
    title.textContent = 'Новый бой'
    header.append(eyebrow, title)

    const nameBlock = this.block('Ваше имя')
    this.nameInput.className = 'setup-name-input'
    this.nameInput.maxLength = 24
    this.nameInput.setAttribute('autocomplete', 'nickname')
    this.nameInput.value = this.state.name
    this.nameInput.addEventListener('input', () => this.commit({ name: this.nameInput.value }))
    nameBlock.append(this.nameInput)

    const modeBlock = this.block('Режим игры')
    this.modeSegment = this.segment([
      { value: 'bot', label: 'Против бота', hint: 'Три уровня сложности' },
      { value: 'pvp', label: 'С другом', hint: 'По ссылке-приглашению' }
    ], this.state.mode, value => { this.commit({ mode: value as SetupMode }); this.refreshVisibility() })
    modeBlock.append(this.modeSegment)

    this.botOptions.className = 'setup-bot-options'
    const difficultyBlock = this.block('Сложность бота')
    this.difficultySegment = this.segment([
      { value: BotDifficulty.Easy, label: 'Лёгкая', hint: 'Случайные ходы' },
      { value: BotDifficulty.Normal, label: 'Обычная', hint: 'Продумывает ходы' },
      { value: BotDifficulty.Hard, label: 'Сложная', hint: 'Считает всё поле' }
    ], this.state.difficulty, value => this.commit({ difficulty: value as BotDifficulty }))
    difficultyBlock.append(this.difficultySegment)

    const deckModeBlock = this.block('Колода соперника')
    this.deckModeSegment = this.segment([
      { value: BotDeckMode.Random, label: 'Случайная', hint: 'Любая фракция' },
      { value: BotDeckMode.Faction, label: 'Во фракции', hint: 'Выберите фракцию' },
      { value: BotDeckMode.Custom, label: 'Своя колода', hint: 'Соберите вручную' }
    ], this.state.deckMode, value => { this.commit({ deckMode: value as BotDeckMode }); this.refreshVisibility() })
    deckModeBlock.append(this.deckModeSegment)

    const factionBlock = this.block('Фракция соперника')
    this.factionGrid.className = 'setup-factions'
    for (const faction of Object.keys(FACTIONS) as Faction[]) {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'setup-faction'
      card.style.backgroundImage = `url('${FACTION_ART[faction]}')`
      card.dataset.faction = faction
      const copy = document.createElement('span')
      copy.className = 'setup-faction-copy'
      const name = document.createElement('strong')
      name.textContent = FACTIONS[faction]
      const perk = document.createElement('small')
      perk.textContent = FACTION_ABILITIES[faction]
      copy.append(name, perk)
      card.append(copy)
      card.addEventListener('click', () => { this.commit({ faction }); this.markFaction() })
      this.factionGrid.append(card)
    }
    this.editBot.id = 'setup-edit-bot'
    this.editBot.type = 'button'
    this.editBot.textContent = 'Собрать колоду бота'
    this.editBot.addEventListener('click', () => this.actions.editBotDeck())
    factionBlock.append(this.factionGrid, this.editBot)

    this.botOptions.append(difficultyBlock, deckModeBlock, factionBlock)

    this.pvpNote.className = 'setup-pvp-note'
    this.pvpNote.innerHTML = '<h3>Игра по ссылке</h3><p>После сбора колоды будет создана комната — отправьте другу ссылку-приглашение. Матч начнётся, когда вторым игроком присоединится.</p>'

    this.notice.id = 'setup-notice'
    this.notice.setAttribute('role', 'status')

    const actionsRow = document.createElement('div')
    actionsRow.className = 'setup-actions'
    const back = document.createElement('button')
    back.type = 'button'
    back.className = 'setup-back'
    back.textContent = '← Главное меню'
    back.addEventListener('click', () => this.actions.back())
    const next = document.createElement('button')
    next.type = 'button'
    next.className = 'setup-next'
    next.textContent = 'Выбрать колоду →'
    next.addEventListener('click', () => this.actions.next())
    actionsRow.append(back, next)

    const foot = document.createElement('p')
    foot.className = 'setup-foot'
    foot.textContent = 'Свою фракцию и колоду вы соберёте на следующем экране — с оригинальными картами и анимациями.'

    panel.append(header, nameBlock, modeBlock, this.botOptions, this.pvpNote, this.notice, actionsRow, foot)
    this.root.append(panel)
    document.body.append(this.root)
    this.markMode()
    this.markDifficulty()
    this.markDeckMode()
    this.markFaction()
    this.refreshVisibility()
  }

  show() { this.root.hidden = false }
  hide() { this.root.hidden = true }
  setNotice(text: string) { this.notice.textContent = text }
  setMode(mode: SetupMode) { this.commit({ mode }); this.markMode(); this.refreshVisibility() }
  snapshot(): SetupState { return { ...this.state } }

  private block(title: string): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'setup-block'
    const heading = document.createElement('h3')
    heading.textContent = title
    wrapper.append(heading)
    return wrapper
  }

  private segment(options: { value: string; label: string; hint: string }[], current: string, onSelect: (value: string) => void): HTMLElement {
    const group = document.createElement('div')
    group.className = 'setup-segmented'
    for (const option of options) {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.value = option.value
      const label = document.createElement('strong')
      label.textContent = option.label
      const hint = document.createElement('small')
      hint.textContent = option.hint
      button.append(label, hint)
      // Highlight the clicked option right away: external setMode()/mark*()
      // only re-sync from the controller, so without this the .active
      // marker stayed on the option preselected when the screen opened.
      button.addEventListener('click', () => { onSelect(option.value); this.markSegment(group, option.value) })
      group.append(button)
    }
    this.markSegment(group, current)
    return group
  }

  private markSegment(group: HTMLElement, value: string) {
    for (const button of group.querySelectorAll<HTMLElement>('button')) button.classList.toggle('active', button.dataset.value === value)
  }
  private markMode() { this.markSegment(this.modeSegment, this.state.mode) }
  private markDifficulty() { this.markSegment(this.difficultySegment, this.state.difficulty) }
  private markDeckMode() { this.markSegment(this.deckModeSegment, this.state.deckMode) }
  private markFaction() {
    for (const card of this.factionGrid.querySelectorAll<HTMLElement>('.setup-faction'))
      card.classList.toggle('active', card.dataset.faction === this.state.faction)
  }
  private refreshVisibility() {
    this.botOptions.hidden = this.state.mode !== 'bot'
    this.pvpNote.hidden = this.state.mode !== 'pvp'
    const showFactions = this.state.mode === 'bot' && this.state.deckMode !== BotDeckMode.Random
    this.factionGrid.hidden = !showFactions
    this.editBot.hidden = this.state.mode !== 'bot' || this.state.deckMode !== BotDeckMode.Custom
  }
  private commit(patch: Partial<SetupState>) {
    this.state = { ...this.state, ...patch }
    this.actions.change({ ...this.state })
  }
}
