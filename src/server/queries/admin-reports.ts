// Reports and payments read models — computed from appointment, payment and
// schedule rows (no stored aggregates, nothing hard-coded).
import 'server-only'
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import {
  addDays,
  dateKeyOf,
  dayBounds,
  diffDays,
  firstOfMonth,
  addMonths,
  weekdayOf,
  type DateKey,
} from '@/lib/datetime'
import { db } from '@/server/db'
import * as t from '@/server/db/schema'
import { dailyRevenue } from './admin-dashboard'

export type ReportPeriod = '30d' | 'this_month' | 'last_month' | '90d'

export function periodRange(period: ReportPeriod, now: Date): { from: DateKey; to: DateKey; label: string } {
  const today = dateKeyOf(now)
  switch (period) {
    case 'this_month':
      return { from: firstOfMonth(today), to: today, label: 'Энэ сар' }
    case 'last_month': {
      const from = addMonths(today, -1)
      return { from, to: addDays(firstOfMonth(today), -1), label: 'Өмнөх сар' }
    }
    case '90d':
      return { from: addDays(today, -89), to: today, label: 'Сүүлийн 90 хоног' }
    default:
      return { from: addDays(today, -29), to: today, label: 'Сүүлийн 30 хоног' }
  }
}

export async function loadReports(salonId: string, period: ReportPeriod, now: Date) {
  const range = periodRange(period, now)
  const start = dayBounds(range.from).start
  const end = dayBounds(range.to).end
  const inRange = and(
    eq(t.appointments.salonId, salonId),
    gte(t.appointments.startsAt, start),
    lt(t.appointments.startsAt, end),
  )

  const [statusRows, sourceRows, serviceRows, staffRows, revenueRows, daily, retention] = await Promise.all([
    db
      .select({ status: t.appointments.status, n: sql<number>`count(*)::int` })
      .from(t.appointments)
      .where(inRange)
      .groupBy(t.appointments.status),
    db
      .select({ source: t.appointments.source, n: sql<number>`count(*)::int` })
      .from(t.appointments)
      .where(inRange)
      .groupBy(t.appointments.source),
    db
      .select({
        name: t.appointmentServices.serviceName,
        n: sql<number>`count(*)::int`,
        revenue: sql<number>`coalesce(sum(${t.appointmentServices.price}) filter (where ${t.appointments.status} = 'completed'), 0)::int`,
      })
      .from(t.appointmentServices)
      .innerJoin(t.appointments, eq(t.appointments.id, t.appointmentServices.appointmentId))
      .where(and(inRange, inArray(t.appointments.status, ['completed', 'confirmed', 'pending', 'no_show'])))
      .groupBy(t.appointmentServices.serviceName)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
    db
      .select({
        staffId: t.staff.id,
        name: t.staff.displayName,
        color: t.staff.calendarColor,
        completed: sql<number>`count(*) filter (where ${t.appointments.status} = 'completed')::int`,
        noShows: sql<number>`count(*) filter (where ${t.appointments.status} = 'no_show')::int`,
        cancelled: sql<number>`count(*) filter (where ${t.appointments.status} = 'cancelled')::int`,
        revenue: sql<number>`coalesce(sum(${t.appointments.totalPrice}) filter (where ${t.appointments.status} = 'completed'), 0)::int`,
        bookedMinutes: sql<number>`coalesce(sum(${t.appointments.durationMinutes}) filter (where ${t.appointments.status} in ('completed','confirmed','no_show','pending')), 0)::int`,
      })
      .from(t.staff)
      .leftJoin(
        t.appointments,
        and(
          eq(t.appointments.staffId, t.staff.id),
          gte(t.appointments.startsAt, start),
          lt(t.appointments.startsAt, end),
        ),
      )
      .where(eq(t.staff.salonId, salonId))
      .groupBy(t.staff.id, t.staff.displayName, t.staff.calendarColor),
    db
      .select({
        paid: sql<number>`coalesce(sum(${t.payments.amount}) filter (where ${t.payments.status} = 'paid'), 0)::int`,
        refunded: sql<number>`coalesce(sum(${t.payments.amount}) filter (where ${t.payments.status} = 'refunded'), 0)::int`,
      })
      .from(t.payments)
      .where(and(eq(t.payments.salonId, salonId), gte(t.payments.paidAt, start), lt(t.payments.paidAt, end))),
    dailyRevenue(salonId, range.from, range.to),
    db.execute<{ customers: number; returning: number; new_customers: number }>(sql`
      with visits as (
        select customer_id, min(starts_at) as first_ever,
               count(*) filter (where starts_at >= ${start} and starts_at < ${end}) as in_period
        from salon.appointments where salon_id = ${salonId} and status = 'completed' group by customer_id)
      select count(*) filter (where in_period > 0)::int as customers,
             count(*) filter (where in_period > 0 and first_ever < ${start})::int as returning,
             count(*) filter (where in_period > 0 and first_ever >= ${start})::int as new_customers
      from visits`),
  ])

  // Scheduled minutes per specialist over the period, for utilisation.
  const schedules = await db
    .select()
    .from(t.staffSchedules)
    .innerJoin(t.staff, eq(t.staff.id, t.staffSchedules.staffId))
    .where(eq(t.staff.salonId, salonId))
  const days = diffDays(range.to, range.from) + 1
  const scheduled = new Map<string, number>()
  for (let i = 0; i < days; i++) {
    const wd = weekdayOf(addDays(range.from, i))
    for (const r of schedules) {
      if (r.staff_schedules.weekday === wd && r.staff_schedules.isWorking) {
        scheduled.set(
          r.staff.id,
          (scheduled.get(r.staff.id) ?? 0) + (r.staff_schedules.endsAt - r.staff_schedules.startsAt),
        )
      }
    }
  }

  const count = (s: string) => statusRows.find((r) => r.status === s)?.n ?? 0
  const completed = count('completed')
  const noShow = count('no_show')
  const cancelled = count('cancelled')
  const decided = completed + noShow + cancelled
  const total = statusRows.reduce((s, r) => s + r.n, 0)
  const r = retention.rows[0] ?? { customers: 0, returning: 0, new_customers: 0 }

  return {
    range,
    totals: {
      total,
      completed,
      noShow,
      cancelled,
      rescheduled: count('rescheduled'),
      pending: count('pending') + count('awaiting_deposit'),
      completionRate: decided ? completed / decided : 0,
      cancellationRate: total ? cancelled / total : 0,
      noShowRate: completed + noShow ? noShow / (completed + noShow) : 0,
    },
    revenue: { paid: revenueRows[0]?.paid ?? 0, refunded: revenueRows[0]?.refunded ?? 0, daily },
    services: serviceRows,
    staff: staffRows.map((s) => ({
      ...s,
      scheduledMinutes: scheduled.get(s.staffId) ?? 0,
      utilisation: scheduled.get(s.staffId) ? s.bookedMinutes / scheduled.get(s.staffId)! : 0,
    })),
    sources: sourceRows,
    retention: {
      customers: Number(r.customers),
      returning: Number(r.returning),
      newCustomers: Number(r.new_customers),
    },
  }
}

export type PaymentFilter = 'all' | 'paid' | 'pending' | 'refunded' | 'outstanding'

export const PAYMENTS_PAGE_SIZE = 30

export async function loadPayments(salonId: string, filter: PaymentFilter, now: Date, page = 1) {
  const monthStart = dayBounds(firstOfMonth(dateKeyOf(now))).start
  const rowsWhere = and(
    eq(t.payments.salonId, salonId),
    filter === 'paid'
      ? eq(t.payments.status, 'paid')
      : filter === 'pending'
        ? eq(t.payments.status, 'pending')
        : filter === 'refunded'
          ? eq(t.payments.status, 'refunded')
          : undefined,
  )
  const [summary, methods, rows, rowCount, outstanding] = await Promise.all([
    db
      .select({
        paidMonth: sql<number>`coalesce(sum(amount) filter (where status = 'paid' and paid_at >= ${monthStart}), 0)::int`,
        pendingDeposits: sql<number>`coalesce(sum(amount) filter (where status = 'pending'), 0)::int`,
        pendingCount: sql<number>`count(*) filter (where status = 'pending')::int`,
        refundedMonth: sql<number>`coalesce(sum(amount) filter (where status = 'refunded' and updated_at >= ${monthStart}), 0)::int`,
        depositsHeld: sql<number>`coalesce(sum(amount) filter (where status = 'paid' and kind = 'deposit'), 0)::int`,
      })
      .from(t.payments)
      .where(eq(t.payments.salonId, salonId)),
    db
      .select({
        method: t.payments.method,
        total: sql<number>`coalesce(sum(${t.payments.amount}), 0)::int`,
        n: sql<number>`count(*)::int`,
      })
      .from(t.payments)
      .where(and(eq(t.payments.salonId, salonId), eq(t.payments.status, 'paid'), gte(t.payments.paidAt, monthStart)))
      .groupBy(t.payments.method),
    db
      .select({
        id: t.payments.id,
        kind: t.payments.kind,
        method: t.payments.method,
        status: t.payments.status,
        amount: t.payments.amount,
        provider: t.payments.provider,
        verifiedBy: t.payments.verifiedBy,
        paidAt: t.payments.paidAt,
        createdAt: t.payments.createdAt,
        note: t.payments.note,
        appointmentId: t.appointments.id,
        reference: t.appointments.reference,
        customerName: t.customers.name,
      })
      .from(t.payments)
      .innerJoin(t.appointments, eq(t.appointments.id, t.payments.appointmentId))
      .innerJoin(t.customers, eq(t.customers.id, t.appointments.customerId))
      .where(rowsWhere)
      .orderBy(desc(t.payments.createdAt))
      .limit(PAYMENTS_PAGE_SIZE)
      .offset((page - 1) * PAYMENTS_PAGE_SIZE),
    db.$count(t.payments, rowsWhere),
    db.execute<{
      id: string
      reference: string
      customer_name: string
      starts_at: string
      total: number
      paid: number
      status: string
    }>(sql`
      select a.id, a.reference, c.name as customer_name, a.starts_at, a.total_price as total, a.status,
             coalesce((select sum(p.amount) from salon.payments p where p.appointment_id = a.id and p.status = 'paid'), 0)::int as paid
      from salon.appointments a join salon.customers c on c.id = a.customer_id
      where a.salon_id = ${salonId} and a.status in ('completed', 'confirmed') and a.starts_at < ${now}
      order by a.starts_at desc limit 200`),
  ])
  return {
    summary: summary[0],
    methods,
    rows,
    rowCount,
    outstanding: outstanding.rows.filter((o) => Number(o.paid) < Number(o.total)).slice(0, 30),
  }
}
