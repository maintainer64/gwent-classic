import { MatchMode, RoomStatus, type RoomSummary } from '../domain/types'
import './MainMenu.css'

// The board and deck editor are untouched; only the entry point is modernized.
// Names from the API are rendered with textContent, never as HTML.
export class MainMenu {
  private readonly root = document.createElement('section')
  private readonly active = document.createElement('div')
  private readonly status = document.createElement('p')
  private rooms: RoomSummary[] = []
  constructor(private readonly actions: {
    start: (mode: MatchMode) => void
    resume: (code: string) => void
    decks: () => void
  }) {
    this.root.id = 'classic-main-menu'
    this.root.setAttribute('aria-label', 'Главное меню Гвинта')
    const content = document.createElement('div')
    content.className = 'gwent-menu-panel'
    const header = document.createElement('div')
    header.className = 'gwent-menu-brand'
    const eyebrow = document.createElement('span')
    eyebrow.textContent = 'THE WITCHER · CARD GAME'
    const title = document.createElement('h1')
    title.textContent = 'GWENT'
    const subtitle = document.createElement('p')
    subtitle.textContent = 'Классический Гвинт. Теперь вместе.'
    header.append(eyebrow, title, subtitle)

    const modes = document.createElement('div')
    modes.className = 'gwent-menu-modes'
    const addMode = (label: string, caption: string, art: string, onClick: () => void) => {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'gwent-menu-mode'
      card.style.backgroundImage = `url('${art}')`
      const copy = document.createElement('span')
      copy.className = 'gwent-menu-mode-copy'
      const name = document.createElement('h3')
      name.textContent = label
      const hint = document.createElement('p')
      hint.textContent = caption
      copy.append(name, hint)
      card.append(copy)
      card.addEventListener('click', onClick)
      modes.append(card)
    }
    addMode('Против бота', 'Три уровня сложности, своя колода соперника.', '/img/icons/deck_shield_monsters.png',
      () => this.actions.start(MatchMode.Bot))
    addMode('С другом', 'Создайте комнату и отправьте ссылку-приглашение.', '/img/icons/deck_shield_scoiatael.png',
      () => this.actions.start(MatchMode.PvP))

    const secondary = document.createElement('div')
    secondary.className = 'gwent-menu-actions'
    const decks = document.createElement('button')
    decks.type = 'button'
    decks.className = 'gwent-menu-secondary'
    decks.textContent = 'Мои колоды'
    decks.addEventListener('click', this.actions.decks)
    const rules = document.createElement('button')
    rules.type = 'button'
    rules.className = 'gwent-menu-secondary'
    rules.textContent = 'Правила и обучение'
    rules.addEventListener('click', () => this.showRules())
    secondary.append(decks, rules)

    const activeTitle = document.createElement('h2')
    activeTitle.textContent = 'Незавершённые партии'
    activeTitle.className = 'gwent-menu-active-label'
    this.active.className = 'gwent-menu-active'
    this.status.className = 'gwent-menu-status'
    this.status.setAttribute('role', 'status')
    this.status.textContent = 'Проверяем комнаты…'
    const footer = document.createElement('p')
    footer.className = 'gwent-menu-foot'
    footer.textContent = 'Без аккаунтов · Комнаты живут 24 часа · Ходы проверяет сервер'
    content.append(header, modes, secondary, activeTitle, this.active, this.status, footer)
    this.root.append(content)
    document.body.append(this.root)
    this.root.hidden = true
  }
  show() { this.root.hidden = false }
  hide() { this.root.hidden = true }
  setError(error: string) { this.status.textContent = error }
  setRooms(rooms: RoomSummary[], preferred?: string | null) {
    this.rooms = rooms.filter(r => r.status !== RoomStatus.Finished && Date.parse(r.expiresAt) > Date.now())
    this.rooms.sort((a,b) =>
      (a.code === preferred ? -1 : 0) - (b.code === preferred ? -1 : 0) ||
      Date.parse(b.expiresAt) - Date.parse(a.expiresAt))
    this.active.replaceChildren()
    for (const room of this.rooms.slice(0, 4)) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'gwent-menu-resume'
      const label = document.createElement('span')
      const detail = document.createElement('small')
      label.textContent = `Вернуться в партию · ${room.code}`
      const minutes = Math.max(0, Math.ceil((Date.parse(room.expiresAt) - Date.now()) / 60000))
      const remaining = minutes >= 60 ? `${Math.floor(minutes/60)} ч ${minutes%60} мин` : `${minutes} мин`
      detail.textContent = `${room.mode === MatchMode.Bot ? 'Против бота' : 'С другом'} · ${room.status === RoomStatus.Waiting ? 'Ожидаем второго игрока' : 'Идёт матч'} · ещё ${remaining}`
      item.append(label, detail)
      item.addEventListener('click', () => this.actions.resume(room.code))
      this.active.append(item)
    }
    this.status.textContent = this.rooms.length ? '' : 'Сейчас активных комнат нет'
  }
  private showRules() {
    const overlay = document.createElement('dialog')
    overlay.className = 'gwent-menu-rules'
    overlay.setAttribute('aria-modal', 'true')
    const box = document.createElement('div')
    box.className = 'gwent-menu-rules-box'
    const header = document.createElement('h2')
    header.textContent = 'Правила и обучение Гвинта'
    const scroll = document.createElement('div')
    scroll.className = 'gwent-menu-rules-scroll'
    scroll.innerHTML = `
<h3>Цель игры</h3>
<p>Каждый матч — до двух побед в раундах. Раунд выигрывает игрок с большим суммарным силами отрядов на поле. Если силы равны — Нильфгаард выигрывает ничью (фракционное преимущество), иначе ничья присуждается обоим (они теряют по камню жизни).</p>
<h3>Порядок хода</h3>
<ol>
<li>В начале матча каждый получает 10 карт и один mulligan — можно заменить до 2 карт (оригинальный веер-карусель).</li>
<li>После mulligan при фракции Скоя’таэли выбирается, кто ходит первым (если применимо).</li>
<li>Ход — сыграть ровно одну карту (отряд, специальную или погодную) либо спасовать (<em>Pass</em>). После спасования ход не возвращается.</li>
<li>Раунд заканчивается, когда оба спасовали или у обоих закончились карты.</li>
<li>Победитель раунда забирает камень жизни соперника; ничья — оба теряют по камню.</li>
<li>После раунда поле очищается (с учётом выжившей случайной карты Монстров и особенностей Скеллиге в 3-м раунде), проигравший в раунде (либо сохраняющий право первого хода при ничьей) ходит первым в следующем.</li>
</ol>
<h3>Ряды и поле</h3>
<ul>
<li>Три боевых ряда: <strong>Ближний бой</strong>, <strong>Дальний бой</strong>, <strong>Осада</strong>.</li>
<li>У каждой карты есть ряд (или погода/спец). <em>Agile</em> можно выкладывать в Ближний или Дальний.</li>
<li>Погода (<em>Biting Frost, Impenetrable Fog, Torrential Rain, Skellige Storm, Clear Weather</em>) влияет на соответствующие ряды (Frost → Close до 1, Fog → Ranged до 1, Rain → Siege до 1, Storm → Ranged+Siege до 1). Clear снимает всю погоду.</li>
<li><strong>Hero</strong> — не подвержены погоде, Scorch, Decoy и большинству модификаторов.</li>
<li><strong>Commander's Horn</strong> удваивает силу всех отрядов на ряду (не героев). Одно роговое усиление на ряд. Лидерские Horn'ы учитывают занятость специального слота.</li>
</ul>
<h3>Ключевые способности</h3>
<ul>
<li><strong>Spy</strong> — кладётся вражеской стороне, владелец добирает 2 карты.</li>
<li><strong>Medic</strong> — воскрешает одного не-геройского отряда из своего сброса (выбор обязателен, если есть варианты). Цепочки Medic требуют последовательного выбора.</li>
<li><strong>Decoy</strong> — меняет выбранный отряд на поле с Приманкой, возвращая отряд в руку.</li>
<li><strong>Scorch</strong> — уничтожает сильнейшие не-геройские отряды на всём поле (по правилам оригинала).</li>
<li><strong>Morale</strong> — +1 ко всем другим отрядам того же ряда.</li>
<li><strong>Tight Bond</strong> — одинаковые карты в ряду удваивают (умножают) свою силу друг за друга.</li>
<li><strong>Muster</strong> — вызывает все карты с таким префиксом из колоды/руки.</li>
<li><strong>Berserker + Mardroeme</strong> — трансформация берсеркеров при наличии Mardroeme (включая героя Ermion).</li>
<li><strong>Avenger</strong> — при удалении с поля призывает замену (Cow → Bovine Defense Force и др.).</li>
</ul>
<h3>Фракционные особенности</h3>
<ul>
<li><strong>Королевства Севера (Realms)</strong> — после победы в раунде добирает 1 карту.</li>
<li><strong>Нильфгаард (Nilfgaard)</strong> — раунд, окончившийся ничьей, выигрывается Нильфгаардом.</li>
<li><strong>Монстры (Monsters)</strong> — после каждого раунда случайный отряд остаётся на поле.</li>
<li><strong>Скоя’таэли (Scoia'tael)</strong> — выбирают, кто ходит первым.</li>
<li><strong>Скеллиге (Skellige)</strong> — в третьем раунде после очистки поля воскрешают 2 случайные карты из сброса.</li>
</ul>
<h3>Практические советы</h3>
<ul>
<li>Не тратьте всю сильную руку в 1-м раунде — матч до 2 побед.</li>
<li>Pass — сильный инструмент, чтобы заставить соперника перебрать карты.</li>
<li>Сохраняйте баланс рядов (погода больно бьёт по стеку в одном ряду).</li>
<li>Spy позволяет добрать карты, жертвуя силой в текущем раунде.</li>
<li>Таймер хода (60с) идёт только в активной фазе хода (не во время mulligan/инициативы).</li>
</ul>
<p><small>Основано на оригинальных правилах Гвинта из The Witcher 3. Движок Go выступает авторитетным источником действий, клиент остаётся классическим по внешнему виду.</small></p>
    `
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'gwent-menu-rules-close'
    close.textContent = 'Закрыть'
    close.addEventListener('click', () => {
      overlay.close()
      overlay.remove()
    })
    overlay.addEventListener('click', e => {
      if (e.target === overlay) { overlay.close(); overlay.remove() }
    })
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); overlay.close(); overlay.remove() }
    })
    box.append(header, scroll, close)
    overlay.append(box)
    document.body.append(overlay)
    overlay.showModal()
  }
}
