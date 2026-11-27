// The dashboard's "today's specialists" card on days the salon itself is closed or keeps special
// hours (seeded holidays, src/server/seed/catalog-data.ts fixedHolidays). Until 2026-11-27 it read
// only the personal weekly schedules, so on a public holiday every master showed as free all day.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { freshDatabase, type TestDb } from './db'

let env: TestDb
let availableStaffToday: typeof import('@/server/queries/admin-dashboard').availableStaffToday

beforeAll(async () => {
  env = await freshDatabase()
  // The dashboard queries use the app-wide pool: point it at this test's database before loading them.
  process.env.DATABASE_URL = env.url
  ;({ availableStaffToday } = await import('@/server/queries/admin-dashboard'))
})
afterAll(async () => {
  await (globalThis as { __salonPool?: { end: () => Promise<void> } }).__salonPool?.end()
  await env.close()
})

describe('dashboard: specialists today', () => {
  it('shows nobody working on a salon holiday, with the holiday named', async () => {
    const rows = await availableStaffToday(env.salonId, '2026-11-26', null)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.working).toBe(false)
      expect(row.shiftMinutes).toBe(0)
      expect(row.salonClosed).toEqual({ label: 'Бүгд Найрамдах Улс тунхагласан өдөр' })
    }
  })

  it('shows the personal schedules on an ordinary open day', async () => {
    const rows = await availableStaffToday(env.salonId, '2026-11-25', null)
    expect(rows.some((row) => row.working && row.shiftMinutes > 0)).toBe(true)
    for (const row of rows) expect(row.salonClosed).toBeNull()
  })

  it('cuts every shift to the special opening hours of 31 December (10:00–15:00)', async () => {
    const rows = await availableStaffToday(env.salonId, '2026-12-31', null)
    const working = rows.filter((row) => row.working)
    expect(working.length).toBeGreaterThan(0)
    for (const row of working) expect(row.shiftMinutes).toBeLessThanOrEqual(5 * 60)
  })
})
