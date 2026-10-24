import { expect, test, type Page } from '@playwright/test'
import type { Room } from '../../src/domain/types'
import { mockMatchBootstrap } from './bootstrap'

async function state(page: Page): Promise<Room> {
  const response = await page.request.get(`/api/rooms/${page.url().split('/room/')[1]}`)
  expect(response.ok()).toBeTruthy()
  return response.json()
}

test('twelve characters: original portraits, deck gallery and selection persist on desktop and tablet', async ({
  page,
}) => {
  const faults: string[] = []
  page.on('pageerror', (error) => faults.push(error.message))
  const catalog = await mockMatchBootstrap(page)
  await page.goto('/')
  await page.getByRole('button', { name: /^Испытания · 12 соперников/ }).click()
  await expect(page.getByRole('region', { name: 'Выбранный соперник' })).toContainText('Геральт')
  await page.getByRole('button', { name: 'Выбрать соперника · 12', exact: true }).click()
  const roster = page.getByRole('dialog', { name: 'Соперники', exact: true })
  await expect(roster.locator('.opponent-tile')).toHaveCount(12)
  await expect
    .poll(() =>
      roster
        .locator('.opponent-tile > img')
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true)
  for (const size of [
    { width: 1366, height: 768 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size)
    await expect(roster).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    )
    await page.screenshot({ path: test.info().outputPath(`opponents-${size.width}.png`) })
  }
  await roster.getByRole('button', { name: 'Йеннифэр', exact: true }).click()
  await expect(roster).toHaveCount(0)
  const selected = page.getByRole('region', { name: 'Выбранный соперник' })
  await expect(selected).toContainText('Вторая жизнь')
  await selected.getByRole('button', { name: 'Рассмотреть колоду', exact: true }).click()
  const deck = page.getByRole('dialog', { name: 'Йеннифэр · Вторая жизнь', exact: true })
  const profile = catalog.opponents!.find((p) => p.id === 'yennefer')!
  await expect(deck.locator('.opponent-deck-entry')).toHaveCount(profile.deck.length)
  await expect(deck.locator('.opponent-deck-summary')).toContainText('28 карт · 22 отряда')
  await expect(deck.locator('.opponent-deck-leader')).toHaveAttribute('aria-pressed', 'true')
  const firstCard = deck.locator('.opponent-deck-entry .game-card').first()
  await firstCard.click()
  await expect(firstCard).toHaveAttribute('aria-pressed', 'true')
  const firstKey = catalog.cards.find((c) => c.key === profile.deck[0].key)!.key
  await expect(deck.locator('.full-card')).toHaveAttribute('data-card-key', firstKey)
  await expect(deck.getByRole('complementary', { name: 'Выбранная карта колоды' })).toBeVisible()
  for (const size of [
    { width: 1366, height: 768 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size)
    expect(
      await deck.evaluate((dialog) => {
        const bounds = dialog.getBoundingClientRect()
        return (
          bounds.left >= 0 &&
          bounds.right <= innerWidth &&
          bounds.top >= 0 &&
          bounds.bottom <= innerHeight &&
          dialog.scrollWidth <= dialog.clientWidth + 1
        )
      }),
    ).toBe(true)
    await expect(deck.locator('.opponent-deck-list')).toBeVisible()
    await expect(deck.locator('.full-card')).toBeInViewport()
    await expect(deck.locator('.full-card-copy p')).toBeInViewport({ ratio: 1 })
    await expect(
      deck.getByRole('button', { name: 'К выбору соперника', exact: true }),
    ).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath(`opponent-deck-${size.width}.png`) })
  }
  await expect(deck.getByRole('button', { name: 'Сыграть карту', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(deck).toHaveCount(0)
  // Every profile must resolve all unique entries and retain a usable viewer.
  for (const opponent of catalog.opponents!) {
    await page.getByRole('button', { name: 'Выбрать соперника · 12', exact: true }).click()
    await roster.getByRole('button', { name: opponent.name, exact: true }).click()
    await selected.getByRole('button', { name: 'Рассмотреть колоду', exact: true }).click()
    const viewer = page.getByRole('dialog', {
      name: `${opponent.name} · ${opponent.title}`,
      exact: true,
    })
    await expect(viewer.locator('.opponent-deck-entry')).toHaveCount(opponent.deck.length)
    await expect(viewer.locator('.full-card')).toHaveAttribute(
      'data-card-key',
      catalog.leaders.find((l) => l.id === opponent.leader)!.key,
    )
    await viewer.getByRole('button', { name: 'К выбору соперника', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Выбрать соперника · 12', exact: true }).click()
  await roster.getByRole('button', { name: 'Йеннифэр', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: /^Испытания · 12 соперников/ }).click()
  await expect(selected).toContainText('Йеннифэр')
  await expect(page.getByLabel('Колода соперника', { exact: true })).toHaveValue('opponent')
  await expect
    .poll(() =>
      selected
        .locator('.opponent-character-portrait')
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0)
  await page.setViewportSize({ width: 1180, height: 820 })
  await page.screenshot({ path: test.info().outputPath('selected-opponent.png'), fullPage: true })
  expect(faults).toEqual([])
})

test('character match: fixed Cerys identity, portrait, reload and same-room rematch', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: /^Испытания · 12 соперников/ }).click()
  await page.getByRole('button', { name: 'Выбрать соперника · 12', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Соперники', exact: true })
    .getByRole('button', { name: 'Керис', exact: true })
    .click()
  await page.getByRole('button', { name: 'Сложная', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Минут на ход', exact: true }).fill('0')
  await page.getByRole('button', { name: 'Начать партию', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Подготовьте стартовую руку' })).toBeVisible()
  const first = await state(page)
  expect(first.bot).toMatchObject({
    opponent: 'cerys',
    deckMode: 'opponent',
    difficulty: 'hard',
    faction: 'skellige',
  })
  expect(first.players[1].name).toBe('Керис')
  expect(first.players[1].handCount + first.players[1].deckCount).toBe(27)
  expect(first.players[1].hand).toBeUndefined()
  await page.getByRole('button', { name: 'Готово · начать партию', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Спасовать', exact: true })).toBeEnabled()
  await page.reload()
  await expect(
    page.getByRole('region', { name: 'Состояние соперника' }).locator('.character-avatar'),
  ).toHaveAttribute('src', '/img/sm/skellige_cerys.jpg')
  await page.screenshot({ path: test.info().outputPath('character-on-board.png') })
  let current = await state(page)
  for (let n = 0; n < 4; n++) {
    if (current.status === 'finished') break
    const moved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/rooms/${first.code}/actions`) &&
        response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: 'Спасовать', exact: true }).click()
    const response = await moved
    expect(response.ok()).toBeTruthy()
    const next = (await response.json()) as Room
    expect(next.version).toBeGreaterThan(current.version)
    current = next
  }
  await page.getByRole('button', { name: 'Реванш', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Подготовьте стартовую руку' })).toBeVisible()
  const again = await state(page)
  expect(again.code).toBe(first.code)
  expect(again.bot).toEqual(first.bot)
  expect(again.players[1].leaderId).toBe(first.players[1].leaderId)
  expect(again.players[1].name).toBe('Керис')
  expect(again.players[1].handCount + again.players[1].deckCount).toBe(27)
})
