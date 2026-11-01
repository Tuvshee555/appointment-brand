// The customer's view of one booking. Access requires the private manage
// token from the confirmation link, or a signed lookup cookie issued after
// the customer proved the phone number on the booking.
import 'server-only'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { STATUS_EXPLANATIONS, STATUS_LABELS, type AppointmentStatus } from '@/lib/booking/status'
import { BASE_PATH } from '@/lib/base-path'
import { db } from '@/server/db'
import * as t from '@/server/db/schema'
import { hmac, sha256Hex, verifyHmac } from '@/server/security/crypto'
import { resolveSalonId } from '@/server/services/salon'

const LOOKUP_COOKIE = 'sv_lookup'
const LOOKUP_TTL_MS = 2 * 60 * 60 * 1000

/** Signed list of references the visitor proved ownership of (2 hours). */
export async function grantLookup(reference: string) {
  const jar = await cookies()
  const current = readLookup(jar.get(LOOKUP_COOKIE)?.value).filter((r) => r !== reference)
  const refs = [...current, reference].slice(-5)
  const payload = `${Date.now() + LOOKUP_TTL_MS}|${refs.join(',')}`
  jar.set(LOOKUP_COOKIE, `${payload}|${hmac(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: BASE_PATH || '/',
    maxAge: LOOKUP_TTL_MS / 1000,
  })
}

function readLookup(value: string | undefined): string[] {
  if (!value) return []
  const parts = value.split('|')
  if (parts.length !== 3) return []
  const [expires, refs, sig] = parts
  if (!verifyHmac(`${expires}|${refs}`, sig) || Number(expires) < Date.now()) return []
  return refs.split(',').filter(Boolean)
}

export type BookingAccess = { reference: string; token?: string | null }

/** Returns the appointment id when the caller may view/manage it, else null. */
export async function authorizeBooking(access: BookingAccess): Promise<{ id: string; salonId: string } | null> {
  const salonId = await resolveSalonId(db)
  const [appt] = await db
    .select({ id: t.appointments.id, manageTokenHash: t.appointments.manageTokenHash })
    .from(t.appointments)
    .where(and(eq(t.appointments.salonId, salonId), eq(t.appointments.reference, access.reference)))
  if (!appt) return null
  if (access.token && appt.manageTokenHash && sha256Hex(access.token) === appt.manageTokenHash) return { id: appt.id, salonId }
  const jar = await cookies()
  if (readLookup(jar.get(LOOKUP_COOKIE)?.value).includes(access.reference)) return { id: appt.id, salonId }
  return null
}

export interface CustomerBooking {
  id: string
  reference: string
  status: AppointmentStatus
  statusLabel: string
  explanation: string
  startsAt: string
  endsAt: string
  durationMinutes: number
  staffName: string
  staffRequested: boolean
  staffId: string
  customerName: string
  customerPhone: string
  customerNote: string | null
  total: number
  hasFromPrice: boolean
  depositAmount: number
  holdExpiresAt: string | null
  lines: { name: string; price: number; priceType: 'fixed' | 'from'; durationMinutes: number; serviceId: string | null; addons: { name: string; price: number; addonId: string | null }[] }[]
  payments: { id: string; kind: string; status: string; amount: number; provider: string; paidAt: string | null }[]
  history: { kind: string; at: string; note: string | null; toStatus: string | null }[]
  replacement: { reference: string } | null
  previous: { reference: string } | null
  isDemo: boolean
  ownDemoBooking: boolean
}

export async function loadCustomerBooking(appointmentId: string, demoVisitorHash: string | null): Promise<CustomerBooking | null> {
  const [row] = await db
    .select({ a: t.appointments, staffName: t.staff.name, customerName: t.customers.name, customerPhone: t.customers.phone })
    .from(t.appointments)
    .innerJoin(t.staff, eq(t.staff.id, t.appointments.staffId))
    .innerJoin(t.customers, eq(t.customers.id, t.appointments.customerId))
    .where(eq(t.appointments.id, appointmentId))
  if (!row) return null
  const a = row.a
  const [lines, addons, payments, events, replacement, previous] = await Promise.all([
    db.select().from(t.appointmentServices).where(eq(t.appointmentServices.appointmentId, a.id)).orderBy(asc(t.appointmentServices.sortOrder)),
    db.select().from(t.appointmentAddons).where(eq(t.appointmentAddons.appointmentId, a.id)),
    db.select().from(t.payments).where(eq(t.payments.appointmentId, a.id)).orderBy(asc(t.payments.createdAt)),
    db
      .select()
      .from(t.appointmentEvents)
      .where(and(eq(t.appointmentEvents.appointmentId, a.id), inArray(t.appointmentEvents.kind, ['created', 'confirmed', 'deposit_paid', 'cancelled', 'rejected', 'rescheduled', 'completed', 'no_show', 'hold_expired', 'request_expired'])))
      .orderBy(desc(t.appointmentEvents.createdAt)),
    db.select({ reference: t.appointments.reference }).from(t.appointments).where(eq(t.appointments.rescheduledFromId, a.id)),
    a.rescheduledFromId ? db.select({ reference: t.appointments.reference }).from(t.appointments).where(eq(t.appointments.id, a.rescheduledFromId)) : Promise.resolve([]),
  ])
  return {
    id: a.id,
    reference: a.reference,
    status: a.status,
    statusLabel: STATUS_LABELS[a.status],
    explanation: STATUS_EXPLANATIONS[a.status],
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    durationMinutes: a.durationMinutes,
    staffName: row.staffName,
    staffRequested: a.staffRequested,
    staffId: a.staffId,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    customerNote: a.customerNote,
    total: a.totalPrice,
    hasFromPrice: a.hasFromPrice,
    depositAmount: a.depositAmount,
    holdExpiresAt: a.holdExpiresAt?.toISOString() ?? null,
    lines: lines.map((l) => ({
      name: l.serviceName,
      price: l.price,
      priceType: l.priceType,
      durationMinutes: l.durationMinutes,
      serviceId: l.serviceId,
      addons: addons.filter((x) => x.appointmentServiceId === l.id).map((x) => ({ name: x.addonName, price: x.price, addonId: x.addonId })),
    })),
    payments: payments.map((p) => ({ id: p.id, kind: p.kind, status: p.status, amount: p.amount, provider: p.provider, paidAt: p.paidAt?.toISOString() ?? null })),
    history: events.map((e) => ({ kind: e.kind, at: e.createdAt.toISOString(), note: e.kind === 'created' ? null : e.note, toStatus: e.toStatus })),
    replacement: replacement[0] ?? null,
    previous: previous[0] ?? null,
    isDemo: a.isDemo,
    ownDemoBooking: Boolean(demoVisitorHash && a.demoVisitorHash === demoVisitorHash),
  }
}
