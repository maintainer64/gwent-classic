import { expect, test } from '@playwright/test'
import type { Catalog, Player, Room } from '../../src/domain/types'

for (const result of ['win', 'lose', 'draw'] as const) {
  test(`result ${result}: original emblem, large scores, correct seat and tablet layout`, async ({
    page,
  }) => {
    const catalog = (await (await page.request.get('/api/catalog')).json()) as Catalog
    const player = (name: string, faction: Player['faction'], wins: number): Player => {
      const leader = catalog.leaders.find((l) => l.faction === faction)!
      return {
        name,
        faction,
        wins,
        lives: 0,
        handCount: 0,
        deckCount: 4,
        rows: { close: [], ranged: [], siege: [] },
        special: { close: [], ranged: [], siege: [] },
        grave: [],
        passed: true,
        score: 0,
        leader: leader.name,
        leaderRu: leader.nameRu,
        leaderId: leader.id,
        leaderDescription: leader.description,
        leaderPassive: leader.passive,
        leaderUsed: true,
        ready: true,
        redraws: 0,
      }
    }
    // The local player is seat 1: the table must show their scoreB first.
    const winner = result === 'draw' ? -1 : result === 'win' ? 1 : 0
    const room: Room = {
      code: 'RESULTABCDEF',
      mode: 'pvp',
      status: 'finished',
      phase: 'turn',
      version: 9,
      players: [
        player('Соперник', 'nilfgaard', winner === 0 ? 2 : 1),
        player('Игрок с длинным именем', 'skellige', winner === 1 ? 2 : 1),
      ],
      weather: [],
      round: 3,
      seat: 1,
      turn: 0,
      initiative: 0,
      winner,
      serverTime: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      events: [],
      eventSeq: 0,
      roundHistory: [
        { scoreA: 34, scoreB: 79, winner: 1 },
        { scoreA: 102, scoreB: 46, winner: 0 },
        { scoreA: winner === 1 ? 62 : 88, scoreB: winner === 0 ? 62 : 88, winner },
      ],
    }
    const faults: string[] = []
    page.on('pageerror', (e) => faults.push(e.message))
    await page.route(`**/api/rooms/${room.code}`, (route) => route.fulfill({ json: room }))
    await page.routeWebSocket(`**/api/rooms/${room.code}/ws`, (ws) => ws.send(JSON.stringify(room)))
    await page.goto(`/room/${room.code}`)
    const screen = page.locator('.match-result')
    await expect(screen).toBeVisible()
    await screen.click({ position: { x: 4, y: 4 } })
    await expect(screen).toBeVisible()
    await expect(screen.locator('.result-emblem h2')).toHaveText(
      result === 'win' ? 'Победа' : result === 'lose' ? 'Поражение' : 'Ничья',
    )
    await expect(screen.locator('.result-emblem img')).toHaveAttribute(
      'src',
      `/img/icons/end_${result}.png`,
    )
    await expect(screen.locator('tbody tr').first()).toHaveAttribute('data-result-seat', '1')
    await expect(screen.locator('[data-result-seat="1"] [data-round="1"]')).toHaveText('79')
    await expect(screen.locator('[data-result-seat="0"] [data-round="2"]')).toHaveText('102')
    await expect(screen.locator('[data-result-seat="1"] [data-round="1"]')).toHaveClass('winner')
    for (const size of [
      { width: 1366, height: 768 },
      { width: 1180, height: 820 },
      { width: 820, height: 1180 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(size)
      await expect(screen.locator('.result-emblem')).toBeInViewport({ ratio: 0.99 })
      await expect(screen.locator('.results-table')).toBeInViewport({ ratio: 0.99 })
      await expect(
        screen.getByRole('button', { name: 'Новая партия', exact: true }),
      ).toBeInViewport({ ratio: 0.99 })
      await expect(
        screen.getByRole('button', { name: 'В главное меню', exact: true }),
      ).toBeInViewport({ ratio: 0.99 })
      expect(await screen.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBeTruthy()
      await page.screenshot({ path: test.info().outputPath(`result-${result}-${size.width}.png`) })
    }
    const broken = await screen
      .locator('img')
      .evaluateAll((images) =>
        images.filter((img) => !img.complete || !img.naturalWidth).map((img) => img.src),
      )
    expect(broken).toEqual([])
    if (result === 'win') {
      await screen.getByRole('button', { name: 'Новая партия', exact: true }).click()
      await expect(
        page.getByRole('spinbutton', { name: 'Минут на ход', exact: true }),
      ).toBeVisible()
    } else {
      await screen.getByRole('button', { name: 'В главное меню', exact: true }).click()
      await expect(page.getByRole('button', { name: /^Сыграть с ботом/ })).toBeVisible()
    }
    expect(faults).toEqual([])
  })
}
