import { expect, test } from '@playwright/test'
import type { Room } from '../../src/domain/types'

for (const hostFirst of [false, true])
  test(`early invitation: ${hostFirst ? 'host ready before guest joins' : 'guest connects while host builds deck'}`, async ({
    browser,
    baseURL,
  }) => {
    const a = await browser.newContext({ baseURL, reducedMotion: 'reduce' }),
      b = await browser.newContext({ baseURL, reducedMotion: 'reduce' })
    const host = await a.newPage(),
      guest = await b.newPage()
    const faults: string[] = []
    host.on('pageerror', (e) => faults.push(e.message))
    guest.on('pageerror', (e) => faults.push(e.message))
    try {
      await host.goto('/')
      await host.getByRole('button', { name: 'Пригласить друга', exact: true }).click()
      await host.getByRole('button', { name: 'Создать ссылку приглашения', exact: true }).click()
      await expect(
        host.getByRole('heading', { name: 'Приглашение готово', exact: true }),
      ).toBeVisible()
      const link = await host.locator('#invite-link').inputValue(),
        code = link.split('/room/')[1]
      await expect(host).toHaveURL(link)
      await host.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined }))
      await host.getByRole('button', { name: 'Скопировать приглашение', exact: true }).click()
      expect(
        await host
          .locator('#invite-link')
          .evaluate((input: HTMLInputElement) => input.selectionEnd! - input.selectionStart!),
      ).toBe(link.length)
      if (!hostFirst) {
        await guest.goto(link)
        await guest.getByRole('textbox', { name: 'Имя игрока', exact: true }).fill('Гость')
        await guest.getByRole('button', { name: /Скеллиге/ }).click()
        await guest.getByRole('button', { name: 'Присоединиться к партии', exact: true }).click()
        await expect(
          guest.getByRole('heading', { name: 'Соперник готовит колоду', exact: true }),
        ).toBeVisible()
        await expect(host.locator('.invitation-status')).toContainText('Гость подключился')
        await host.reload()
        await expect(host.locator('#invite-link')).toHaveValue(link)
        await expect(host.locator('.invitation-status')).toContainText('Гость подключился')
      }
      await host.getByRole('textbox', { name: 'Имя игрока', exact: true }).fill('Хозяин')
      await host.getByRole('button', { name: /Нильфгаард/ }).click()
      await host.getByRole('button', { name: 'Открыть колодострой', exact: true }).click()
      await host.getByRole('button', { name: 'Использовать колоду', exact: true }).click()
      await expect(host.locator('#invite-link')).toHaveValue(link)
      await host.getByRole('spinbutton', { name: 'Минут на ход', exact: true }).fill('2.5')
      await host.getByRole('button', { name: 'Мягкий', exact: true }).click()
      await host.screenshot({
        path: test.info().outputPath('early-invitation.png'),
        fullPage: true,
      })
      await host.getByRole('button', { name: 'Готово · начать партию', exact: true }).click()
      if (hostFirst) {
        await expect(host.getByRole('heading', { name: 'Место напротив свободно' })).toBeVisible()
        await guest.goto(link)
        await guest.getByRole('button', { name: 'Присоединиться к партии', exact: true }).click()
      }
      await expect(host.getByRole('dialog', { name: 'Подготовьте стартовую руку' })).toBeVisible()
      await expect(guest.getByRole('dialog', { name: 'Подготовьте стартовую руку' })).toBeVisible()
      const room = (await (await host.request.get(`/api/rooms/${code}`)).json()) as Room
      expect(room.code).toBe(code)
      expect(room.players[0].name).toBe('Хозяин')
      expect(room.players[0].faction).toBe('nilfgaard')
      expect(room.timer).toEqual({ minutes: 2.5, mode: 'soft' })
      expect(room.players.every((p) => p.handCount === 10)).toBe(true)
      expect(faults).toEqual([])
    } finally {
      await a.close()
      await b.close()
    }
  })
