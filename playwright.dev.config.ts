import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

const port = process.env.DEV_PORT ?? '3100'

// Separate from playwright.config.ts: the dev server rewrites the fixture's dist/ and source files,
// so it must not run alongside the production server.
export default defineConfig({
  testDir: './test/e2e-dev',
  workers: 1,
  reporter: process.env.CI == null ? 'html' : 'github',
  use: { baseURL: `http://localhost:${port}`, trace: 'on-first-retry' },
  webServer: {
    command: 'pnpm --filter rari build && pnpm --filter @test/app dev',
    url: `http://localhost:${port}`,
    reuseExistingServer: process.env.E2E_REUSE_SERVER === '1',
    timeout: 120_000,
    env: { PORT: port },
  },
  projects: [{ name: 'Dev Server', use: { ...devices['Desktop Chrome'] } }],
})
