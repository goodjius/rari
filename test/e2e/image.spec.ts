import { expect, test } from '@playwright/test'

test.describe('rari/image', () => {
  test('renders an optimized <img> pointing at the image endpoint', async ({ page }) => {
    await page.goto('/image')

    const img = page.locator('[data-testid="image-page"] img, #image-page img')
    await expect(img).toBeVisible()
    await expect(img).toHaveAttribute('src', /\/_rari\/image\?url=%2Fphoto\.png/)
    await expect(img).toHaveAttribute('width', '640')
  })
})
