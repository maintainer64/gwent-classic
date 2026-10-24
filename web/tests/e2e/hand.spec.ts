import { mockMatchBootstrap } from './bootstrap'
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test'
import type { Catalog, GameCard, Move, Player, Room } from '../../src/domain/types'

// UI interaction contracts use real catalog art and a deterministic server snapshot.
// Normal bot/PvP tests exercise these gestures against the Go server as well.
async function setup(page: Page, turn = 0) {
  const catalog = await mockMatchBootstrap(page)
  const card = (uid: string, predicate: (c: Catalog['cards'][number]) => boolean): GameCard => {
    const c = catalog.cards.find(predicate)!
    return { ...c, uid, def: c.id, special: ['special', 'weather'].includes(c.faction) }
  }
  const cards = [
    card('unit', (c) => c.row === 'close' && !c.ability),
    card('spy', (c) => c.row === 'close' && c.ability === 'spy'),
    card('agile', (c) => c.row === 'agile' && !c.ability),
    card('weather', (c) => c.key === 'weather.clear'),
    card('decoy', (c) => c.key === 'special.decoy'),
    card('horn', (c) => c.key === 'special.horn'),
  ]
  const player = (name: string): Player => ({
    name,
    faction: 'realms',
    handCount: 0,
    deckCount: 7,
    score: 0,
    rows: { close: [], ranged: [], siege: [] },
    special: { close: [], ranged: [], siege: [] },
    grave: [],
    passed: false,
    wins: 0,
    lives: 2,
    leader: '',
    leaderId: 0,
    leaderRu: '',
    leaderDescription: '',
    leaderPassive: false,
    leaderUsed: true,
    ready: true,
    redraws: 0,
  })
  const own = player('Игрок'),
    opponent = player('Соперник')
  const target = card('target', (c) => c.row === 'close' && !c.ability)
  own.hand = cards
  own.handCount = cards.length
  own.rows.close = [target]
  const now = Date.now()
  let room: Room = {
    code: 'HANDABCDEFGH',
    mode: 'pvp',
    phase: 'turn',
    version: 1,
    status: 'playing',
    players: [own, opponent],
    weather: [],
    round: 1,
    seat: 0,
    turn,
    initiative: 0,
    winner: -1,
    serverTime: new Date(now).toISOString(),
    turnDeadline: new Date(now + 60000).toISOString(),
    expiresAt: new Date(now + 86400000).toISOString(),
    events: [],
    eventSeq: 0,
  }
  let socket: WebSocketRoute
  const submitted: Move[] = []
  await page.route(`**/api/rooms/${room.code}`, (route) => route.fulfill({ json: room }))
  await page.routeWebSocket(`**/api/rooms/${room.code}/ws`, (ws) => {
    socket = ws
    ws.send(JSON.stringify(room))
  })
  await page.route(`**/api/rooms/${room.code}/actions`, async (route) => {
    submitted.push(route.request().postDataJSON().action)
    room = { ...room, version: room.version + 1, turn: 1 }
    await route.fulfill({ json: room })
  })
  await page.goto(`/room/${room.code}`)
  await expect(page.locator('.connection')).toHaveText('В сети')
  return {
    cards,
    own,
    opponent,
    submitted,
    update: (patch: Partial<Room>) => {
      room = { ...room, ...patch, version: room.version + 1 }
      socket.send(JSON.stringify(room))
    },
  }
}

test('grave: both piles use the hand gallery, empty state and browsing never submit moves', async ({
  page,
}) => {
  const { cards, own, opponent, submitted, update } = await setup(page, 1)
  own.grave = cards.slice(0, 4)
  opponent.grave = cards.slice(4)
  update({ players: [own, opponent] })
  for (const [side, title, grave] of [
    ['is-self', 'Ваш сброс', own.grave],
    ['is-opponent', 'Сброс соперника', opponent.grave],
  ] as const) {
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.locator(`.card-piles.${side} .grave-pile [data-zone=grave]`).click()
    const gallery = page.getByRole('dialog', { name: title, exact: true })
    await expect(gallery.locator('.hand-gallery-card')).toHaveCount(grave.length)
    const active = gallery.locator('.hand-gallery-card[aria-pressed=true]')
    await expect(active).toHaveAttribute('data-card-uid', grave.at(-1)!.uid)
    await active.click()
    await expect(gallery).toBeVisible()
    await expect(gallery.getByRole('button', { name: /Сыграть|Выбрать|Возродить/ })).toHaveCount(0)
    await page.keyboard.press('ArrowLeft')
    await expect(active).toHaveAttribute('data-card-uid', grave.at(-2)!.uid)
    await expect(gallery.getByLabel('Описание выбранной карты')).toContainText(
      grave.at(-2)!.description,
    )
    for (const size of [
      { width: 1366, height: 768 },
      { width: 1180, height: 820 },
      { width: 820, height: 1180 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(size)
      await expect(active).toBeInViewport({ ratio: 0.95 })
      await expect(
        gallery.getByRole('button', { name: 'Вернуться к игре', exact: true }),
      ).toBeInViewport()
      await page.screenshot({ path: test.info().outputPath(`grave-${side}-${size.width}.png`) })
    }
    await gallery.getByRole('button', { name: 'Вернуться к игре', exact: true }).click()
    await expect(gallery).toHaveCount(0)
  }
  own.grave = []
  update({ players: [own, opponent] })
  await page.getByRole('button', { name: 'Ваш сброс', exact: true }).click()
  const empty = page.getByRole('dialog', { name: 'Ваш сброс', exact: true })
  await expect(empty.getByRole('status')).toHaveText('Здесь пока нет карт')
  await page.keyboard.press('Escape')
  await expect(empty).toHaveCount(0)
  expect(submitted).toEqual([])
})

for (const uid of ['unit', 'spy', 'weather']) {
  test(`hand: select ${uid}, preview its effect on the right, then play once`, async ({ page }) => {
    const { cards, submitted } = await setup(page)
    const card = cards.find((c) => c.uid === uid)!
    await page.locator(`[data-zone=hand][data-card-uid=${uid}]`).click()
    await expect(page.getByLabel('Описание выбранной карты')).toContainText(card.nameRu)
    expect(submitted).toEqual([])
    await expect(page.getByRole('dialog', { name: 'Карты в руке' })).toHaveCount(0)
    expect(submitted).toEqual([])
    const selected = page.getByRole('complementary', { name: 'Выбранная карта' })
    await expect(selected).toBeVisible()
    await expect(selected.getByLabel('Описание выбранной карты')).toContainText(card.description)
    const bounds = await selected.locator('.full-card').boundingBox()
    expect(bounds!.x).toBeGreaterThan(page.viewportSize()!.width * 0.7)
    if (uid === 'weather') await selected.getByRole('button', { name: 'Сыграть карту' }).click()
    else
      await page
        .getByRole('button', {
          name: `Сыграть: Ближний бой${uid === 'spy' ? ' соперника' : ''}`,
          exact: true,
        })
        .click()
    await expect.poll(() => submitted.length).toBe(1)
    expect(submitted[0]).toMatchObject({ type: 'play', uid })
    expect(submitted[0].row).toBe(uid === 'weather' ? undefined : 'close')
    await expect(page.getByRole('dialog', { name: 'Карты в руке' })).toHaveCount(0)
  })
}

test('hand: agile and decoy select their destination directly from the table', async ({ page }) => {
  const { submitted, update } = await setup(page)
  await page.locator('[data-zone=hand][data-card-uid=agile]').click()
  expect(submitted).toEqual([])
  await expect(page.locator('.battle-row.legal')).toHaveCount(2)
  await page.getByRole('button', { name: 'Сыграть: Дальний бой', exact: true }).click()
  await expect.poll(() => submitted.length).toBe(1)
  expect(submitted[0]).toMatchObject({ type: 'play', uid: 'agile', row: 'ranged' })
  update({ turn: 0 })
  await expect(page.getByRole('button', { name: 'Спасовать' })).toBeEnabled()
  await page.locator('[data-zone=hand][data-card-uid=decoy]').click()
  expect(submitted).toHaveLength(1)
  await page.locator('[data-zone=board][data-card-uid=target]').click()
  await expect.poll(() => submitted.length).toBe(2)
  expect(submitted[1]).toMatchObject({ type: 'play', uid: 'decoy', target: 'target' })
})

test('touch: tap selects directly, the hand gallery has its own button, and a whole row is playable', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    reducedMotion: 'reduce',
    viewport: { width: 1180, height: 820 },
  })
  try {
    const page = await context.newPage()
    const { submitted } = await setup(page)
    await page.locator('[data-zone=hand][data-card-uid=unit]').tap()
    await expect(page.getByRole('dialog', { name: 'Карты в руке' })).toHaveCount(0)
    await expect(page.getByRole('complementary', { name: 'Выбранная карта' })).toBeVisible()
    await page.getByRole('button', { name: 'Рассмотреть руку', exact: true }).tap()
    const gallery = page.getByRole('dialog', { name: 'Карты в руке' })
    await expect(gallery).toBeVisible()
    await gallery.getByRole('button', { name: 'Выбрать карту', exact: true }).tap()
    const row = page.locator('[data-seat="0"][data-row=close]')
    const area = row.getByRole('button', { name: 'Сыграть: Ближний бой', exact: true })
    const bounds = await row.boundingBox(),
      target = await area.boundingBox()
    expect(target!.width).toBeCloseTo(bounds!.width, 0)
    expect(target!.height).toBeCloseTo(bounds!.height, 0)
    expect(await area.textContent()).toBe('')
    await area.tap()
    await expect.poll(() => submitted.length).toBe(1)
    expect(submitted[0]).toMatchObject({ type: 'play', uid: 'unit', row: 'close' })
  } finally {
    await context.close()
  }
})

test('hand: browsing, keyboard, cancel and a fresh server turn never submit stale cards', async ({
  page,
}) => {
  const { cards, submitted, update } = await setup(page, 1)
  await page.locator('[data-zone=hand][data-card-uid=unit]').click({ button: 'right' })
  const preview = page.getByRole('dialog', { name: 'Карты в руке' })
  await expect(preview.getByRole('button', { name: 'Выбрать карту' })).toBeDisabled()
  await page.locator('[data-zone=preview][aria-pressed=true]').click()
  await page.keyboard.press('ArrowRight')
  const active = await preview
    .locator('[data-zone=preview][aria-pressed=true]')
    .getAttribute('aria-label')
  expect(active).not.toBe(cards[0].nameRu)
  await expect(page.getByLabel('Описание выбранной карты')).toContainText(active!)
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await expect(page.locator('[data-zone=hand][aria-pressed=true]')).toHaveCount(0)
  await page.locator('[data-zone=hand][data-card-uid=spy]').click({ button: 'right' })
  update({ turn: 0 })
  await expect(preview).toHaveCount(0)
  expect(submitted).toEqual([])
})

test('hand: unavailable decoy and horn remain inspectable and cannot submit a move', async ({
  page,
}) => {
  const { cards, own, opponent, submitted, update } = await setup(page)
  own.rows.close = []
  for (const row of ['close', 'ranged', 'siege'] as const)
    own.special[row] = [cards.find((c) => c.uid === 'horn')!]
  update({ players: [own, opponent] })
  for (const uid of ['decoy', 'horn']) {
    await page.locator(`[data-zone=hand][data-card-uid=${uid}]`).click({ button: 'right' })
    await expect(
      page
        .getByRole('dialog', { name: 'Карты в руке' })
        .getByRole('button', { name: 'Выбрать карту' }),
    ).toBeDisabled()
    await page.locator('[data-zone=preview][aria-pressed=true]').click()
    await expect(page.getByRole('dialog', { name: 'Карты в руке' })).toBeVisible()
    await page.keyboard.press('Escape')
  }
  expect(submitted).toEqual([])
})

test('match menu: sound, history and invitation fallback on a tablet HTTP connection', async ({
  page,
}) => {
  await setup(page)
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined }))
  await page.getByRole('button', { name: 'Меню', exact: true }).click()
  const menu = page.getByRole('dialog', { name: 'Меню партии' })
  await menu.getByRole('button', { name: 'Скопировать приглашение' }).click()
  const input = menu.locator('#invite-link')
  expect(
    await input.evaluate((node: HTMLInputElement) => node.selectionEnd! - node.selectionStart!),
  ).toBe((await input.inputValue()).length)
  await menu.getByRole('button', { name: 'Настройки', exact: true }).click()
  const preferences = page.getByRole('dialog', { name: 'Настройки', exact: true })
  await preferences.getByRole('switch', { name: 'Звуковые эффекты', exact: true }).uncheck()
  await expect(
    preferences.getByRole('switch', { name: 'Звуковые эффекты', exact: true }),
  ).not.toBeChecked()
  await preferences.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await page.getByRole('button', { name: 'Меню', exact: true }).click()
  await menu.getByRole('button', { name: 'История ходов' }).click()
  await expect(page.getByRole('dialog', { name: 'Ход партии' })).toBeVisible()
  await expect(menu).toHaveCount(0)
})

for (const actor of [0, 1]) {
  test(`announcements: first player ${actor}, turn changes and no snapshot replay`, async ({
    page,
  }) => {
    const { own, opponent, update } = await setup(page)
    const frame = { players: [own, opponent], weather: [], round: 1, status: 'playing' as const }
    const opening = { id: 1, type: 'round_start', actor, frame }
    update({ eventSeq: 1, transitions: [opening], turn: actor })
    const banner = page.locator('.match-announcement')
    await expect(banner).toHaveText(
      actor === 0 ? 'Вы начинаете партию' : 'Соперник начинает партию',
    )
    await expect(banner.locator('img')).toHaveAttribute(
      'src',
      `/img/icons/notif_${actor === 0 ? 'me' : 'op'}_coin.png`,
    )
    await page.screenshot({ path: test.info().outputPath(`first-player-${actor}.png`) })
    await expect(banner).toHaveCount(0)
    update({ turn: 1 - actor })
    await expect(banner).toHaveText(actor === 0 ? 'Ход соперника' : 'Ваш ход')
    // The notice is informational and must never swallow a tap on the table.
    expect(await banner.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe('none')
    await expect(banner).toHaveCount(0)
    await page.reload()
    await expect(page.locator('.connection')).toHaveText('В сети')
    await expect(banner).toHaveCount(0)
  })
}

test('announcements: round result and next starter remain readable in order', async ({ page }) => {
  const { own, opponent, update } = await setup(page)
  const frame = { players: [own, opponent], weather: [], round: 2, status: 'playing' as const }
  update({
    round: 2,
    eventSeq: 2,
    transitions: [
      { id: 1, type: 'round_end', actor: -1, frame },
      { id: 2, type: 'round_start', actor: 1, frame },
    ],
    turn: 1,
  })
  const banner = page.locator('.match-announcement')
  await expect(banner).toHaveText('Раунд завершён вничью')
  await expect(banner.locator('img')).toHaveAttribute('src', '/img/icons/notif_draw_round.png')
  await expect(banner).toHaveText('Раунд 2 · Соперник ходит первым')
  await expect(banner).toHaveCount(0)
})
