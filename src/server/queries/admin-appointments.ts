import 'server-only'
import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm'
import { dateKeyOf, dayBounds, type DateKey } from '@/lib/datetime'
import { maskPhone } from '@/lib/phone'
import { db } from '@/server/db'
import * as t from '@/server/db/schema'
import type { SessionActor } from '@/server/auth/session'

export const LIST_TABS = {
  upcoming: 'Ирэх',
  pending: 'Хүсэлт',
  today: 'Өнөөдөр',
  completed: 'Дууссан',
  cancelled: 'Цуцалсан',
  no_show: 'Ирээгүй',
  all: 'Бүгд',
} as const
export type ListTab = keyof typeof LIST_TABS

export function canSeeContacts(session: SessionActor) {
  return session.permissions.includes('customers.contact') && !session.isDemo
}

/** Demo visitors and roles without contact permission see masked numbers. */
export function displayPhone(session: SessionActor, phone: string) {
  return canSeeContacts(session) ? phone : maskPhone(phone)
}

export async function listAppointments(
  session: SessionActor,
  opts: { tab: ListTab; staffId: string | null; q: string | null; from: DateKey | null; to: DateKey | null; page: number; now: Date },
) {
  const where: (SQL | undefined)[] = [eq(t.appointments.salonId, session.salonId)]
  if (session.role === 'specialist' && session.staffId) where.push(eq(t.appointments.staffId, session.staffId))
  if (opts.staffId) where.push(eq(t.appointments.staffId, opts.staffId))
  const today = dateKeyOf(opts.now)
  switch (opts.tab) {
    case 'upcoming':
      where.push(gte(t.appointments.startsAt, opts.now), inArray(t.appointments.status, ['pending', 'confirmed', 'awaiting_deposit']))
      break
    case 'pending':
      where.push(inArray(t.appointments.status, ['pending', 'awaiting_deposit']))
      break
    case 'today':
      where.push(gte(t.appointments.startsAt, dayBounds(today).start), lt(t.appointments.startsAt, dayBounds(today).end))
      break
    case 'completed':
      where.push(eq(t.appointments.status, 'completed'))
      break
    case 'cancelled':
      where.push(inArray(t.appointments.status, ['cancelled', 'rejected', 'expired', 'rescheduled']))
      break
    case 'no_show':
      where.push(eq(t.appointments.status, 'no_show'))
      break
  }
  if (opts.from) where.push(gte(t.appointments.startsAt, dayBounds(opts.from).start))
  if (opts.to) where.push(lt(t.appointments.startsAt, dayBounds(opts.to).end))
  if (opts.q) {
    const q = `%${opts.q.replace(/[%_]/g, '')}%`
    where.push(or(ilike(t.customers.name, q), ilike(t.appointments.reference, q), ilike(t.customers.phone, q.replace(/\s/g, ''))))
  }
  const pageSize = 25
  const ascending = opts.tab === 'upcoming' || opts.tab === 'pending' || opts.tab === 'today'
  const rows = await db
    .select({
      id: t.appointments.id,
      reference: t.appointments.reference,
      status: t.appointments.status,
      source: t.appointments.source,
      startsAt: t.appointments.startsAt,
      endsAt: t.appointments.endsAt,
      total: t.appointments.totalPrice,
      hasFromPrice: t.appointments.hasFromPrice,
      depositAmount: t.appointments.depositAmount,
      isDemo: t.appointments.isDemo,
      demoVisitorHash: t.appointments.demoVisitorHash,
      customerName: t.customers.name,
      customerPhone: t.customers.phone,
      staffName: t.staff.displayName,
      staffColor: t.staff.calendarColor,
      services: sql<string>`(select string_agg(service_name, ', ' order by sort_order) from salon.appointment_services s where s.appointment_id = ${t.appointments.id})`,
      paid: sql<number>`(select coalesce(sum(amount), 0)::int from salon.payments p where p.appointment_id = ${t.appointments.id} and p.status = 'paid')`,
      total_count: sql<number>`count(*) over ()::int`,
    })
    .from(t.appointments)
    .innerJoin(t.customers, eq(t.customers.id, t.appointments.customerId))
    .innerJoin(t.staff, eq(t.staff.id, t.appointments.staffId))
    .where(and(...where))
    .orderBy(ascending ? asc(t.appointments.startsAt) : desc(t.appointments.startsAt))
    .limit(pageSize)
    .offset((opts.page - 1) * pageSize)
  return {
    rows: rows.map((r) => ({ ...r, customerPhone: displayPhone(session, r.customerPhone) })),
    total: rows[0]?.total_count ?? 0,
    pageSize,
  }
}

export async function loadAppointmentDetail(session: SessionActor, id: string) {
  const [row] = await db
    .select({ a: t.appointments, customer: t.customers, staff: t.staff })
    .from(t.appointments)
    .innerJoin(t.customers, eq(t.customers.id, t.appointments.customerId))
    .innerJoin(t.staff, eq(t.staff.id, t.appointments.staffId))
    .where(and(eq(t.appointments.id, id), eq(t.appointments.salonId, session.salonId)))
  if (!row) return null
  if (session.role === 'specialist' && row.a.staffId !== session.staffId) return null
  const [lines, addons, payments, events, cancellations, notifications, replacement, previous, admins] = await Promise.all([
    db.select().from(t.appointmentServices).where(eq(t.appointmentServices.appointmentId, id)).orderBy(asc(t.appointmentServices.sortOrder)),
    db.select().from(t.appointmentAddons).where(eq(t.appointmentAddons.appointmentId, id)),
    db.select().from(t.payments).where(eq(t.payments.appointmentId, id)).orderBy(asc(t.payments.createdAt)),
    db.select().from(t.appointmentEvents).where(eq(t.appointmentEvents.appointmentId, id)).orderBy(desc(t.appointmentEvents.createdAt)),
    db.select().from(t.cancellationRecords).where(eq(t.cancellationRecords.appointmentId, id)),
    db.select().from(t.notifications).where(eq(t.notifications.appointmentId, id)).orderBy(desc(t.notifications.createdAt)),
    db.select({ id: t.appointments.id, reference: t.appointments.reference }).from(t.appointments).where(eq(t.appointments.rescheduledFromId, id)),
    row.a.rescheduledFromId
      ? db.select({ id: t.appointments.id, reference: t.appointments.reference }).from(t.appointments).where(eq(t.appointments.id, row.a.rescheduledFromId))
      : Promise.resolve([]),
    db.select({ id: t.adminUsers.id, name: t.adminUsers.name }).from(t.adminUsers).where(eq(t.adminUsers.salonId, session.salonId)),
  ])
  const adminName = new Map(admins.map((a) => [a.id, a.name]))
  const [stats] = await db
    .select({
      visits: sql<number>`count(*) filter (where status = 'completed')::int`,
      cancellations: sql<number>`count(*) filter (where status = 'cancelled')::int`,
      noShows: sql<number>`count(*) filter (where status = 'no_show')::int`,
    })
    .from(t.appointments)
    .where(eq(t.appointments.customerId, row.customer.id))
  return {
    appointment: row.a,
    customer: { ...row.customer, phone: displayPhone(session, row.customer.phone), email: canSeeContacts(session) ? row.customer.email : row.customer.email ? '•••@•••' : null },
    customerStats: stats,
    staff: row.staff,
    lines: lines.map((l) => ({ ...l, addons: addons.filter((a) => a.appointmentServiceId === l.id) })),
    payments,
    events: events.map((e) => ({ ...e, actorName: e.actorAdminId ? (adminName.get(e.actorAdminId) ?? null) : null })),
    cancellations,
    notifications,
    replacement: replacement[0] ?? null,
    previous: previous[0] ?? null,
    ownDemoBooking: Boolean(session.demoVisitorHash && row.a.demoVisitorHash === session.demoVisitorHash),
  }
}

export async function staffOptions(salonId: string) {
  return db
    .select({ id: t.staff.id, name: t.staff.displayName, color: t.staff.calendarColor })
    .from(t.staff)
    .where(and(eq(t.staff.salonId, salonId), eq(t.staff.isActive, true)))
    .orderBy(asc(t.staff.sortOrder))
}
