import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('admin/login')
  await page.getByRole('button', { name: 'Админ самбар үзэх' }).click()
  await expect(page.getByRole('heading', { name: 'Өнөөдрийн тойм' })).toBeVisible({ timeout: 60_000 })
})

test('visitors can explore the demo dashboard @mobile', async ({ page }) => {
  await expect(page.getByText('Демо горим.')).toBeVisible()
  await page.goto('admin/appointments')
  await expect(page.getByRole('heading', { name: 'Захиалгууд' })).toBeVisible()
  await page.goto('admin/calendar?view=week')
  await expect(page.getByRole('heading', { name: 'Хуанли' })).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('demo changes to sample bookings are validated but not saved', async ({ page }) => {
  const request = page
    .locator('li')
    .filter({ has: page.getByRole('button', { name: 'Баталгаажуулах' }) })
    .filter({ hasNotText: 'таны туршилт' })
    .first()
  await request.getByRole('button', { name: 'Баталгаажуулах' }).click()
  await expect(page.getByText(/Демо горим: сервер шалгалтыг бүрэн хийсэн/).first()).toBeVisible()

  // The request is still waiting after a reload.
  await page.reload()
  await expect(page.getByRole('heading', { name: /Баталгаажуулах хүсэлт \(\d+\)/ })).toBeVisible()
})

test('demo visitors cannot reach real contact details', async ({ page }) => {
  await page.goto('admin/customers')
  await expect(page.getByText(/\d{2}\*{4}\d{2}/).first()).toBeVisible()
})
