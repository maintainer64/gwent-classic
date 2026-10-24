import { expect, test, type Page } from '@playwright/test'
import type { Catalog, Room } from '../../src/domain/types'
const rows: Record<string, string> = {
  close: 'Ближний бой',
  ranged: 'Дальний бой',
  siege: 'Осада',
}
async function state(page: Page): Promise<Room> {
  const code = /\/room\/([^/]+)/.exec(page.url())![1]
  const response = await page.request.get(`/api/rooms/${code}`)
  expect(response.ok()).toBeTruthy()
  return response.json() as Promise<Room>
}
function errors(page: Page) {
  const list: string[] = []
  page.on('pageerror', (e) => list.push(e.message))
  return list
}
test('deck builder: edit, leader, copy, file round-trip and persistence', async ({ page }) => {
  const faults = errors(page)
  page.on('dialog', (dialog) => dialog.accept())
  await page.goto('/')
  await page.getByRole('button', { name: 'Колоды', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Искусство подготовки' })).toBeVisible()
  await page.getByRole('button', { name: '+ Новая колода', exact: true }).click()
  await page.getByRole('textbox', { name: 'Название колоды' }).fill('Моя тактика')
  await page.getByRole('combobox', { name: 'Фракция колоды' }).selectOption('skellige')
  await page.getByRole('button', { name: 'Автосборка', exact: true }).click()
  await page.locator('.leader-choice').click()
  await page.locator('.leader-grid .game-card').nth(1).click()
  await expect(page.locator('.leader-choice')).toContainText('Король Бран')
  await page.getByRole('textbox', { name: 'Поиск карт' }).fill('Геральт')
  await expect(page.locator('.collection-grid .game-card')).toHaveCount(1)
  await page.getByRole('button', { name: 'Убрать Геральт из Ривии', exact: true }).click()
  await expect(page.locator('.deck-validation')).toContainText('Нужно ещё 1')
  await page.getByRole('button', { name: 'Добавить Геральт из Ривии', exact: true }).click()
  await expect(page.locator('.deck-validation')).toContainText('готова')
  await page.getByRole('button', { name: 'Копия', exact: true }).click()
  await expect(page.locator('.library-deck')).toHaveCount(7)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Экспорт', exact: true }).click()
  const file = await download
  const path = test.info().outputPath('deck.json')
  await file.saveAs(path)
  await page.locator('input[type=file]').setInputFiles(path)
  await expect(page.locator('.library-deck')).toHaveCount(8)
  await page.reload()
  await page.getByRole('button', { name: 'Колоды', exact: true }).click()
  await expect(page.locator('.library-deck')).toHaveCount(8)
  await expect(page.locator('.library-items')).toContainText('Моя тактика')
  expect(faults).toEqual([])
})
test('complete bot game, actual card play, reconnect and Russian interface', async ({ page }) => {
  const faults = errors(page)
  await page.goto('/')
  await page.getByRole('button', { name: /^Сыграть с ботом/ }).click()
  await page.getByRole('button', { name: 'Лёгкая', exact: true }).click()
  await page.getByRole('button', { name: 'Начать партию', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Подготовьте стартовую руку' })).toBeVisible()
  await expect(page.locator('.hand-gallery-card')).toHaveCount(10)
  await page.locator('[data-zone=preview][aria-pressed=true]').click()
  await expect(page.getByRole('dialog')).toContainText('ещё 1')
  await page.locator('[data-zone=preview][aria-pressed=true]').click()
  await expect(page.getByRole('dialog', { name: 'Подготовьте стартовую руку' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Спасовать', exact: true })).toBeEnabled()
  const before = await state(page)
  const card = before.players[before.seat].hand!.find((c) =>
    ['close', 'ranged', 'siege', 'agile'].includes(c.row),
  )!
  await page.locator(`[data-zone=hand][data-card-uid="${card.uid}"]`).click()
  await expect(page.getByRole('complementary', { name: 'Выбранная карта' })).toBeVisible()
  const row = card.row === 'agile' ? 'close' : card.row
  await page
    .getByRole('button', {
      name: `Сыграть: ${rows[row]}${card.ability.split(' ').includes('spy') ? ' соперника' : ''}`,
      exact: true,
    })
    .click()
  await expect.poll(async () => (await state(page)).version).toBeGreaterThan(before.version)
  expect(
    (await state(page)).transitions?.some((e) => e.type === 'played' && e.card?.uid === card.uid),
  ).toBeTruthy()
  const url = page.url()
  await page.reload()
  await expect(page).toHaveURL(url)
  await expect(page.getByRole('button', { name: 'Спасовать', exact: true })).toBeEnabled()
  for (let n = 0; n < 4; n++) {
    const r = await state(page)
    if (r.status === 'finished') break
    await page.getByRole('button', { name: 'Спасовать', exact: true }).click()
    await expect.poll(async () => (await state(page)).version).toBeGreaterThan(r.version)
  }
  await expect(page.getByRole('button', { name: 'Реванш', exact: true })).toBeVisible()
  await expect(page.locator('.results-table')).toBeVisible()
  expect(await page.locator('body').innerText()).not.toMatch(
    /Scorch|Mulligan|Join game|Create game|realms/,
  )
  expect(faults).toEqual([])
  const finished = await state(page)
  await page.getByRole('button', { name: 'Реванш', exact: true }).click()
  await expect(page).toHaveURL(url)
  await expect(page.getByRole('dialog', { name: 'Подготовьте стартовую руку' })).toBeVisible()
  const again = await state(page)
  expect(again.code).toBe(finished.code)
  expect(again.gameNumber).toBe((finished.gameNumber ?? 1) + 1)
  expect(again.bot).toEqual(finished.bot)
  expect(again.timer).toEqual(finished.timer)
  expect(again.players.map((p) => [p.faction, p.leaderId])).toEqual(
    finished.players.map((p) => [p.faction, p.leaderId]),
  )
})
test('two isolated players: invitation, concurrent ready, WS, offline recovery and tied rounds', async ({
  browser,
  baseURL,
}) => {
  const a = await browser.newContext({ baseURL, reducedMotion: 'reduce' }),
    b = await browser.newContext({ baseURL, reducedMotion: 'reduce' })
  const host = await a.newPage(),
    guest = await b.newPage()
  const hostErrors = errors(host),
    guestErrors = errors(guest)
  try {
    await host.goto('/')
    await host.getByRole('button', { name: 'Пригласить друга', exact: true }).click()
    await host.getByRole('button', { name: 'Создать комнату', exact: true }).click()
    await expect(host.getByRole('heading', { name: 'Место напротив свободно' })).toBeVisible()
    const invite = await host.locator('#invite-link').inputValue()
    await guest.goto(invite)
    await expect(guest.getByRole('heading', { name: 'Вас ждут за столом' })).toBeVisible()
    await guest.getByRole('button', { name: /Скеллиге/ }).click()
    await guest.getByRole('button', { name: 'Присоединиться к партии', exact: true }).click()
    await expect(host.getByRole('dialog', { name: 'Подготовьте стартовую руку' })).toBeVisible()
    await Promise.all([
      host.getByRole('button', { name: 'Готово · начать партию', exact: true }).click(),
      guest.getByRole('button', { name: 'Готово · начать партию', exact: true }).click(),
    ])
    await expect(host.getByRole('dialog')).toHaveCount(0)
    await expect(guest.getByRole('dialog')).toHaveCount(0)
    await b.setOffline(true)
    await expect(guest.locator('.network-banner')).toBeVisible()
    await b.setOffline(false)
    await expect(guest.locator('.connection')).toHaveText('В сети')
    await guest.reload()
    await expect(guest.locator('.connection')).toHaveText('В сети')
    for (let n = 0; n < 4; n++) {
      const r = await state(host),
        page = r.turn === r.seat ? host : guest
      await expect(page.getByRole('button', { name: 'Спасовать', exact: true })).toBeEnabled()
      await page.getByRole('button', { name: 'Спасовать', exact: true }).click()
      await expect.poll(async () => (await state(host)).version).toBeGreaterThan(r.version)
      if (n === 1) await expect(host.getByLabel('Осталось жизней: 1')).toHaveCount(2)
    }
    await expect(host.getByRole('dialog', { name: 'Достойная ничья' })).toBeVisible()
    await expect(guest.getByRole('dialog', { name: 'Достойная ничья' })).toBeVisible()
    await host.getByRole('button', { name: 'Реванш', exact: true }).click()
    await expect(host.getByRole('button', { name: 'Ждём соперника…', exact: true })).toBeDisabled()
    await guest.getByRole('button', { name: 'Принять реванш', exact: true }).click()
    await expect(host.getByRole('dialog', { name: 'Подготовьте стартовую руку' })).toBeVisible()
    await expect(guest.getByRole('dialog', { name: 'Подготовьте стартовую руку' })).toBeVisible()
    expect((await state(host)).gameNumber).toBe(2)
    expect((await state(guest)).code).toBe((await state(host)).code)
    expect([...hostErrors, ...guestErrors]).toEqual([])
  } finally {
    await a.close()
    await b.close()
  }
})
test('events animate a move without replaying it after a resync', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await page.getByRole('button', { name: /^Сыграть с ботом/ }).click()
  await page.getByRole('button', { name: 'Начать партию', exact: true }).click()
  await page.getByRole('button', { name: 'Готово · начать партию', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Спасовать', exact: true })).toBeEnabled({
    timeout: 20000,
  })
  const before = await state(page)
  const card = before.players[before.seat].hand!.find((c) =>
    ['close', 'ranged', 'siege', 'agile'].includes(c.row),
  )!
  await page.locator(`[data-zone=hand][data-card-uid="${card.uid}"]`).click()
  await expect(page.getByRole('complementary', { name: 'Выбранная карта' })).toBeVisible()
  const row = card.row === 'agile' ? 'close' : card.row
  await page
    .getByRole('button', {
      name: `Сыграть: ${rows[row]}${card.ability.includes('spy') ? ' соперника' : ''}`,
      exact: true,
    })
    .click()
  await expect(page.locator('.match-announcement')).toBeVisible()
  await expect(page.locator('.match-announcement')).toHaveCount(0, { timeout: 20000 })
  await page.screenshot({
    path: test.info().outputPath('battlefield-1366.png'),
    fullPage: true,
  })
  await page.reload()
  await expect(page.locator('.match-announcement')).toHaveCount(0)
})

test('tablet and phone: touch inspection, ability filter and playable rows without overflow', async ({
  page,
}) => {
  const faults = errors(page)
  await page.setViewportSize({ width: 820, height: 1180 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Колоды', exact: true }).click()
  await page.getByRole('combobox', { name: 'Способность карты' }).selectOption('spy')
  await expect(page.locator('.collection-grid .game-card')).not.toHaveCount(0)
  const first = page.locator('.collection-grid .game-card').first(),
    name = await first.getAttribute('aria-label')
  await first.click()
  await expect(page.getByRole('dialog', { name: name! })).toBeVisible()
  await expect(page.locator('dialog .card-detail')).toContainText('Шпион')
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await page.screenshot({
    path: test.info().outputPath('decks-tablet.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: 'Играть', exact: true }).click()
  await page.getByRole('button', { name: /^Сыграть с ботом/ }).click()
  await page.getByRole('button', { name: 'Начать партию', exact: true }).click()
  await page.getByRole('button', { name: 'Готово · начать партию', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Спасовать', exact: true })).toBeEnabled()
  await page.locator('.hand-cards .game-card').first().click()
  await expect(page.getByRole('complementary', { name: 'Выбранная карта' })).toBeVisible()
  await page.getByRole('button', { name: 'Рассмотреть руку', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Карты в руке' })).toBeVisible()
  await expect(page.getByLabel('Описание выбранной карты')).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await page.screenshot({
    path: test.info().outputPath('match-tablet.png'),
    fullPage: true,
  })
  for (const size of [
    { width: 820, height: 1180 },
    { width: 1180, height: 820 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBeTruthy()
    await expect(page.locator('.table')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Спасовать', exact: true })).toBeEnabled()
  }
  await page.screenshot({
    path: test.info().outputPath('match-phone.png'),
    fullPage: true,
  })
  expect(faults).toEqual([])
})

test('custom bot deck and leader with a two-stage discard/draw choice', async ({ page }) => {
  const faults = errors(page)
  await page.goto('/')
  const catalog = (await (await page.request.get('/api/catalog')).json()) as Catalog
  const leader = catalog.leaders.find((l) => l.ability === 'eredin_destroyer')!
  await page.getByRole('button', { name: /^Сыграть с ботом/ }).click()
  await page.getByRole('button', { name: /Чудовища/ }).click()
  await page.getByRole('button', { name: 'Открыть колодострой', exact: true }).click()
  await page.locator('.leader-choice').click()
  await page
    .locator('.leader-grid')
    .getByRole('button', { name: leader.nameRu, exact: true })
    .click()
  await page.getByRole('button', { name: 'Использовать колоду', exact: true }).click()
  await page.getByLabel('Характер соперника').selectOption('economy')
  await page.getByRole('button', { name: 'Сложная', exact: true }).click()
  await page.getByLabel('Колода соперника').selectOption('custom')
  await page
    .getByRole('combobox', { name: 'Колода бота', exact: true })
    .selectOption({ label: 'Скеллиге · Скеллиге' })
  await page.getByRole('button', { name: 'Начать партию', exact: true }).click()
  await page.getByRole('button', { name: 'Готово · начать партию', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Спасовать', exact: true })).toBeEnabled()
  const before = await state(page)
  expect(before.bot).toMatchObject({
    difficulty: 'hard',
    style: 'economy',
    deckMode: 'custom',
    faction: 'skellige',
  })
  expect(before.players[before.seat].leaderId).toBe(leader.id)
  await page.getByRole('region', { name: 'Ваше состояние' }).locator('.leader-mini').click()
  await page.getByRole('button', { name: 'Применить способность', exact: true }).click()
  const discard = page.getByRole('dialog', { name: 'Выберите две карты для сброса' })
  await discard.locator('.game-card').nth(0).click()
  await discard.locator('.game-card').nth(1).click()
  await discard.getByRole('button', { name: 'Подтвердить выбор', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Выберите карту из колоды' })
    .locator('.game-card')
    .first()
    .click()
  await expect.poll(async () => (await state(page)).players[before.seat].leaderUsed).toBe(true)
  const after = await state(page)
  expect(after.players[before.seat].handCount).toBe(before.players[before.seat].handCount - 1)
  expect(after.players[before.seat].grave.length).toBeGreaterThanOrEqual(2)
  expect(faults).toEqual([])
})
