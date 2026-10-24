import { expect, type Page } from '@playwright/test'
import type { Catalog } from '../../src/domain/types'

let catalog: Catalog | undefined

// Snapshot-based UI tests already control the room and WebSocket. Use the
// same server catalog throughout the worker and stub the unrelated room list,
// so those tests don't spend the real multiplayer tests' API rate budget.
export async function mockMatchBootstrap(page: Page): Promise<Catalog> {
  if (!catalog) {
    const response = await page.request.get('/api/catalog')
    expect(response.ok(), `GET /api/catalog returned ${response.status()}`).toBeTruthy()
    catalog = (await response.json()) as Catalog
    expect(Array.isArray(catalog.cards)).toBe(true)
    expect(Array.isArray(catalog.leaders)).toBe(true)
  }
  const snapshot = structuredClone(catalog)
  await page.route('**/api/catalog', (route) => route.fulfill({ json: snapshot }))
  await page.route('**/api/rooms', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { rooms: [] } })
    return route.fallback()
  })
  return snapshot
}
