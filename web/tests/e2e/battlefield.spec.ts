import { mockMatchBootstrap } from './bootstrap'
import { expect, test } from '@playwright/test'
import type { BattleRow, GameCard, Player, Room } from '../../src/domain/types'

test('reference board: full rows, original art and proportions at desktop and tablet sizes', async ({
  page,
}) => {
  const catalog = await mockMatchBootstrap(page)
  let serial = 0
  const card = (key: string, power?: number): GameCard => {
    const c = catalog.cards.find((c) => c.key === key)!
    expect(c, key).toBeTruthy()
    return {
      ...c,
      def: c.id,
      uid: `view-${serial++}`,
      power: power ?? c.power,
      special: ['special', 'weather'].includes(c.faction),
    }
  }
  const makePlayer = (name: string, faction: Player['faction']): Player => {
    const leader = catalog.leaders.find((l) => l.faction === faction)!
    return {
      name,
      faction,
      handCount: 0,
      deckCount: 7,
      score: 0,
      rows: { close: [], ranged: [], siege: [] },
      special: { close: [], ranged: [], siege: [] },
      grave: [],
      passed: false,
      wins: 0,
      lives: 1,
      leader: leader.name,
      leaderId: leader.id,
      leaderRu: leader.nameRu,
      leaderDescription: leader.description,
      leaderPassive: leader.passive,
      leaderUsed: false,
      ready: true,
      redraws: 0,
    }
  }
  const own = makePlayer('Игрок', 'nilfgaard'),
    opponent = makePlayer('Соперник', 'skellige')
  const units = catalog.cards.filter(
    (c) => ['close', 'ranged', 'siege'].includes(c.row) && c.faction === 'nilfgaard',
  )
  own.rows.close = units.slice(0, 10).map((c) => card(c.key))
  own.rows.ranged = units.slice(10, 14).map((c) => card(c.key))
  own.rows.siege = units.slice(14, 15).map((c) => card(c.key))
  own.special.close = [card('special.horn')]
  own.hand = [card('weather.clear'), ...units.slice(0, 9).map((c) => card(c.key))]
  own.handCount = own.hand.length
  own.grave = [card('neutral.vesemir')]
  own.deckChoices = []
  opponent.rows.close = [
    card('special.decoy'),
    card('neutral.mysterious_elf'),
    card('neutral.ciri'),
    card('neutral.geralt'),
    ...units.slice(2, 8).map((c) => card(c.key)),
  ]
  opponent.rows.ranged = units.slice(8, 14).map((c) => card(c.key))
  opponent.grave = [card('neutral.zoltan')]
  opponent.passed = true
  for (const player of [own, opponent])
    player.score = Object.values(player.rows)
      .flat()
      .reduce((n, c) => n + c.power, 0)
  const now = Date.now()
  const room: Room = {
    code: 'VIEWABCDEFGH',
    mode: 'pvp',
    phase: 'turn',
    version: 1,
    status: 'playing',
    players: [own, opponent],
    weather: [],
    round: 2,
    seat: 0,
    turn: 0,
    initiative: 0,
    winner: -1,
    serverTime: new Date(now).toISOString(),
    turnDeadline: new Date(now + 60000).toISOString(),
    expiresAt: new Date(now + 86400000).toISOString(),
    events: [],
    eventSeq: 0,
  }
  const faults: string[] = []
  page.on('pageerror', (e) => faults.push(e.message))
  await page.route(`**/api/rooms/${room.code}`, (route) => route.fulfill({ json: room }))
  await page.routeWebSocket(`**/api/rooms/${room.code}/ws`, (ws) => ws.send(JSON.stringify(room)))
  await page.goto(`/room/${room.code}`)
  await expect(page.locator('.gc-board')).toBeVisible()
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1180, height: 820 },
    { width: 820, height: 1180 },
  ]) {
    await page.setViewportSize(size)
    await expect(page.locator('.app-header')).toBeHidden()
    const board = await page.locator('.gc-board').boundingBox(),
      table = await page.locator('.table').boundingBox()
    expect(board).toBeTruthy()
    expect(table).toBeTruthy()
    expect(board!.x).toBeGreaterThanOrEqual(-1)
    expect(board!.y + board!.height).toBeLessThanOrEqual(size.height + 1)
    expect(board!.width / board!.height).toBeCloseTo(16 / 9, 1)
    const ownRows = []
    for (const row of ['close', 'ranged', 'siege'] as BattleRow[]) {
      const bounds = await page.locator(`[data-seat="0"][data-row=${row}]`).boundingBox()
      ownRows.push(bounds!)
    }
    expect(ownRows[0].y).toBeLessThan(ownRows[1].y)
    expect(ownRows[1].y).toBeLessThan(ownRows[2].y)
    const hand = await page.locator('.hand').boundingBox()
    expect(hand!.y).toBeGreaterThan(ownRows[2].y)
    const grave = await page.locator('.card-piles.is-self .grave-pile').boundingBox()
    expect(grave!.x).toBeGreaterThan(table!.x + table!.width)
    const portrait = await page.locator('.player-panel.is-self .leader-mini').boundingBox()
    expect(portrait!.x + portrait!.width).toBeLessThan(table!.x)
    const unit = await page.locator('[data-zone=hand]').first().boundingBox()
    expect(unit!.width / unit!.height).toBeGreaterThan(0.64)
    expect(unit!.width / unit!.height).toBeLessThan(0.75)
    const toolbar = await page.locator('.match-heading').boundingBox()
    const status = await page.locator('.match-status').boundingBox()
    expect(toolbar!.height).toBe(48)
    expect(status!.y).toBeGreaterThanOrEqual(toolbar!.y)
    expect(status!.y + status!.height).toBeLessThanOrEqual(toolbar!.y + toolbar!.height)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBeTruthy()
    await page.screenshot({
      path: test.info().outputPath(`reference-board-${size.width}.png`),
      fullPage: true,
    })
  }
  const broken = await page
    .locator('.gc-board img')
    .evaluateAll((images) =>
      images
        .filter(
          (image) =>
            !(image as HTMLImageElement).complete || !(image as HTMLImageElement).naturalWidth,
        )
        .map((image) => (image as HTMLImageElement).src),
    )
  expect(broken).toEqual([])
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.locator('[data-zone=hand]').nth(5).click({ button: 'right' })
  const preview = page.getByRole('dialog', { name: 'Карты в руке' })
  await expect(preview).toBeVisible()
  for (const size of [
    { width: 1366, height: 768 },
    { width: 1180, height: 820 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size)
    const active = preview.locator('[data-zone=preview][aria-pressed=true]')
    await expect(active).toBeInViewport()
    await expect(preview.getByRole('button', { name: 'Выбрать карту' })).toBeInViewport()
    await expect
      .poll(async () => {
        const centered = await active.boundingBox()
        return Math.abs(centered!.x + centered!.width / 2 - size.width / 2)
      })
      .toBeLessThan(1)
    const tops = await preview
      .locator('.hand-gallery-card')
      .evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().top))
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBeTruthy()
    await page.screenshot({
      path: test.info().outputPath(`hand-${size.width}.png`),
      fullPage: true,
    })
  }
  await preview.getByRole('button', { name: 'Выбрать карту' }).click()
  await expect(preview).toHaveCount(0)
  for (const size of [
    { width: 1366, height: 768 },
    { width: 1180, height: 820 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size)
    const selected = page.getByRole('complementary', { name: 'Выбранная карта' })
    await expect(selected.locator('.full-card')).toBeInViewport({ ratio: 0.95 })
    await expect(selected.getByLabel('Описание выбранной карты')).toBeInViewport({ ratio: 0.95 })
    const bounds = await selected.locator('.full-card').boundingBox()
    expect(bounds!.x + bounds!.width / 2).toBeGreaterThan(size.width * 0.7)
    await expect(page.locator('.battle-row.legal')).toHaveCount(1)
    await page.screenshot({
      path: test.info().outputPath(`selected-${size.width}.png`),
      fullPage: true,
    })
  }
  await page.getByRole('button', { name: 'Отменить выбор' }).click()
  await expect(page.getByRole('complementary', { name: 'Выбранная карта' })).toHaveCount(0)
  expect(faults).toEqual([])
})
