import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

interface ReadyWindow extends Window {
  __rari_client_ready?: boolean
}

const TODO_APP = path.resolve(
  import.meta.dirname,
  '../fixtures/app/src/components/todo/TodoApp.tsx',
)

async function waitForClient(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => (window as ReadyWindow).__rari_client_ready === true, {
    timeout: 30_000,
  })
}

test.describe.serial('rari dev', () => {
  let original = ''

  test.beforeAll(() => {
    original = fs.readFileSync(TODO_APP, 'utf8')
  })

  test.afterEach(() => {
    fs.writeFileSync(TODO_APP, original)
  })

  test('serves pages with the Vite client and hydrates islands', async ({ page }) => {
    const errors: string[] = []
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text())
    })

    await page.goto('/actions')
    await waitForClient(page)

    await expect(page.locator('script[src*="@vite/client"]')).toHaveCount(1)
    await page.fill('[data-testid="todo-input"]', 'dev hydrated')
    await expect(page.locator('[data-testid="todo-input"]')).toHaveValue('dev hydrated')
    expect(errors.filter(text => text.includes('hydration'))).toEqual([])
  })

  test('island server actions work in dev', async ({ page }) => {
    await page.goto('/actions')
    await waitForClient(page)

    const [response] = await Promise.all([
      page.waitForResponse(res => res.request().method() === 'POST', { timeout: 15_000 }),
      page.click('[data-testid="reset-button"]'),
    ])
    expect(response.headers()['content-type']).toContain('application/x-rari-seroval')
    await expect(page.locator('[data-testid="todo-count"]')).toHaveText('Total: 2')
  })

  test('editing an island rebuilds the server bundle and reloads the page', async ({ page }) => {
    await page.goto('/actions')
    await waitForClient(page)
    await expect(page.locator('h2').first()).toHaveText('Add Todo')

    fs.writeFileSync(TODO_APP, original.replace('<h2>Add Todo</h2>', '<h2>Add Todo HMR</h2>'))

    await expect(page.locator('h2').first()).toHaveText('Add Todo HMR', { timeout: 20_000 })
    await waitForClient(page)
    await page.fill('[data-testid="todo-input"]', 'still interactive')
    await expect(page.locator('[data-testid="todo-input"]')).toHaveValue('still interactive')
  })
})
