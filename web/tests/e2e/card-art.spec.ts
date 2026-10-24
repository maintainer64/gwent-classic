import { mockMatchBootstrap } from './bootstrap'
import { expect, test } from '@playwright/test'

test('composed cards: RU/EN text, original SM artwork, leaders and persistent language', async ({
  page,
}) => {
  const catalog = await mockMatchBootstrap(page)
  for (const card of [...catalog.cards, ...catalog.leaders]) {
    expect(card.descriptionEn, card.key).toBeTruthy()
    expect(card.description, card.key).toBeTruthy()
    expect(card.image, card.key).toMatch(/^\/img\/sm\//)
    expect(card).not.toHaveProperty('imageLarge')
  }
  const lgRequests: string[] = []
  const faults: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/img/lg/')) lgRequests.push(r.url())
  })
  page.on('pageerror', (e) => faults.push(e.message))
  await page.setViewportSize({ width: 820, height: 1180 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Колоды', exact: true }).click()
  await page.getByRole('textbox', { name: 'Поиск карт' }).fill('Геральт')
  await page.locator('.collection-grid .game-card').first().click()
  const ru = page.getByRole('dialog', { name: 'Геральт из Ривии', exact: true })
  await expect(ru.locator('.full-card')).toHaveAttribute('lang', 'ru')
  await expect(ru.locator('.full-card-copy')).toContainText('Не подвержен погоде')
  const art = await ru.locator('.full-card-art img').getAttribute('src')
  await page.screenshot({ path: test.info().outputPath('full-card-ru.png') })
  await ru
    .getByRole('group', { name: 'Язык карт' })
    .getByRole('button', { name: 'EN', exact: true })
    .click()
  const en = page.getByRole('dialog', { name: 'Geralt of Rivia', exact: true })
  await expect(en.locator('.full-card-copy')).toContainText('Unaffected by weather')
  await expect(en.locator('.full-card')).toHaveAttribute('lang', 'en')
  expect(await en.locator('.full-card-art img').getAttribute('src')).toBe(art)
  await page.screenshot({ path: test.info().outputPath('full-card-en.png') })
  await en.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Колоды', exact: true }).click()
  await page.locator('.leader-choice').click()
  const leader = catalog.leaders.find((l) => l.faction === 'realms')!
  const leaders = page.getByRole('dialog', { name: 'Выберите лидера' })
  await expect(leaders).toContainText(leader.descriptionEn)
  await leaders.getByRole('button', { name: leader.name, exact: true }).click()
  await expect(page.locator('.deck-summary .full-card')).toContainText(leader.name)
  await page.getByRole('button', { name: 'Играть', exact: true }).click()
  await page.getByRole('button', { name: /^Сыграть с ботом/ }).click()
  await page.getByRole('button', { name: 'Начать партию', exact: true }).click()
  await page.getByRole('button', { name: 'Готово · начать партию', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Спасовать', exact: true })).toBeEnabled()
  await page.locator('[data-zone=hand]').nth(4).click({ button: 'right' })
  const hand = page.getByRole('dialog', { name: 'Карты в руке' })
  const selectedName = await hand
    .locator('[data-zone=preview][aria-pressed=true]')
    .getAttribute('aria-label')
  const selected = catalog.cards.find((c) => c.name === selectedName)!
  await expect(page.getByLabel('Описание выбранной карты')).toContainText(selected.descriptionEn)
  await hand
    .getByRole('group', { name: 'Язык карт' })
    .getByRole('button', { name: 'RU', exact: true })
    .click()
  await expect(page.getByLabel('Описание выбранной карты')).toContainText(selected.description)
  await expect(hand.locator('[data-zone=preview][aria-pressed=true]')).toHaveAttribute(
    'aria-label',
    selected.nameRu,
  )
  await expect(hand.locator('[data-zone=preview][aria-pressed=true]')).toBeInViewport()
  await page.keyboard.press('Escape')
  await page.getByRole('region', { name: 'Ваше состояние' }).locator('.leader-mini').click()
  await expect(page.locator('dialog .full-card')).toContainText(leader.description)
  expect(lgRequests).toEqual([])
  expect(faults).toEqual([])
})
