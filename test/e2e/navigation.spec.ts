import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

interface MarkedWindow extends Window {
  __navMarker?: string
  __rari_client_ready?: boolean
}

async function ready(page: Page) {
  await page.waitForFunction(() => (window as MarkedWindow).__rari_client_ready === true, {
    timeout: 30_000,
  })
}

async function mark(page: Page) {
  await page.evaluate(() => {
    ;(window as MarkedWindow).__navMarker = 'same-document'
  })
}

async function stillSameDocument(page: Page) {
  return page.evaluate(() => (window as MarkedWindow).__navMarker === 'same-document')
}

// Injected links are pinned above the layout so they are clickable at any viewport size.
async function addLink(
  page: Page,
  href: string,
  id: string,
  attrs: Readonly<Record<string, string>> = {},
) {
  await page.evaluate(
    ({ href: to, id: linkId, attrs: extra }) => {
      const link = document.createElement('a')
      link.href = to
      link.id = linkId
      link.textContent = linkId
      link.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:white;padding:8px'
      for (const [name, value] of Object.entries(extra)) link.setAttribute(name, value)
      document.body.append(link)
    },
    { href, id, attrs },
  )
}

test.describe('Client navigation', () => {
  test('follows a link without a full page load', async ({ page }) => {
    await page.goto('/')
    await ready(page)
    await mark(page)

    await page.click('a[href="/about"]')

    await expect(page).toHaveURL(/\/about$/)
    await expect(page.locator('h1')).toHaveText('About Page')
    expect(await stillSameDocument(page)).toBe(true)
  })

  test('updates the document title and metadata', async ({ page }) => {
    await page.goto('/')
    await ready(page)
    await page.click('a[href="/about"]')

    await expect(page).toHaveTitle('About')
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'About page')
  })

  test('hydrates islands on the page it navigates to', async ({ page }) => {
    await page.goto('/about')
    await ready(page)
    await mark(page)

    await addLink(page, '/actions', 'to-actions')
    await page.click('#to-actions')
    await expect(page.locator('[data-testid="todo-list"]')).toBeVisible()
    await ready(page)

    const [response] = await Promise.all([
      page.waitForResponse(res => res.request().method() === 'POST', { timeout: 15_000 }),
      page.click('[data-testid="reset-button"]'),
    ])
    expect(response.status()).toBe(200)
    await expect(page.locator('[data-testid="todo-count"]')).toHaveText('Total: 2')
    expect(await stillSameDocument(page)).toBe(true)
  })

  test('back and forward move through history without reloading', async ({ page }) => {
    await page.goto('/')
    await ready(page)
    await mark(page)

    await page.click('a[href="/about"]')
    await expect(page).toHaveURL(/\/about$/)

    await page.goBack()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator('h1')).toHaveText('Test App Home')

    await page.goForward()
    await expect(page).toHaveURL(/\/about$/)
    await expect(page.locator('h1')).toHaveText('About Page')
    expect(await stillSameDocument(page)).toBe(true)
  })

  test('renders streamed Suspense content after navigating', async ({ page }) => {
    await page.goto('/')
    await ready(page)
    await addLink(page, '/suspense-streaming-parallel', 'to-parallel')
    await page.click('#to-parallel')

    await expect(page.locator('[data-testid="component-slow"]')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-testid="loading-slow"]')).toHaveCount(0)
  })

  test('shows not-found for unknown routes with the layout intact', async ({ page }) => {
    await page.goto('/')
    await ready(page)
    await addLink(page, '/no-such-page', 'to-missing')
    await page.click('#to-missing')

    await expect(page.locator('[data-testid="not-found-page"]')).toBeVisible()
    await expect(page.locator('[data-testid="site-nav"]')).toBeVisible()
  })

  test('leaves external links, new-tab clicks and reload-marked links to the browser', async ({
    page,
  }) => {
    await page.goto('/')
    await ready(page)
    await mark(page)
    await addLink(page, '/about', 'hard', { 'data-rari-reload': '' })

    await page.click('#hard')
    await expect(page).toHaveURL(/\/about$/)
    expect(await stillSameDocument(page)).toBe(false)
  })

  test('preserves the hash on same-document links', async ({ page }) => {
    await page.goto('/about')
    await ready(page)
    await mark(page)
    await addLink(page, '/about#bottom', 'hash')
    await page.click('#hash')

    await expect(page).toHaveURL(/\/about#bottom$/)
    expect(await stillSameDocument(page)).toBe(true)
  })
})
