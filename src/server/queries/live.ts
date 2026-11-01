// Request-time reads for public pages (never cached): real next openings.
import 'server-only'
import { and, eq } from 'drizzle-orm'
import { connection } from 'next/server'
import { dateKeyOf } from '@/lib/datetime'
import { db } from '@/server/db'
import * as t from '@/server/db/schema'
import { nextAvailableSlots, prepareSelection } from '@/server/services/availability'
import { resolveSalonId } from '@/server/services/salon'

/** The next bookable times for a service with any specialist, computed by the live engine. */
export async function getNextOpenings(serviceSlug: string, limit = 3) {
  await connection()
  const now = new Date()
  const salonId = await resolveSalonId(db)
  const [service] = await db
    .select({ id: t.services.id, name: t.services.name })
    .from(t.services)
    .where(and(eq(t.services.salonId, salonId), eq(t.services.slug, serviceSlug), eq(t.services.isActive, true)))
  if (!service) return null
  try {
    const prepared = await prepareSelection(db, salonId, [{ serviceId: service.id, addonIds: [] }], null, {
      publicOnly: true,
    })
    const slots = await nextAvailableSlots(db, prepared, dateKeyOf(now), { now, limit, days: 10 })
    return { serviceName: service.name, serviceSlug, slots, checkedAt: now.toISOString() }
  } catch {
    return { serviceName: service.name, serviceSlug, slots: [], checkedAt: now.toISOString() }
  }
}
