import { expect, test, type Page } from '@playwright/test'
import type { Room } from '../../src/domain/types'

async function roomState(page: Page): Promise<Room> {
  return (await page.request.get(`/api/rooms/${page.url().split('/room/')[1]}`)).json()
}

test('audio settings: real local music, independent switches and mixer volumes persist', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const observed = window as typeof window & {
      audioGains: GainNode[]
      audioPlays: HTMLMediaElement[]
    }
    observed.audioGains = []
    observed.audioPlays = []
    const gain = AudioContext.prototype.createGain,
      play = HTMLMediaElement.prototype.play
    AudioContext.prototype.createGain = function () {
      const node = gain.call(this)
      observed.audioGains.push(node)
      return node
    }
    HTMLMediaElement.prototype.play = function () {
      observed.audioPlays.push(this)
      return play.call(this)
    }
  })
  const faults: string[] = []
  page.on('pageerror', (e) => faults.push(e.message))
  await page.goto('/')
  await expect(page.locator('[data-background-music]')).toHaveJSProperty('paused', true)
  await page.getByRole('button', { name: 'Настройки', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Настройки', exact: true })
  const music = page.locator('[data-background-music]')
  await expect
    .poll(() =>
      music.evaluate((a: HTMLAudioElement) => ({
        playing: !a.paused,
        advanced: a.currentTime > 0,
        ready: a.readyState >= 2,
        error: a.error?.message,
        hidden: document.hidden,
        context: (window as unknown as { audioGains: GainNode[] }).audioGains[0]?.context.state,
      })),
    )
    .toMatchObject({ playing: true, advanced: true, ready: true })
  await settings.getByRole('slider', { name: 'Громкость музыки' }).press('Home')
  await settings.getByRole('slider', { name: 'Громкость музыки' }).press('PageUp')
  await settings.getByRole('slider', { name: 'Громкость музыки' }).press('PageUp')
  await settings.getByRole('slider', { name: 'Громкость эффектов' }).press('End')
  for (let n = 0; n < 3; n++)
    await settings.getByRole('slider', { name: 'Громкость эффектов' }).press('PageDown')
  await expect(settings.getByRole('slider', { name: 'Громкость музыки' })).toHaveValue('20')
  await expect(settings.getByRole('slider', { name: 'Громкость эффектов' })).toHaveValue('70')
  const levels = await page.evaluate(() =>
    (window as unknown as { audioGains: GainNode[] }).audioGains.map((n) => n.gain.value),
  )
  expect(levels[0]).toBeCloseTo(0.2)
  expect(levels[1]).toBeCloseTo(0.7)
  await settings.getByRole('switch', { name: 'Звуковые эффекты' }).uncheck()
  expect(await music.evaluate((a: HTMLAudioElement) => a.paused)).toBe(false)
  await settings.getByRole('switch', { name: 'Звуковые эффекты' }).check()
  await settings.getByRole('switch', { name: 'Музыка', exact: true }).uncheck()
  expect(await music.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
  await settings.getByRole('button', { name: 'Проверить звуки', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { audioPlays: HTMLMediaElement[] }).audioPlays.some((a) =>
          a.src.endsWith('/sfx/ui_card.mp3'),
        ),
      ),
    )
    .toBeTruthy()
  await page.screenshot({ path: test.info().outputPath('audio-and-timer-settings.png') })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Настройки', exact: true }).click()
  await expect(settings.getByRole('switch', { name: 'Музыка', exact: true })).not.toBeChecked()
  await expect(settings.getByRole('switch', { name: 'Звуковые эффекты' })).toBeChecked()
  await expect(settings.getByRole('slider', { name: 'Громкость музыки' })).toHaveValue('20')
  await expect(settings.getByRole('slider', { name: 'Громкость эффектов' })).toHaveValue('70')
  expect(await music.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true)
  expect(faults).toEqual([])
})

for (const mode of ['soft', 'hard'] as const) {
  test(`timer ${mode}: custom duration, server expiry and settings restore`, async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Настройки', exact: true })
    await settings.getByRole('spinbutton', { name: 'Минут на ход', exact: true }).fill('0.05')
    await settings
      .getByRole('button', { name: mode === 'soft' ? 'Мягкий' : 'Жёсткий', exact: true })
      .click()
    await settings.getByRole('button', { name: 'Закрыть', exact: true }).click()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /^Сыграть с ботом/ }).click()
    await expect(page.getByRole('spinbutton', { name: 'Минут на ход', exact: true })).toHaveValue(
      '0.05',
    )
    await expect(
      page.getByRole('button', { name: mode === 'soft' ? 'Мягкий' : 'Жёсткий', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Начать партию', exact: true }).click()
    await page.getByRole('button', { name: 'Готово · начать партию', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Спасовать', exact: true })).toBeEnabled()
    const before = await roomState(page)
    expect(before.timer).toEqual({ minutes: 0.05, mode })
    expect(Date.parse(before.turnDeadline!) - Date.parse(before.serverTime)).toBeLessThanOrEqual(
      3000,
    )
    if (mode === 'soft') {
      await expect(page.locator('.match-status time')).toHaveText(/^\+00:0/)
      const overdue = await roomState(page)
      expect(overdue.version).toBe(before.version)
      expect(overdue.players[overdue.seat].passed).toBe(false)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.locator('.match-status time')).toHaveText(/^\+00:0/)
      await expect(page.locator('[data-background-music]')).toHaveJSProperty('paused', true)
      await page.getByRole('button', { name: 'Спасовать', exact: true }).click()
      await expect.poll(async () => (await roomState(page)).version).toBeGreaterThan(before.version)
    } else {
      await expect
        .poll(async () => (await roomState(page)).events.some((e) => e.includes('лимит 0.05 мин')))
        .toBeTruthy()
    }
  })
}

test('zero minutes disables the timer; invalid settings cannot start a game', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /^Сыграть с ботом/ }).click()
  await page.getByRole('spinbutton', { name: 'Минут на ход', exact: true }).fill('-2')
  await expect(page.getByRole('button', { name: 'Начать партию', exact: true })).toBeDisabled()
  await page.getByRole('spinbutton', { name: 'Минут на ход', exact: true }).fill('0')
  await page.getByRole('button', { name: 'Начать партию', exact: true }).click()
  await page.getByRole('button', { name: 'Готово · начать партию', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Спасовать', exact: true })).toBeEnabled()
  await expect(page.locator('.match-status time')).toHaveCount(0)
  expect((await roomState(page)).timer?.minutes).toBe(0)
})
