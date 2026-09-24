import { expect, test } from '@playwright/test'

test.describe('Error Handling', () => {
  test('renders the route error component when the page throws', async ({ page }) => {
    await page.goto('/error-test?throw=1')

    await expect(page.locator('[data-testid="error-boundary"]')).toBeVisible()
    await expect(page.locator('[data-testid="error-message"]')).toHaveText(
      'Test error from component',
    )
  })

  test('the error page keeps the root layout', async ({ page }) => {
    await page.goto('/error-test?throw=1')

    await expect(page.locator('[data-testid="site-nav"]')).toBeVisible()
  })

  test('the reset link leads back to the working page', async ({ page }) => {
    await page.goto('/error-test?throw=1')
    await page.click('[data-testid="reset-link"]')

    await expect(page.locator('[data-testid="error-test-page"]')).toBeVisible()
    await expect(page.locator('[data-testid="error-boundary"]')).toHaveCount(0)
  })

  test('unknown routes render not-found inside the layout with a 404', async ({ page }) => {
    const response = await page.goto('/definitely-not-a-route')

    expect(response?.status()).toBe(404)
    await expect(page.locator('[data-testid="not-found-page"]')).toBeVisible()
    await expect(page.locator('[data-testid="site-nav"]')).toBeVisible()
  })
})
