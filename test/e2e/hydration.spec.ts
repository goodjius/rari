import { expect, test } from '@playwright/test'

interface ReadyWindow extends Window {
  __rari_client_ready?: boolean
}

test.describe('Island hydration', () => {
  test('marks the client ready once islands have hydrated', async ({ page }) => {
    await page.goto('/actions')
    await page.waitForFunction(() => (window as ReadyWindow).__rari_client_ready === true, {
      timeout: 30_000,
    })

    await expect(page.locator('[data-testid="todo-list"]')).toBeVisible()
  })

  test('an island is interactive after hydration', async ({ page }) => {
    await page.goto('/actions')
    await page.waitForFunction(() => (window as ReadyWindow).__rari_client_ready === true, {
      timeout: 30_000,
    })

    await expect(page.locator('[data-testid="pending-state"]')).toHaveText('idle')
    await page.fill('[data-testid="todo-input"]', 'hydrated')
    await expect(page.locator('[data-testid="todo-input"]')).toHaveValue('hydrated')
  })

  test('pages without islands still load the client without errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))

    await page.goto('/about')
    await page.waitForLoadState('networkidle')

    expect(errors).toEqual([])
  })
})
