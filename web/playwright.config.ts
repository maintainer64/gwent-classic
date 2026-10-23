import { defineConfig } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const baseURL = process.env.GWENT_E2E_URL ?? 'http://127.0.0.1:18117'
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  expect: { timeout: 12000 },
  use: {
    baseURL,
    viewport: { width: 1366, height: 768 },
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.GWENT_E2E_URL
    ? undefined
    : {
        command: 'go run ./cmd/gwent',
        cwd: '..',
        url: baseURL + '/healthz',
        env: {
          LISTEN_ADDR: '127.0.0.1:18117',
          STATIC_DIR: 'web/dist',
          CARDS_FILE: '',
          DATA_DIR: mkdtempSync(join(tmpdir(), 'gwent-e2e-')),
        },
        reuseExistingServer: false,
        timeout: 120000,
      },
})
