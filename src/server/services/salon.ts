// Salon configuration: settings, opening hours and special days.
import { and, asc, eq, gte, lte } from 'drizzle-orm'
import type { DepositPolicy } from '@/lib/booking/pricing'
import type { SpecialDay, WeeklyHours } from '@/lib/availability/engine'
import { DEMO_SALON } from '@/lib/brand'
import type { DateKey } from '@/lib/datetime'
import type { Database } from '@/server/db/client'
import * as t from '@/server/db/schema'

export type BusinessSettings = typeof t.businessSettings.$inferSelect

export interface SalonConfig {
  salon: { id: string; slug: string; name: string; timezone: string; isDemo: boolean }
  settings: BusinessSettings
  weekly: WeeklyHours[]
}

const salonIdCache = new Map<string, string>()

/** The salon this deployment serves (SALON_SLUG, default: the demo salon). */
export async function resolveSalonId(db: Database, slug = process.env.SALON_SLUG ?? DEMO_SALON.slug): Promise<string> {
  const cached = salonIdCache.get(slug)
  if (cached) return cached
  const [row] = await db.select({ id: t.salons.id }).from(t.salons).where(eq(t.salons.slug, slug))
  if (!row) throw new Error(`Salon "${slug}" not found — run npm run db:seed`)
  salonIdCache.set(slug, row.id)
  return row.id
}

export async function loadSalonConfig(db: Database, salonId: string): Promise<SalonConfig> {
  const [[salon], [settings], weekly] = await Promise.all([
    db.select().from(t.salons).where(eq(t.salons.id, salonId)),
    db.select().from(t.businessSettings).where(eq(t.businessSettings.salonId, salonId)),
    db.select().from(t.openingHours).where(eq(t.openingHours.salonId, salonId)).orderBy(asc(t.openingHours.weekday)),
  ])
  if (!salon || !settings) throw new Error('Salon settings missing — run npm run db:seed')
  return {
    salon: { id: salon.id, slug: salon.slug, name: salon.name, timezone: salon.timezone, isDemo: salon.isDemo },
    settings,
    weekly: weekly.map((w) => ({ weekday: w.weekday, isClosed: w.isClosed, opensAt: w.opensAt, closesAt: w.closesAt })),
  }
}

export async function loadSpecialDays(db: Database, salonId: string, from: DateKey, to: DateKey): Promise<SpecialDay[]> {
  const rows = await db
    .select()
    .from(t.specialDays)
    .where(and(eq(t.specialDays.salonId, salonId), gte(t.specialDays.date, from), lte(t.specialDays.date, to)))
    .orderBy(asc(t.specialDays.date))
  return rows.map((r) => ({ date: r.date, kind: r.kind, opensAt: r.opensAt, closesAt: r.closesAt, label: r.label }))
}

export function depositPolicy(settings: BusinessSettings): DepositPolicy {
  return {
    mode: settings.depositMode,
    fixedAmount: settings.depositFixedAmount,
    percentBps: settings.depositPercentBps,
    minTotal: settings.depositMinTotal,
  }
}
