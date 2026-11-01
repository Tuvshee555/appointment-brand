import 'server-only'
import { and, asc, eq, gt, gte, inArray, lt, sql } from 'drizzle-orm'
import { dateKeyOf, dayBounds, addDays } from '@/lib/datetime'
import { db } from '@/server/db'
import * as t from '@/server/db/schema'

export async function listStaffAdmin(salonId: string, now: Date) {
  const today = dateKeyOf(now)
  const staff = await db.select().from(t.staff).where(eq(t.staff.salonId, salonId)).orderBy(asc(t.staff.sortOrder))
  const ids = staff.map((s) => s.id)
  if (!ids.length) return []
  const [schedules, services, todayCounts, upcoming] = await Promise.all([
    db.select().from(t.staffSchedules).where(inArray(t.staffSchedules.staffId, ids)),
    db.select().from(t.staffServices).where(inArray(t.staffServices.staffId, ids)),
    db
      .select({ staffId: t.appointments.staffId, n: sql<number>`count(*)::int` })
      .from(t.appointments)
      .where(
        and(
          inArray(t.appointments.staffId, ids),
          gte(t.appointments.startsAt, dayBounds(today).start),
          lt(t.appointments.startsAt, dayBounds(today).end),
          inArray(t.appointments.status, ['pending', 'confirmed', 'completed', 'awaiting_deposit', 'no_show']),
        ),
      )
      .groupBy(t.appointments.staffId),
    db
      .select({ staffId: t.appointments.staffId, n: sql<number>`count(*)::int` })
      .from(t.appointments)
      .where(
        and(
          inArray(t.appointments.staffId, ids),
          gt(t.appointments.startsAt, now),
          inArray(t.appointments.status, ['pending', 'confirmed', 'awaiting_deposit']),
        ),
      )
      .groupBy(t.appointments.staffId),
  ])
  return staff.map((s) => ({
    ...s,
    workDays: schedules.filter((x) => x.staffId === s.id && x.isWorking).map((x) => x.weekday),
    serviceCount: services.filter((x) => x.staffId === s.id).length,
    today: todayCounts.find((x) => x.staffId === s.id)?.n ?? 0,
    upcoming: upcoming.find((x) => x.staffId === s.id)?.n ?? 0,
  }))
}

export async function loadStaffAdmin(salonId: string, staffId: string, now: Date) {
  const [staff] = await db
    .select()
    .from(t.staff)
    .where(and(eq(t.staff.id, staffId), eq(t.staff.salonId, salonId)))
  if (!staff) return null
  const today = dateKeyOf(now)
  const [schedules, breaks, timeOff, skills, staffSkills, services, staffServices, serviceSkills, appointments] =
    await Promise.all([
      db
        .select()
        .from(t.staffSchedules)
        .where(eq(t.staffSchedules.staffId, staffId))
        .orderBy(asc(t.staffSchedules.weekday)),
      db.select().from(t.staffBreaks).where(eq(t.staffBreaks.staffId, staffId)),
      db
        .select()
        .from(t.staffTimeOff)
        .where(
          and(
            eq(t.staffTimeOff.staffId, staffId),
            gt(t.staffTimeOff.endsAt, new Date(now.getTime() - 30 * 86_400_000)),
          ),
        )
        .orderBy(asc(t.staffTimeOff.startsAt)),
      db.select().from(t.skills).where(eq(t.skills.salonId, salonId)).orderBy(asc(t.skills.sortOrder)),
      db.select().from(t.staffSkills).where(eq(t.staffSkills.staffId, staffId)),
      db
        .select({ id: t.services.id, name: t.services.name, isActive: t.services.isActive })
        .from(t.services)
        .where(eq(t.services.salonId, salonId))
        .orderBy(asc(t.services.sortOrder)),
      db.select().from(t.staffServices).where(eq(t.staffServices.staffId, staffId)),
      db.select().from(t.serviceSkills),
      db
        .select({
          id: t.appointments.id,
          reference: t.appointments.reference,
          status: t.appointments.status,
          startsAt: t.appointments.startsAt,
          endsAt: t.appointments.endsAt,
          customerName: t.customers.name,
          services: sql<string>`(select string_agg(service_name, ', ' order by sort_order) from salon.appointment_services s where s.appointment_id = ${t.appointments.id})`,
        })
        .from(t.appointments)
        .innerJoin(t.customers, eq(t.customers.id, t.appointments.customerId))
        .where(
          and(
            eq(t.appointments.staffId, staffId),
            gte(t.appointments.startsAt, dayBounds(today).start),
            lt(t.appointments.startsAt, dayBounds(addDays(today, 14)).end),
            inArray(t.appointments.status, ['pending', 'confirmed', 'awaiting_deposit', 'completed', 'no_show']),
          ),
        )
        .orderBy(asc(t.appointments.startsAt)),
    ])
  return {
    staff,
    schedules,
    breaks,
    timeOff,
    skills,
    staffSkills,
    services: services.map((s) => ({
      ...s,
      requiredSkillIds: serviceSkills.filter((r) => r.serviceId === s.id).map((r) => r.skillId),
    })),
    serviceIds: staffServices.map((s) => s.serviceId),
    appointments,
  }
}

export type StaffAdmin = NonNullable<Awaited<ReturnType<typeof loadStaffAdmin>>>
