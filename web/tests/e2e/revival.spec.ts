import { mockMatchBootstrap } from './bootstrap'
import { expect, test } from '@playwright/test'
import type { BattleRow, Catalog, GameCard, Move, Player, Room } from '../../src/domain/types'

// Controlled snapshots make rare UI choices deterministic. Real Go validation
// and card-zone changes are independently tested in revival_test.go.
for (const chained of [false, true]) {
  test(`agile Medic destination: ${chained ? 'chained' : 'initial'} revival`, async ({ page }) => {
    const catalog = await mockMatchBootstrap(page)
    const card = (uid: string, predicate: (c: Catalog['cards'][number]) => boolean): GameCard => {
      const definition = catalog.cards.find(predicate)!
      return { ...definition, def: definition.id, uid, special: false }
    }
    const medic = card('medic', (c) => c.ability.split(' ').includes('medic') && c.row !== 'agile')
    const agile = card('agile', (c) => c.row === 'agile' && !c.ability.includes('hero'))
    const spare = card('spare', (c) => c.row === 'close' && !c.ability)
    const discarded = card('discarded', (c) => c.row === 'close' && !c.ability)
    const hero = card('hero', (c) => c.ability.split(' ').includes('hero'))
    const player = (name: string): Player => ({
      name,
      faction: 'realms',
      hand: [],
      handCount: 1,
      deckCount: 0,
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
    own.hand = chained ? [spare] : [medic, spare]
    own.handCount = own.hand.length
    own.grave = [discarded, agile, hero]
    if (chained) own.rows[medic.row as BattleRow] = [medic]
    const now = Date.now()
    let room: Room = {
      code: 'MEDICABCDEFG',
      mode: 'pvp',
      phase: 'turn',
      version: 10,
      status: 'playing',
      players: [own, opponent],
      weather: [],
      round: 1,
      seat: 0,
      turn: 0,
      initiative: 0,
      pendingOwner: chained ? 1 : 0,
      serverTime: new Date(now).toISOString(),
      turnDeadline: new Date(now + 60000).toISOString(),
      expiresAt: new Date(now + 86400000).toISOString(),
      winner: -1,
      events: [],
      eventSeq: 0,
    }
    const submitted: Move[] = [],
      faults: string[] = []
    page.on('pageerror', (error) => faults.push(error.message))
    await page.route(`**/api/rooms/${room.code}`, (route) => route.fulfill({ json: room }))
    await page.routeWebSocket(`**/api/rooms/${room.code}/ws`, (ws) => ws.send(JSON.stringify(room)))
    await page.route(`**/api/rooms/${room.code}/actions`, async (route) => {
      const body = route.request().postDataJSON() as { action: Move; expectedVersion: number }
      expect(body.expectedVersion).toBe(room.version)
      submitted.push(body.action)
      own.rows[medic.row as BattleRow] = [medic]
      own.rows.ranged.push(agile)
      own.grave = [discarded, hero]
      own.hand = [spare]
      own.handCount = 1
      room = { ...room, version: room.version + 1, turn: 1, pendingOwner: 0 }
      await route.fulfill({ json: room })
    })
    await page.goto(`/room/${room.code}`)
    if (!chained) {
      await expect(page.locator('.connection')).toHaveText('В сети')
      await page.locator('[data-zone=hand][data-card-uid=medic]').click()
      const rows = { close: 'Ближний бой', ranged: 'Дальний бой', siege: 'Осада' }
      await page
        .getByRole('button', { name: `Сыграть: ${rows[medic.row as BattleRow]}`, exact: true })
        .click()
    }
    const grave = page.getByRole('dialog', {
      name: chained ? 'Цепочка медиков' : 'Медик · выберите отряд из сброса',
    })
    await expect(grave.locator('.hand-gallery-card')).toHaveCount(2)
    await expect(page.locator('.selected-card-preview')).toHaveCount(0)
    if (chained) {
      await page.keyboard.press('Escape')
      await expect(grave).toBeVisible()
    }
    await grave.getByRole('button', { name: agile.nameRu, exact: true }).click()
    await expect(grave.locator('.hand-gallery-card[aria-pressed=true]')).toHaveAttribute(
      'data-card-uid',
      'agile',
    )
    await expect(grave.getByLabel('Описание выбранной карты')).toContainText(agile.description)
    expect(submitted).toHaveLength(0)
    for (const size of [
      { width: 1366, height: 768 },
      { width: 1180, height: 820 },
    ]) {
      await page.setViewportSize(size)
      await expect(grave.locator('.hand-gallery-card[aria-pressed=true]')).toBeInViewport()
      await page.screenshot({ path: test.info().outputPath(`medic-gallery-${size.width}.png`) })
    }
    await grave.getByRole('button', { name: 'Возродить отряд', exact: true }).click()
    const destination = page.getByRole('dialog', { name: 'Выберите ряд для возрождения' })
    await expect(destination).toContainText(agile.nameRu)
    expect(submitted).toHaveLength(0)
    await destination.getByRole('button', { name: 'Дальний бой', exact: true }).click()
    await expect.poll(() => submitted.length).toBe(1)
    expect(submitted[0]).toMatchObject({
      type: chained ? 'revive' : 'play',
      target: agile.uid,
      targetRow: 'ranged',
    })
    if (!chained) expect(submitted[0]).toMatchObject({ uid: medic.uid, row: medic.row })
    await expect(
      page.locator('[data-seat="0"][data-row=ranged] [data-card-uid=agile]'),
    ).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(faults).toEqual([])
  })
}
