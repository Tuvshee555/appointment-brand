// Dashboard read model. Every number is computed from database rows.
import 'server-only'
import { and, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm'
import {
  addDays,
  dateKeyOf,
  dayBounds,
  firstOfMonth,
  addMonths,
  startOfWeek,
  weekdayOf,
  type DateKey,
} from '@/lib/datetime'
import { db } from '@/server/db'
import * as t from '@/server/db/schema'
import type { SessionActor } from '@/server/auth/session'

const COUNTED = ['awaiting_deposit', 'pending', 'confirmed', 'completed', 'no_show'] as const

function staffScope(session: SessionActor): SQL | undefined {
  return session.role === 'specialist' && session.staffId ? eq(t.appointments.staffId, session.staffId) : undefined
}

async function revenueBetween(salonId: string, from: Date, to: Date) {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${t.payments.amount}), 0)::int` })
    .from(t.payments)
    .where(
      and(
        eq(t.payments.salonId, salonId),
        eq(t.payments.status, 'paid'),
        gte(t.payments.paidAt, from),
        lt(t.payments.paidAt, to),
      ),
    )
  return row?.total ?? 0
}

export async function loadDashboard(session: SessionActor, now: Date) {
  const salonId = session.salonId
  const today = dateKeyOf(now)
  const { start: dayStart, end: dayEnd } = dayBounds(today)
  const weekStart = dayBounds(startOfWeek(today)).start
  const monthStart = dayBounds(firstOfMonth(today)).start
  const nextMonth = dayBounds(addMonths(today, 1)).start
  const scope = staffScope(session)
  const canSeeMoney = session.permissions.includes('payments.view')

  const appt = (where: SQL | undefined) => and(eq(t.appointments.salonId, salonId), scope, where)

  const [todayList, upcoming, completedMonth, pendingRequests, cancelledMonth, noShowMonth, popular, events, audits] =
    await Promise.all([
      db
        .select({
          id: t.appointments.id,
          reference: t.appointments.reference,
          status: t.appointments.status,
          startsAt: t.appointments.startsAt,
          endsAt: t.appointments.endsAt,
          total: t.appointments.totalPrice,
          isDemo: t.appointments.isDemo,
          customerName: t.customers.name,
          staffName: t.staff.displayName,
          staffColor: t.staff.calendarColor,
          services: sql<string>`(select string_agg(service_name, ', ' order by sort_order) from salon.appointment_services s where s.appointment_id = ${t.appointments.id})`,
        })
        .from(t.appointments)
        .innerJoin(t.customers, eq(t.customers.id, t.appointments.customerId))
        .innerJoin(t.staff, eq(t.staff.id, t.appointments.staffId))
        .where(
          appt(
            and(
              gte(t.appointments.startsAt, dayStart),
              lt(t.appointments.startsAt, dayEnd),
              inArray(t.appointments.status, [...COUNTED]),
            ),
          ),
        )
        .orderBy(t.appointments.startsAt),
      db.$count(
        t.appointments,
        appt(
          and(
            gte(t.appointments.startsAt, now),
            lt(t.appointments.startsAt, dayBounds(addDays(today, 7)).end),
            inArray(t.appointments.status, ['pending', 'confirmed', 'awaiting_deposit']),
          ),
        ),
      ),
      db.$count(
        t.appointments,
        appt(
          and(
            eq(t.appointments.status, 'completed'),
            gte(t.appointments.startsAt, monthStart),
            lt(t.appointments.startsAt, nextMonth),
          ),
        ),
      ),
      db
        .select({
          id: t.appointments.id,
          reference: t.appointments.reference,
          status: t.appointments.status,
          startsAt: t.appointments.startsAt,
          createdAt: t.appointments.createdAt,
          source: t.appointments.source,
          customerName: t.customers.name,
          staffName: t.staff.displayName,
          demoVisitorHash: t.appointments.demoVisitorHash,
        })
        .from(t.appointments)
        .innerJoin(t.customers, eq(t.customers.id, t.appointments.customerId))
        .innerJoin(t.staff, eq(t.staff.id, t.appointments.staffId))
        .where(appt(inArray(t.appointments.status, ['pending', 'awaiting_deposit'])))
        .orderBy(t.appointments.startsAt)
        .limit(8),
      db.$count(
        t.appointments,
        appt(
          and(
            eq(t.appointments.status, 'cancelled'),
            gte(t.appointments.cancelledAt, monthStart),
            lt(t.appointments.cancelledAt, nextMonth),
          ),
        ),
      ),
      db.$count(
        t.appointments,
        appt(
          and(
            eq(t.appointments.status, 'no_show'),
            gte(t.appointments.startsAt, monthStart),
            lt(t.appointments.startsAt, nextMonth),
          ),
        ),
      ),
      db
        .select({ name: t.appointmentServices.serviceName, n: sql<number>`count(*)::int` })
        .from(t.appointmentServices)
        .innerJoin(t.appointments, eq(t.appointments.id, t.appointmentServices.appointmentId))
        .where(
          appt(
            and(
              gte(t.appointments.startsAt, new Date(now.getTime() - 30 * 86_400_000)),
              inArray(t.appointments.status, ['confirmed', 'completed', 'pending']),
            ),
          ),
        )
        .groupBy(t.appointmentServices.serviceName)
        .orderBy(desc(sql`count(*)`))
        .limit(6),
      db
        .select({
          kind: t.appointmentEvents.kind,
          createdAt: t.appointmentEvents.createdAt,
          actorType: t.appointmentEvents.actorType,
          appointmentId: t.appointments.id,
          reference: t.appointments.reference,
          customerName: t.customers.name,
        })
        .from(t.appointmentEvents)
        .innerJoin(t.appointments, eq(t.appointments.id, t.appointmentEvents.appointmentId))
        .innerJoin(t.customers, eq(t.customers.id, t.appointments.customerId))
        .where(and(appt(undefined), lt(t.appointmentEvents.createdAt, now)))
        .orderBy(desc(t.appointmentEvents.createdAt))
        .limit(10),
      session.permissions.includes('audit.view') || session.permissions.includes('settings.view')
        ? db
            .select()
            .from(t.auditLog)
            .where(eq(t.auditLog.salonId, salonId))
            .orderBy(desc(t.auditLog.createdAt))
            .limit(5)
        : Promise.resolve([]),
    ])

  const revenue = canSeeMoney
    ? {
        today: await revenueBetween(salonId, dayStart, dayEnd),
        week: await revenueBetween(salonId, weekStart, dayEnd),
        month: await revenueBetween(salonId, monthStart, nextMonth),
        daily: await dailyRevenue(salonId, addDays(today, -13), today),
      }
    : null

  const staffToday = await availableStaffToday(salonId, today, scope ? session.staffId : null)

  return {
    today,
    todayList,
    counts: {
      today: todayList.length,
      upcoming,
      completedMonth,
      pending: pendingRequests.length,
      cancelledMonth,
      noShowMonth,
    },
    pendingRequests,
    popular,
    revenue,
    staffToday,
    activity: [
      ...events.map((e) => ({
        type: 'event' as const,
        at: e.createdAt,
        kind: e.kind,
        actorType: e.actorType,
        reference: e.reference,
        appointmentId: e.appointmentId,
        customerName: e.customerName,
      })),
      ...audits.map((a) => ({ type: 'audit' as const, at: a.createdAt, summary: a.summary })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, 10),
  }
}

export async function dailyRevenue(salonId: string, from: DateKey, to: DateKey) {
  const rows = await db.execute<{ day: string; total: number }>(sql`
    select to_char((paid_at at time zone 'Asia/Ulaanbaatar')::date, 'YYYY-MM-DD') as day, sum(amount)::int as total
    from salon.payments
    where salon_id = ${salonId} and status = 'paid'
      and paid_at >= ${dayBounds(from).start} and paid_at < ${dayBounds(to).end}
    group by 1 order by 1`)
  const byDay = new Map(rows.rows.map((r) => [r.day, Number(r.total)]))
  const out: { day: DateKey; total: number }[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ day: d, total: byDay.get(d) ?? 0 })
  return out
}

/** Specialists working today with booked vs. scheduled minutes. */
export async function availableStaffToday(salonId: string, today: DateKey, onlyStaffId: string | null) {
  const weekday = weekdayOf(today)
  const { start, end } = dayBounds(today)
  const rows = await db
    .select({
      id: t.staff.id,
      name: t.staff.displayName,
      title: t.staff.title,
      photoUrl: t.staff.photoUrl,
      color: t.staff.calendarColor,
      isWorking: t.staffSchedules.isWorking,
      startsAt: t.staffSchedules.startsAt,
      endsAt: t.staffSchedules.endsAt,
    })
    .from(t.staff)
    .leftJoin(t.staffSchedules, and(eq(t.staffSchedules.staffId, t.staff.id), eq(t.staffSchedules.weekday, weekday)))
    .where(
      and(
        eq(t.staff.salonId, salonId),
        eq(t.staff.isActive, true),
        onlyStaffId ? eq(t.staff.id, onlyStaffId) : undefined,
      ),
    )
    .orderBy(t.staff.sortOrder)
  const ids = rows.map((r) => r.id)
  if (!ids.length) return []
  const [booked, off] = await Promise.all([
    db
      .select({ staffId: t.appointments.staffId, minutes: sql<number>`sum(${t.appointments.durationMinutes})::int` })
      .from(t.appointments)
      .where(
        and(
          inArray(t.appointments.staffId, ids),
          gte(t.appointments.startsAt, start),
          lt(t.appointments.startsAt, end),
          inArray(t.appointments.status, [...COUNTED]),
        ),
      )
      .groupBy(t.appointments.staffId),
    db
      .select({
        staffId: t.staffTimeOff.staffId,
        startsAt: t.staffTimeOff.startsAt,
        endsAt: t.staffTimeOff.endsAt,
        kind: t.staffTimeOff.kind,
      })
      .from(t.staffTimeOff)
      .where(
        and(
          inArray(t.staffTimeOff.staffId, ids),
          lt(t.staffTimeOff.startsAt, end),
          sql`${t.staffTimeOff.endsAt} > ${start}`,
        ),
      ),
  ])
  return rows.map((r) => {
    const timeOff = off.find((o) => o.staffId === r.id)
    const fullDayOff = Boolean(timeOff && timeOff.startsAt <= start && timeOff.endsAt >= end)
    const working = Boolean(r.isWorking) && !fullDayOff
    const shiftMinutes = working && r.startsAt !== null && r.endsAt !== null ? r.endsAt - r.startsAt : 0
    return {
      ...r,
      working,
      timeOff: timeOff ? { kind: timeOff.kind, fullDay: fullDayOff } : null,
      shiftMinutes,
      bookedMinutes: booked.find((b) => b.staffId === r.id)?.minutes ?? 0,
    }
  })
}
