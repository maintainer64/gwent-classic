import { mockMatchBootstrap } from './bootstrap'
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test'
import type { BoardFrame, GameCard, Player, Room } from '../../src/domain/types'

async function fixture(page: Page, initialWeather = '') {
  const catalog = await mockMatchBootstrap(page)
  const card = (uid: string, key: string): GameCard => {
    const d = catalog.cards.find((c) => c.key === key)!
    return {
      ...d,
      basePower: d.power,
      def: d.id,
      uid,
      special: ['weather', 'special'].includes(d.faction),
    }
  }
  const ordinary = (row: string) =>
    catalog.cards.find((c) => c.row === row && c.power > 3 && !c.ability)!
  const player = (name: string): Player => ({
    name,
    faction: 'realms',
    handCount: 2,
    deckCount: 4,
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
    op = player('Соперник')
  for (const [seat, p] of [own, op].entries())
    for (const row of ['close', 'ranged', 'siege'] as const)
      p.rows[row] = [card(`${seat}-${row}`, ordinary(row).key)]
  own.rows.close[0].power = own.rows.close[0].basePower! * 2
  own.rows.ranged.push(
    card('hero', catalog.cards.find((c) => c.ability.includes('hero') && c.row === 'ranged')!.key),
  )
  const fog = card('fog', 'weather.fog'),
    clear = card('clear', 'weather.clear')
  own.hand = [fog, card('spare', ordinary('close').key)]
  own.deckChoices = []
  const now = Date.now()
  let room: Room = {
    code: 'WEATHERABCDE',
    gameNumber: 1,
    version: 1,
    mode: 'pvp',
    status: 'playing',
    phase: 'turn',
    players: [own, op],
    seat: 0,
    turn: 0,
    initiative: 0,
    round: 1,
    winner: -1,
    weather: initialWeather ? [initialWeather] : [],
    weatherCards: initialWeather ? [card('initial-weather', `weather.${initialWeather}`)] : [],
    timer: { minutes: 0, mode: 'soft' },
    serverTime: new Date(now).toISOString(),
    expiresAt: new Date(now + 86400000).toISOString(),
    events: [],
    eventSeq: 0,
  }
  let socket: WebSocketRoute
  await page.route(`**/api/rooms/${room.code}`, (route) => route.fulfill({ json: room }))
  // Deliberately withhold the first WS snapshot until an HTTP move is already
  // animating. It must not erase that move's intermediate weather frames.
  await page.routeWebSocket(`**/api/rooms/${room.code}/ws`, (ws) => {
    socket = ws
  })
  const frame = (weather: string, physical: GameCard[]): BoardFrame => {
    const players = structuredClone([own, op])
    for (const p of players) {
      delete p.hand
      delete p.deckChoices
      for (const row of ['close', 'ranged', 'siege'] as const)
        for (const c of p.rows[row]) {
          const affected =
            (weather === 'frost' && row === 'close') ||
            (weather === 'fog' && row === 'ranged') ||
            (weather === 'rain' && row === 'siege') ||
            (weather === 'storm' && row !== 'close')
          if (affected && !c.ability.includes('hero')) c.power = 1
        }
      p.score = Object.values(p.rows)
        .flat()
        .reduce((n, c) => n + c.power, 0)
    }
    return {
      players,
      weather: weather ? [weather] : [],
      weatherCards: physical,
      round: 1,
      status: 'playing',
    }
  }
  await page.route(`**/api/rooms/${room.code}/actions`, async (route) => {
    expect(route.request().postDataJSON().action).toMatchObject({ type: 'play', uid: 'fog' })
    const dry = frame('', []),
      wet = frame('fog', [fog])
    own.hand = own.hand?.filter((c) => c.uid !== fog.uid)
    own.handCount = own.hand?.length ?? 0
    room = {
      ...room,
      version: 2,
      eventSeq: 6,
      transitions: [
        { id: 1, type: 'played', actor: 0, card: fog, frame: dry },
        { id: 2, type: 'weather', actor: 0, card: fog, frame: wet },
        { id: 3, type: 'resolved', actor: 0, card: fog, frame: wet },
        { id: 4, type: 'played', actor: 1, card: clear, frame: wet },
        { id: 5, type: 'weather', actor: 1, card: clear, frame: dry },
        { id: 6, type: 'resolved', actor: 1, card: clear, frame: dry },
      ],
    }
    await route.fulfill({ json: room })
    await new Promise((resolve) => setTimeout(resolve, 130))
    socket.send(JSON.stringify(room))
  })
  if (initialWeather) {
    const initial = frame(initialWeather, room.weatherCards ?? [])
    room = {
      ...room,
      ...initial,
      players: initial.players.map((p, i) => ({
        ...p,
        hand: i === 0 ? own.hand : undefined,
        deckChoices: i === 0 ? [] : undefined,
      })),
    }
  }
  await page.goto(`/room/${room.code}`)
  await expect(page.locator('.connection')).toHaveText('В сети')
  return {
    catalog,
    own,
    room,
    fog,
    card,
    update: (patch: Partial<Room>) => {
      room = { ...room, ...patch, version: room.version + 1 }
      socket.send(JSON.stringify(room))
    },
  }
}

test('weather queue: fog is fully shown before opponent clears it, even on first WS sync', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const { own } = await fixture(page)
  const target = page.locator('[data-zone=board][data-card-uid="0-ranged"] .card-strength b')
  await expect(page.getByRole('button', { name: 'Сыграть погоду', exact: true })).toHaveCount(0)
  await page.locator('[data-zone=hand][data-card-uid=fog]').click()
  await expect(page.locator('.weather-well')).toHaveClass(/legal/)
  await expect(page.locator('.board-selection')).toContainText('Нажмите область погодных эффектов')
  await page.getByRole('button', { name: 'Сыграть погоду', exact: true }).click()
  await expect(page.locator('.row-weather-fog')).toHaveCount(2)
  await expect(target).toHaveText('1')
  await expect(target).toHaveAttribute('data-power-state', 'reduced')
  await expect(page.locator('[data-zone=weather]')).toHaveCount(1)
  await expect(page.locator('.weather-resolution strong')).toHaveText('Мгла')
  await expect(page.locator('.row-weather-fog').first()).toHaveCSS('opacity', '1')
  await expect(
    page.locator('[data-card-uid=hero][data-zone=board] .card-strength b'),
  ).toHaveAttribute('data-power-state', 'normal')
  await expect(
    page.locator('[data-card-uid="0-close"][data-zone=board] .card-strength b'),
  ).toHaveAttribute('data-power-state', 'boosted')
  await page.screenshot({ path: test.info().outputPath('fog-before-clear.png') })
  await expect(page.locator('.weather-resolution strong')).toHaveText('Ясная погода')
  await expect(target).toHaveText(String(own.rows.ranged[0].basePower))
  await expect(target).toHaveAttribute('data-power-state', 'normal')
  await expect(page.locator('[data-zone=weather-clearing]')).toHaveCount(1)
  await expect(page.locator('.row-weather')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Спасовать', exact: true })).toBeEnabled()
  await page.reload()
  await expect(page.locator('.row-weather')).toHaveCount(0)
  await expect(page.locator('.weather-resolution')).toHaveCount(0)
})

test.describe('weather area on a tablet', () => {
  test.use({ hasTouch: true })

  test('clear weather can be tapped over existing cards only on your turn', async ({ page }) => {
    const { own, room, card, update } = await fixture(page, 'fog')
    const clear = card('clear-hand', 'weather.clear')
    own.hand = [clear, own.hand![1]]
    const submitted: unknown[] = []
    await page.route(`**/api/rooms/${room.code}/actions`, async (route) => {
      submitted.push(route.request().postDataJSON().action)
      await route.fulfill({
        json: {
          ...room,
          version: 4,
          players: [
            { ...own, hand: own.hand!.filter((c) => c.uid !== clear.uid) },
            room.players[1],
          ],
          weather: [],
          weatherCards: [],
        },
      })
    })
    update({ players: [own, room.players[1]], turn: 1 })
    await page.locator('[data-zone=hand][data-card-uid=clear-hand]').tap()
    await expect(page.getByRole('button', { name: 'Сыграть погоду', exact: true })).toHaveCount(0)
    await expect(page.locator('.weather-well')).not.toHaveClass(/legal/)
    update({ turn: 0 })
    await page.locator('[data-zone=hand][data-card-uid=spare]').tap()
    await expect(page.getByRole('button', { name: 'Сыграть погоду', exact: true })).toHaveCount(0)
    await page.locator('[data-zone=hand][data-card-uid=clear-hand]').tap()
    await expect(page.locator('.weather-well [data-zone=weather]')).toHaveCount(1)
    await expect(page.locator('.weather-well')).toHaveClass(/legal/)
    await page.screenshot({ path: test.info().outputPath('weather-area-selected.png') })
    await page.getByRole('button', { name: 'Сыграть погоду', exact: true }).tap()
    await expect.poll(() => submitted.length).toBe(1)
    expect(submitted[0]).toEqual({ type: 'play', uid: clear.uid })
    await expect(page.locator('.weather-well [data-zone=weather]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Сыграть погоду', exact: true })).toHaveCount(0)
  })
})

for (const weather of ['frost', 'fog', 'rain', 'storm'])
  test(`weather ${weather}: visible animated effects on both sides`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await fixture(page, weather)
    const effects = page.locator(`.row-weather-${weather}`)
    await expect(effects).toHaveCount(weather === 'storm' ? 4 : 2)
    const mist = weather === 'fog'
    const particle = effects
      .first()
      .locator(mist ? '.weather-mist-layer' : '.weather-particle')
      .first()
    const transform = await particle.evaluate((el) => getComputedStyle(el).transform)
    await expect
      .poll(() => particle.evaluate((el) => getComputedStyle(el).transform))
      .not.toBe(transform)
    const sprite = await particle.evaluate(async (el, mist) => {
      const url = getComputedStyle(el, mist ? null : '::before').backgroundImage.match(
        /url\("?([^"\)]+)"?\)/,
      )![1]
      const image = new Image()
      image.src = url
      await image.decode()
      return { url, width: image.naturalWidth }
    }, mist)
    expect(sprite.url).toContain(
      `/img/weather/${mist ? 'fog-wisp' : weather === 'frost' ? 'snow-flake' : 'rain-drop'}.png`,
    )
    expect(sprite.width).toBe(512)
    if (mist || weather === 'storm') {
      await expect(effects.first().locator('.weather-mist-layer')).toHaveCount(3)
      const layers = await effects
        .first()
        .locator('.weather-mist-layer')
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).animationDuration))
      expect(new Set(layers).size).toBe(3)
    }
    await page.setViewportSize({ width: 1180, height: 820 })
    await page.screenshot({ path: test.info().outputPath(`weather-${weather}.png`) })
    await effects.first().screenshot({ path: test.info().outputPath(`weather-${weather}-row.png`) })
    if (weather === 'rain') {
      await page.setViewportSize({ width: 768, height: 1024 })
      await page.screenshot({ path: test.info().outputPath('weather-rain-tablet.png') })
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    if (mist) {
      await expect(particle).toHaveCSS('animation-name', 'none')
      await expect(particle).toBeVisible()
    } else await expect(particle).toBeHidden()
    await expect(effects.first().locator('.weather-texture')).toBeVisible()
  })

test('weather leader: unavailable fog is explained instead of silently spending the ability', async ({
  page,
}) => {
  const { catalog, own, card, update, room } = await fixture(page)
  const leader = catalog.leaders.find((l) => l.ability === 'foltest_king')!
  own.leaderId = leader.id
  own.leaderUsed = false
  own.leader = leader.name
  own.leaderRu = leader.nameRu
  update({
    players: [own, room.players[1]],
  })
  await page.getByRole('region', { name: 'Ваше состояние' }).locator('.leader-mini').click()
  const preview = page.getByRole('dialog', { name: leader.nameRu, exact: true })
  await expect(preview.locator('.hand-instruction')).toContainText(
    'В оставшейся колоде нет карты «Мгла»',
  )
  await expect(
    preview.getByRole('button', { name: 'Нет карты в колоде', exact: true }),
  ).toBeDisabled()
  await preview.getByRole('button', { name: 'Закрыть', exact: true }).click()
  own.deckChoices = [card('deck-fog', 'weather.fog')]
  update({
    players: [own, room.players[1]],
  })
  await page.getByRole('region', { name: 'Ваше состояние' }).locator('.leader-mini').click()
  await expect(
    preview.getByRole('button', { name: 'Применить способность', exact: true }),
  ).toBeEnabled()
})

test('weather leader: weather with an empty catalog row remains selectable from the deck', async ({
  page,
}) => {
  const { catalog, own, card, update, room } = await fixture(page)
  const leader = catalog.leaders.find((l) => l.ability === 'eredin_king')!
  own.faction = 'monsters'
  own.leaderId = leader.id
  own.leaderUsed = false
  own.leader = leader.name
  own.leaderRu = leader.nameRu
  own.deckChoices = [
    card('deck-fog', 'weather.fog'),
    card('deck-rain', 'weather.rain'),
    own.rows.close[0],
  ]
  const submitted: unknown[] = []
  await page.route(`**/api/rooms/${room.code}/actions`, async (route) => {
    submitted.push(route.request().postDataJSON().action)
    await route.fulfill({ json: { ...room, players: [own, room.players[1]], version: 3 } })
  })
  update({ players: [own, room.players[1]] })
  await page.getByRole('region', { name: 'Ваше состояние' }).locator('.leader-mini').click()
  await page.getByRole('button', { name: 'Применить способность', exact: true }).click()
  const choice = page.getByRole('dialog', { name: 'Выберите погоду из колоды', exact: true })
  await expect(choice.locator('.hand-gallery-card')).toHaveCount(2)
  await choice.locator('[data-card-uid=deck-rain]').click()
  await choice.getByRole('button', { name: 'Сыграть погоду', exact: true }).click()
  await expect.poll(() => submitted.length).toBe(1)
  expect(submitted[0]).toEqual({ type: 'leader', target: 'deck-rain' })
})
