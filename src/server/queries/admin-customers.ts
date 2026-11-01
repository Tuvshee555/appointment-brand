import 'server-only'
import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/server/db'
import * as t from '@/server/db/schema'
import type { SessionActor } from '@/server/auth/session'
import { canSeeContacts, displayPhone } from './admin-appointments'

export type CustomerFilter = 'all' | 'upcoming' | 'regular' | 'no_show' | 'new'

export async function listCustomers(
  session: SessionActor,
  opts: { q: string | null; filter: CustomerFilter; page: number },
) {
  const where: (SQL | undefined)[] = [eq(t.customers.salonId, session.salonId)]
  if (opts.q) {
    const q = `%${opts.q.replace(/[%_]/g, '')}%`
    where.push(or(ilike(t.customers.name, q), ilike(t.customers.phone, q.replace(/\s/g, ''))))
  }
  // Kept as a nested fragment: in a single-table select drizzle strips the table qualifier from
  // columns at the top level of a field, which would turn the correlation into an ambiguous "id".
  const stats = sql`(
    select coalesce(count(*) filter (where a.status = 'completed'), 0)::int as visits,
           coalesce(count(*) filter (where a.status = 'cancelled'), 0)::int as cancellations,
           coalesce(count(*) filter (where a.status = 'no_show'), 0)::int as no_shows,
           max(a.starts_at) filter (where a.status = 'completed') as last_visit,
           min(a.starts_at) filter (where a.status in ('pending','confirmed','awaiting_deposit') and a.starts_at > now()) as next_visit,
           (select coalesce(sum(p.amount), 0)::int from salon.payments p join salon.appointments pa on pa.id = p.appointment_id
             where pa.customer_id = ${t.customers.id} and p.status = 'paid') as spent
    from salon.appointments a where a.customer_id = ${t.customers.id})`
  const rows = await db
    .select({
      id: t.customers.id,
      name: t.customers.name,
      phone: t.customers.phone,
      email: t.customers.email,
      isDemo: t.customers.isDemo,
      createdAt: t.customers.createdAt,
      stats: sql<{
        visits: number
        cancellations: number
        no_shows: number
        last_visit: string | null
        next_visit: string | null
        spent: number
      }>`(select row_to_json(s) from ${stats} s)`,
    })
    .from(t.customers)
    .where(and(...where))
    .orderBy(asc(t.customers.name))
  let list = rows
  if (opts.filter === 'upcoming') list = rows.filter((r) => r.stats.next_visit)
  if (opts.filter === 'regular') list = rows.filter((r) => r.stats.visits >= 3)
  if (opts.filter === 'no_show') list = rows.filter((r) => r.stats.no_shows > 0)
  if (opts.filter === 'new') list = rows.filter((r) => r.stats.visits <= 1)
  const pageSize = 30
  return {
    total: list.length,
    pageSize,
    rows: list
      .slice((opts.page - 1) * pageSize, opts.page * pageSize)
      .map((r) => ({ ...r, phone: displayPhone(session, r.phone), email: canSeeContacts(session) ? r.email : null })),
  }
}

export async function loadCustomer(session: SessionActor, id: string) {
  const [customer] = await db
    .select()
    .from(t.customers)
    .where(and(eq(t.customers.id, id), eq(t.customers.salonId, session.salonId)))
  if (!customer) return null
  const [appointments, cancellations, spent] = await Promise.all([
    db
      .select({
        id: t.appointments.id,
        reference: t.appointments.reference,
        status: t.appointments.status,
        startsAt: t.appointments.startsAt,
        total: t.appointments.totalPrice,
        hasFromPrice: t.appointments.hasFromPrice,
        source: t.appointments.source,
        staffName: t.staff.displayName,
        services: sql<string>`(select string_agg(service_name, ', ' order by sort_order) from salon.appointment_services s where s.appointment_id = ${t.appointments.id})`,
      })
      .from(t.appointments)
      .innerJoin(t.staff, eq(t.staff.id, t.appointments.staffId))
      .where(eq(t.appointments.customerId, id))
      .orderBy(desc(t.appointments.startsAt)),
    db
      .select({
        reference: t.appointments.reference,
        createdAt: t.cancellationRecords.createdAt,
        noticeHours: t.cancellationRecords.noticeHours,
        withinPolicy: t.cancellationRecords.withinPolicy,
        reasonText: t.cancellationRecords.reasonText,
        cancelledBy: t.cancellationRecords.cancelledBy,
      })
      .from(t.cancellationRecords)
      .innerJoin(t.appointments, eq(t.appointments.id, t.cancellationRecords.appointmentId))
      .where(eq(t.appointments.customerId, id))
      .orderBy(desc(t.cancellationRecords.createdAt)),
    db.execute<{ total: number }>(
      sql`select coalesce(sum(p.amount), 0)::int as total from salon.payments p join salon.appointments a on a.id = p.appointment_id where a.customer_id = ${id} and p.status = 'paid'`,
    ),
  ])
  return {
    customer: {
      ...customer,
      phone: displayPhone(session, customer.phone),
      email: canSeeContacts(session) ? customer.email : customer.email ? '•••@•••' : null,
    },
    appointments,
    cancellations,
    spent: Number(spent.rows[0]?.total ?? 0),
    visits: appointments.filter((a) => a.status === 'completed').length,
    noShows: appointments.filter((a) => a.status === 'no_show').length,
  }
}
