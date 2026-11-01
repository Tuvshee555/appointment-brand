import { expect, test, type Page } from '@playwright/test'

/** Fails the test on uncaught page errors and console errors. */
function trackErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  return errors
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

test('home page shows the brand, live openings and both calls to action @mobile', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('./')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Хумсны нарийн урлал')
  await expect(page.getByRole('link', { name: 'Цаг захиалах' }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Үйлчилгээ харах' })).toBeVisible()
  await expectNoHorizontalScroll(page)
  expect(errors).toEqual([])
})

test('services page filters by category and links to booking', async ({ page }) => {
  await page.goto('services')
  await expect(page.getByRole('heading', { name: 'Гель будалт' })).toBeVisible()
  await page.getByRole('tab', { name: 'Педикюр' }).click()
  await expect(page.getByRole('heading', { name: 'Гель педикюр' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Гель будалт' })).toHaveCount(0)
  await expect(page.getByText('95,000₮').first()).toBeVisible()
})

test('a customer books a real slot, sees the request and cancels it @mobile', async ({ page }) => {
  const errors = trackErrors(page)
  const next = () => page.getByRole('button', { name: 'Үргэлжлүүлэх' }).filter({ visible: true }).first().click()

  await page.goto('book?service=gel-polish')
  await page.getByRole('button', { name: /Аль ч мастер/ }).click()
  await next()
  const day = page.locator('[role=gridcell]:not([disabled])').first()
  await day.waitFor({ timeout: 60_000 })
  await day.click()
  const time = page.locator('fieldset button').first()
  await time.waitFor({ timeout: 60_000 })
  await time.click()
  await next()
  await page.getByRole('button', { name: /Жишээ мэдээлэл бөглөх/ }).click()
  await next()
  await expect(page.getByText('Шалгаад баталгаажуулах')).toBeVisible()
  await expect(page.getByText('65,000₮').first()).toBeVisible()
  await page.getByRole('button', { name: 'Захиалах' }).filter({ visible: true }).first().click()

  await page.waitForURL(/\/booking\/SV-[A-Z0-9]{6}/, { timeout: 60_000 })
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/SV-[A-Z0-9]{6}/)
  // Without a deposit the booking is a request until the salon confirms it.
  await expect(page.getByText('Салоны баталгаажуулалт хүлээж буй').first()).toBeVisible()
  await expectNoHorizontalScroll(page)

  await page.getByRole('button', { name: 'Цуцлах' }).click()
  await page.getByRole('button', { name: 'Тийм, цуцлах' }).click()
  await expect(page.getByText('Цуцлагдсан').first()).toBeVisible({ timeout: 30_000 })
  expect(errors).toEqual([])
})

test('the assistant answers prices from the catalogue', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Чат туслах нээх' }).click()
  const chat = page.getByRole('region', { name: 'Сувдын туслах' })
  await chat.getByPlaceholder('Жишээ: Гель будалт хэд вэ?').fill('Гель будалт хэд вэ?')
  await chat.getByRole('button', { name: 'Илгээх' }).click()
  await expect(chat.getByText(/65,000₮/).first()).toBeVisible({ timeout: 60_000 })
})
