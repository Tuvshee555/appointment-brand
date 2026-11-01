import { defineConfig, devices } from '@playwright/test'

// E2E_BASE_URL can point at a deployment (e.g. https://…/portfolio/appointments).
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3210/portfolio/appointments'
// Installed Google Chrome by default; set E2E_BROWSER_CHANNEL=chromium to use Playwright's own build.
const channel = process.env.E2E_BROWSER_CHANNEL ?? 'chrome'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: baseURL.endsWith('/') ? baseURL : `${baseURL}/`,
    locale: 'mn-MN',
    timezoneId: 'Asia/Ulaanbaatar',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel }, grep: /@mobile/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3210/portfolio/appointments',
        reuseExistingServer: true,
        timeout: 240_000,
      },
})
