// The assistant in the browser: a booking made and cancelled entirely in the chat, Latin-script
// and English questions, and the admin AI section for a demo visitor. Run against the local dev
// server and the local database only (it creates and cancels a booking).
import { expect, test, type Page } from '@playwright/test'

async function openChat(page: Page) {
  await page.goto('')
  await page.getByRole('button', { name: 'Чат туслах нээх' }).click()
  const chat = page.getByRole('region', { name: 'Сувдын туслах' })
  await expect(chat.getByText(/Юугаар туслах вэ/).first()).toBeVisible({ timeout: 60_000 })
  return chat
}

async function send(page: Page, text: string) {
  const chat = page.getByRole('region', { name: 'Сувдын туслах' })
  const input = chat.getByLabel('Асуултаа бичих')
  await input.fill(text)
  await chat.getByRole('button', { name: 'Илгээх' }).click()
  await expect(input).toHaveValue('')
  await expect(chat.getByText('Шалгаж байна…')).toBeHidden({ timeout: 60_000 })
}

test('a customer books and then cancels in the chat @mobile', async ({ page }) => {
  const chat = await openChat(page)
  await send(page, 'songodog manikyur tsag avmaar baina')
  await expect(chat.getByText(/аль өдөр тохирох вэ/i).last()).toBeVisible()
  // A day with free times, then a free time — both offered from the real availability.
  await chat
    .getByRole('button', { name: /\(\d+\)$/ })
    .first()
    .click()
  await expect(chat.getByText(/сул цагууд/).last()).toBeVisible({ timeout: 60_000 })
  await chat.locator('.grid button').first().click()
  await expect(chat.getByText(/нэр, утасны дугаараа/).last()).toBeVisible({ timeout: 60_000 })
  await send(page, 'Чат Туршилт 99887766')
  await expect(chat.getByText('Захиалгын хураангуй')).toBeVisible()
  await expect(chat.getByText('45,000₮').first()).toBeVisible()
  await send(page, 'tiim')
  await expect(chat.getByText(/Захиалга бүртгэгдлээ: SV-[A-Z0-9]{6}/)).toBeVisible()
  await expect(chat.getByRole('link', { name: 'Захиалгаа харах' })).toBeVisible()

  // Same chat: the booking it made can be cancelled after an explicit confirmation.
  await send(page, 'tsagaa tsutsalmaar baina')
  await expect(chat.getByText('Цуцлах хүсэлт')).toBeVisible()
  await send(page, 'tiim')
  await expect(chat.getByText(/захиалга цуцлагдлаа/)).toBeVisible()
})

test('the assistant understands Latin-script Mongolian and English', async ({ page }) => {
  const chat = await openChat(page)
  await send(page, 'gel budalt hed ve')
  await expect(chat.getByText(/Гель будалт — 65,000₮/).last()).toBeVisible()
  await send(page, 'ene uilchilgee hed hugatsaa oroh ve?')
  await expect(chat.getByText(/1 цаг 30 мин/).last()).toBeVisible()
  await send(page, 'where are you located')
  await expect(chat.getByText(/Address:/).last()).toBeVisible()
})

test('a demo visitor can explore the AI section and try the assistant', async ({ page }) => {
  await page.goto('admin/login')
  await page.getByRole('button', { name: 'Админ самбар үзэх' }).click()
  await expect(page.getByRole('heading', { name: 'Өнөөдрийн тойм' })).toBeVisible({ timeout: 60_000 })
  await page.goto('admin/assistant')
  const tabs = page.getByRole('navigation', { name: 'AI туслахын хэсгүүд' })
  for (const name of [
    'Тойм',
    'Харилцан яриа',
    'Мэдлэг',
    'Тохиргоо',
    'Аналитик',
    'Үйл ажиллагаа',
    'Туршиж үзэх',
    'Асуудал',
  ])
    await expect(tabs.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible()
  await tabs.getByRole('link', { name: 'Мэдлэг' }).click()
  await expect(page.getByText('Баталгаажсан').first()).toBeVisible()
  await tabs.getByRole('link', { name: 'Туршиж үзэх' }).click()
  await page.getByLabel('Туршилтын мессеж').fill('gel budalt hed ve')
  await page.getByRole('button', { name: 'Илгээх' }).click()
  await expect(page.getByText(/65,000₮/).last()).toBeVisible({ timeout: 60_000 })
  await tabs.getByRole('link', { name: 'Харилцан яриа' }).click()
  // Contact details typed by customers stay hidden from demo visitors.
  await expect(page.getByText(/9988\s?7766/)).toHaveCount(0)
})

test('every AI section page fits a phone screen @mobile', async ({ page }) => {
  await page.goto('admin/login')
  await page.getByRole('button', { name: 'Админ самбар үзэх' }).click()
  await expect(page.getByRole('heading', { name: 'Өнөөдрийн тойм' })).toBeVisible({ timeout: 60_000 })
  for (const path of ['', 'conversations', 'knowledge', 'settings', 'analytics', 'activity', 'try', 'problems']) {
    await page.goto(`admin/assistant${path ? `/${path}` : ''}`)
    await expect(page.getByRole('navigation', { name: 'AI туслахын хэсгүүд' })).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, path || 'overview').toBeLessThanOrEqual(0)
  }
})
