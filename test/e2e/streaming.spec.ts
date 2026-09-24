import { expect, test } from '@playwright/test'
import {
  assertProgressiveTimestamps,
  getServerTimestamps,
  gotoWithRetry,
} from './shared/streaming-helpers'

test.describe('Streaming', () => {
  test.setTimeout(60_000)

  test('sends the loading fallback first, then reveals each Suspense boundary in order', async ({
    page,
  }) => {
    await gotoWithRetry(page, '/suspense-streaming?run=order')

    await expect(page.locator('[data-testid="run-id"]')).toHaveText('order')

    const times = await getServerTimestamps(page, ['component-a', 'component-b', 'component-c'])
    assertProgressiveTimestamps(times, { minGap: 500 })

    for (const id of ['loading-a', 'loading-b', 'loading-c'])
      await expect(page.locator(`[data-testid="${id}"]`)).toHaveCount(0)
  })

  test('the first byte arrives before the slowest boundary resolves', async ({ page }) => {
    const started = Date.now()
    const response = await page.goto('/suspense-streaming?run=ttfb', { waitUntil: 'commit' })
    const commitMs = Date.now() - started

    expect(response?.status()).toBe(200)
    expect(commitMs).toBeLessThan(2500)
    await expect(page.locator('[data-testid="component-c"]')).toBeVisible({ timeout: 15_000 })
  })

  test('response is chunked HTML with the hydration bootstrap in <head>', async ({ request }) => {
    const response = await request.get('/suspense-streaming?run=headers')

    expect(response.headers()['content-type']).toContain('text/html')
    const html = await response.text()
    expect(html.indexOf('_$HY')).toBeGreaterThan(-1)
    expect(html.indexOf('_$HY')).toBeLessThan(html.indexOf('</head>'))
  })

  test('has no console errors while streaming', async ({ page }) => {
    const errors: string[] = []
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text())
    })

    await gotoWithRetry(page, '/suspense-streaming-parallel')
    await expect(page.locator('[data-testid="component-slow"]')).toBeVisible({ timeout: 15_000 })

    expect(errors).toEqual([])
  })
})
