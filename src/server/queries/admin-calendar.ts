// Calendar read model: appointments, shifts, breaks, time off and salon hours
// for a date range, scoped to the actor (specialists see only themselves).
import 'server-only'
import { and, asc, eq, gt, gte, inArray, lt, sql } from 'drizzle-orm'
import { salonHoursFor, type MinuteRange } from '@/lib/availability/engine'
import { addDays, dayBounds, diffDays, type DateKey } from '@/lib/datetime'
import { db } from '@/server/db'
import * as t from '@/server/db/schema'
import type { SessionActor } from '@/server/auth/session'
import { loadSalonConfig, loadSpecialDays } from '@/server/services/salon'

export interface CalendarAppointment {
  id: string
  reference: string
  status: (typeof t.appointmentStatus.enumValues)[number]
  startsAt: Date
  endsAt: Date
  durationMinutes: number
  staffId: string
  customerName: string
  services: string
  isDemo: boolean
}

export async function loadCalendar(
  session: SessionActor,
  from: DateKey,
  to: DateKey,
  opts: { staffId: string | null; showCancelled: boolean },
) {
  const salonId = session.salonId
  const ownOnly = session.role === 'specialist' ? session.staffId : null
  const staffFilter = ownOnly ?? opts.staffId
  const config = await loadSalonConfig(db, salonId)
  const [allStaff, specials] = await Promise.all([
    db
      .select({ id: t.staff.id, name: t.staff.displayName, color: t.staff.calendarColor, photoUrl: t.staff.photoUrl })
      .from(t.staff)
      .where(
        and(eq(t.staff.salonId, salonId), eq(t.staff.isActive, true), ownOnly ? eq(t.staff.id, ownOnly) : undefined),
      )
      .orderBy(asc(t.staff.sortOrder)),
    loadSpecialDays(db, salonId, from, to),
  ])
  const staff = staffFilter ? allStaff.filter((s) => s.id === staffFilter) : allStaff
  const ids = staff.map((s) => s.id)
  const start = dayBounds(from).start
  const end = dayBounds(to).end
  const statuses = opts.showCancelled
    ? (t.appointmentStatus.enumValues as unknown as string[])
    : ['awaiting_deposit', 'pending', 'confirmed', 'completed', 'no_show']
  const [appointments, schedules, breaks, timeOff] = ids.length
    ? await Promise.all([
        db
          .select({
            id: t.appointments.id,
            reference: t.appointments.reference,
            status: t.appointments.status,
            startsAt: t.appointments.startsAt,
            endsAt: t.appointments.endsAt,
            durationMinutes: t.appointments.durationMinutes,
            staffId: t.appointments.staffId,
            customerName: t.customers.name,
            isDemo: t.appointments.isDemo,
            services: sql<string>`(select string_agg(service_name, ', ' order by sort_order) from salon.appointment_services s where s.appointment_id = ${t.appointments.id})`,
          })
          .from(t.appointments)
          .innerJoin(t.customers, eq(t.customers.id, t.appointments.customerId))
          .where(
            and(
              eq(t.appointments.salonId, salonId),
              inArray(t.appointments.staffId, ids),
              gte(t.appointments.startsAt, start),
              lt(t.appointments.startsAt, end),
              inArray(t.appointments.status, statuses as (typeof t.appointmentStatus.enumValues)[number][]),
            ),
          )
          .orderBy(asc(t.appointments.startsAt)),
        db.select().from(t.staffSchedules).where(inArray(t.staffSchedules.staffId, ids)),
        db.select().from(t.staffBreaks).where(inArray(t.staffBreaks.staffId, ids)),
        db
          .select()
          .from(t.staffTimeOff)
          .where(
            and(
              inArray(t.staffTimeOff.staffId, ids),
              lt(t.staffTimeOff.startsAt, end),
              gt(t.staffTimeOff.endsAt, start),
            ),
          ),
      ])
    : [[], [], [], []]

  const days: { date: DateKey; hours: MinuteRange | null; special: string | null }[] = []
  for (let d = from; diffDays(d, to) <= 0; d = addDays(d, 1)) {
    days.push({
      date: d,
      hours: salonHoursFor(d, config.weekly, specials),
      special: specials.find((s) => s.date === d)?.label ?? null,
    })
  }
  return {
    staff,
    allStaff,
    appointments: appointments as CalendarAppointment[],
    schedules,
    breaks,
    timeOff,
    days,
    weekly: config.weekly,
  }
}
