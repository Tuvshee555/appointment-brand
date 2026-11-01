// Appointment lifecycle: create, confirm/reject/cancel/complete/no-show,
// reschedule and deposit-hold expiry. All writes run in transactions; the
// slot is re-validated against fresh rows under a per-salon-day advisory
// lock, and the database exclusion constraint backs it up.
import { randomInt } from 'node:crypto'
import { and, asc, eq, lt, sql } from 'drizzle-orm'
import { isStaffFree, pickStaff, preliminaryDayState, salonHoursFor } from '@/lib/availability/engine'
import type { Quote, SelectionItem } from '@/lib/booking/pricing'
import {
  canTransition,
  STATUS_LABELS,
  type AppointmentStatus,
  type CancellationReason,
  type TransitionActor,
} from '@/lib/booking/status'
import { dateKeyOf, formatDateTime, ubToUtc, type DateKey } from '@/lib/datetime'
import type { Database } from '@/server/db/client'
import * as t from '@/server/db/schema'
import { ERR, ServiceError, type ServiceContext } from '@/server/context'
import { deliverNotification, queueNotification, type NotificationKind } from '@/server/notifications'
import { randomToken, sha256Hex } from '@/server/security/crypto'
import {
  bookedMinutesOn,
  loadStaffScheduleData,
  lockSalonDay,
  nextAvailableSlots,
  prepareSelection,
  staffDayFor,
  type PreparedSelection,
} from './availability'
import { loadSpecialDays } from './salon'

type AppointmentRow = typeof t.appointments.$inferSelect

const REFERENCE_ALPHABET = 'ACDEFHJKLMNPQRTUVWXY34679'

export function newReference(): string {
  let code = ''
  for (let i = 0; i < 6; i++) code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)]
  return `SV-${code}`
}

export function pgErrorCode(err: unknown): string | null {
  let e: unknown = err
  for (let depth = 0; e && depth < 4; depth++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string') return code
    e = (e as { cause?: unknown }).cause
  }
  return null
}

function pgConstraint(err: unknown): string | null {
  let e: unknown = err
  for (let depth = 0; e && depth < 4; depth++) {
    const c = (e as { constraint?: unknown }).constraint
    if (typeof c === 'string') return c
    e = (e as { cause?: unknown }).cause
  }
  return null
}

export interface CustomerInput {
  name: string
  phone: string
  email: string | null
  note: string | null
  preferences: string | null
}

export interface CreateBookingOptions {
  source: (typeof t.appointmentSource.enumValues)[number]
  actor: 'customer' | 'staff' | 'assistant'
  /** Public rules: minimum notice, booking window, online-bookable staff, deposit and approval policy. */
  publicRules: boolean
  isDemo: boolean
  demoVisitorHash?: string | null
  /** Staff-created bookings choose their own status. */
  staffStatus?: 'confirmed' | 'pending'
  internalNote?: string | null
}

export interface BookingResult {
  appointmentId: string
  reference: string
  status: AppointmentStatus
  startsAt: string
  endsAt: string
  staffId: string
  staffName: string
  /** Shown once to the customer; only its hash is stored. */
  manageToken: string
  depositAmount: number
  depositPaymentId: string | null
  holdExpiresAt: string | null
  quote: Quote
}

interface VarsSource {
  salonName: string
  reference: string
  customerName: string
  customerPhone: string
  staffName: string
  startsAt: Date
  services: string
  status: AppointmentStatus
  address?: string
  amount?: number
}

function vars(v: VarsSource) {
  return { ...v, statusLabel: STATUS_LABELS[v.status] }
}

/** Expires unpaid deposit holds whose time has passed (releases their slots). */
export async function expireStaleHolds(db: Database, salonId: string, now: Date): Promise<number> {
  const expired = await db
    .update(t.appointments)
    .set({ status: 'expired', updatedAt: now })
    .where(
      and(
        eq(t.appointments.salonId, salonId),
        eq(t.appointments.status, 'awaiting_deposit'),
        lt(t.appointments.holdExpiresAt, now),
      ),
    )
    .returning()
  for (const a of expired) {
    await db.insert(t.appointmentEvents).values({
      appointmentId: a.id,
      kind: 'hold_expired',
      fromStatus: 'awaiting_deposit',
      toStatus: 'expired',
      actorType: 'system',
      note: 'Урьдчилгаа хугацаандаа төлөгдөөгүй тул цаг чөлөөлөгдсөн.',
      createdAt: now,
    })
    await db
      .update(t.payments)
      .set({ status: 'expired', updatedAt: now })
      .where(and(eq(t.payments.appointmentId, a.id), eq(t.payments.status, 'pending')))
    const info = await notificationContext(db, a)
    await queueNotification(db, {
      salonId,
      appointmentId: a.id,
      kind: 'deposit_expired',
      isDemo: a.isDemo,
      vars: vars({ ...info, status: 'expired' }),
    })
  }
  return expired.length
}

async function notificationContext(db: Database, a: AppointmentRow) {
  const [row] = await db
    .select({
      salonName: t.salons.name,
      address: t.businessSettings.addressLine,
      customerName: t.customers.name,
      customerPhone: t.customers.phone,
      staffName: t.staff.displayName,
    })
    .from(t.appointments)
    .innerJoin(t.salons, eq(t.salons.id, t.appointments.salonId))
    .innerJoin(t.businessSettings, eq(t.businessSettings.salonId, t.appointments.salonId))
    .innerJoin(t.customers, eq(t.customers.id, t.appointments.customerId))
    .innerJoin(t.staff, eq(t.staff.id, t.appointments.staffId))
    .where(eq(t.appointments.id, a.id))
  const lines = await db
    .select({ name: t.appointmentServices.serviceName })
    .from(t.appointmentServices)
    .where(eq(t.appointmentServices.appointmentId, a.id))
    .orderBy(asc(t.appointmentServices.sortOrder))
  return {
    salonName: row.salonName,
    address: row.address,
    reference: a.reference,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    staffName: row.staffName,
    startsAt: a.startsAt,
    services: lines.map((l) => l.name).join(', '),
  }
}

async function upsertCustomer(db: Database, salonId: string, c: CustomerInput, isDemo: boolean): Promise<string> {
  // An existing customer keeps their name: a phone number alone must not let
  // someone rename another person's record.
  const [row] = await db
    .insert(t.customers)
    .values({ salonId, name: c.name, phone: c.phone, email: c.email, preferences: c.preferences, isDemo })
    .onConflictDoUpdate({
      target: [t.customers.salonId, t.customers.phone],
      set: {
        email: sql`coalesce(excluded.email, ${t.customers.email})`,
        preferences: sql`coalesce(excluded.preferences, ${t.customers.preferences})`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: t.customers.id })
  return row.id
}

async function insertLines(db: Database, appointmentId: string, quote: Quote) {
  for (const [i, line] of quote.lines.entries()) {
    const [svc] = await db
      .insert(t.appointmentServices)
      .values({
        appointmentId,
        serviceId: line.serviceId,
        serviceName: line.name,
        categoryName: line.categoryName,
        durationMinutes: line.durationMinutes,
        price: line.price,
        priceType: line.priceType,
        sortOrder: i,
      })
      .returning({ id: t.appointmentServices.id })
    if (line.addons.length) {
      await db.insert(t.appointmentAddons).values(
        line.addons.map((a) => ({
          appointmentId,
          appointmentServiceId: svc.id,
          addonId: a.addonId,
          addonName: a.name,
          durationMinutes: a.durationMinutes,
          price: a.price,
          priceType: a.priceType,
        })),
      )
    }
  }
}

export interface BookingRequest {
  items: SelectionItem[]
  staffId: string | null
  date: DateKey
  start: number
  customer: CustomerInput
}

/** Creates an appointment after re-validating the slot inside a transaction. */
export async function createBooking(ctx: ServiceContext, input: BookingRequest, opts: CreateBookingOptions): Promise<BookingResult> {
  const prepared = await prepareSelection(ctx.db, ctx.salonId, input.items, input.staffId, { publicOnly: opts.publicRules })
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await insertBooking(ctx, prepared, input, opts)
    } catch (err) {
      const code = pgErrorCode(err)
      if (code === '23505' && pgConstraint(err)?.includes('reference')) continue // reference collision: retry
      if (code === '23P01') throw await slotTakenError(ctx, prepared, input.date)
      if (err instanceof ServiceError && err.code === 'slot_unavailable' && !err.details) {
        throw await slotTakenError(ctx, prepared, input.date)
      }
      throw err
    }
  }
  throw new ServiceError('reference_retry', 'Захиалгын дугаар үүсгэж чадсангүй. Дахин оролдоно уу.')
}

async function slotTakenError(ctx: ServiceContext, prepared: PreparedSelection, date: DateKey) {
  const alternatives = await nextAvailableSlots(ctx.db, prepared, date, { now: ctx.now, limit: 4 }).catch(() => [])
  return ERR.slotTaken({ alternatives })
}

async function insertBooking(
  ctx: ServiceContext,
  prepared: PreparedSelection,
  input: BookingRequest,
  opts: CreateBookingOptions,
): Promise<BookingResult> {
  const { config, catalog, quote, candidates } = prepared
  const { settings } = config
  const now = ctx.now
  if (opts.publicRules && input.start % settings.slotIntervalMinutes !== 0) {
    throw new ServiceError('invalid_time', 'Цагийг жагсаалтаас сонгоно уу.')
  }
  const manageToken = randomToken(24)
  const notificationIds: (string | null)[] = []

  const result = await ctx.db.transaction(async (tx) => {
    await lockSalonDay(tx, ctx.salonId, input.date)
    await expireStaleHolds(tx, ctx.salonId, now)
    const specials = await loadSpecialDays(tx, ctx.salonId, input.date, input.date)
    const hours = salonHoursFor(input.date, config.weekly, specials)
    if (opts.publicRules && preliminaryDayState(input.date, now, settings.maxAdvanceDays, hours) !== null) {
      throw new ServiceError('slot_unavailable', 'Энэ өдөр захиалга авах боломжгүй байна.')
    }
    const data = await loadStaffScheduleData(tx, { staffIds: candidates.map((c) => c.id), from: input.date, to: input.date, now })
    const request = {
      date: input.date,
      now,
      hours,
      durationMinutes: quote.durationMinutes,
      bufferMinutes: quote.bufferMinutes,
      slotIntervalMinutes: settings.slotIntervalMinutes,
      minAdvanceMinutes: opts.publicRules ? settings.minAdvanceMinutes : 0,
    }
    if (!opts.publicRules && ubToUtc(input.date, input.start) < new Date(now.getTime() - 15 * 60_000)) {
      throw new ServiceError('past_time', 'Өнгөрсөн цагт захиалга үүсгэх боломжгүй.')
    }
    const free = candidates.filter((c) => isStaffFree(request, staffDayFor(data, c.id, input.date), input.start))
    if (free.length === 0) throw new ServiceError('slot_unavailable', 'slot')
    const staffId =
      input.staffId ??
      pickStaff(
        free.map((f) => f.id),
        bookedMinutesOn(data, input.date),
        catalog.staff.map((s) => s.id),
      )!
    const staff = free.find((f) => f.id === staffId)!

    const customerId = await upsertCustomer(tx, ctx.salonId, input.customer, opts.isDemo)
    const startsAt = ubToUtc(input.date, input.start)
    const endsAt = new Date(startsAt.getTime() + quote.durationMinutes * 60_000)
    const occupiedUntil = new Date(endsAt.getTime() + quote.bufferMinutes * 60_000)
    const deposit = opts.publicRules ? quote.deposit : 0
    const status: AppointmentStatus = opts.staffStatus
      ? opts.staffStatus
      : deposit > 0
        ? 'awaiting_deposit'
        : settings.confirmationMode === 'auto'
          ? 'confirmed'
          : 'pending'
    const holdExpiresAt = status === 'awaiting_deposit' ? new Date(now.getTime() + settings.holdMinutes * 60_000) : null

    const [appt] = await tx
      .insert(t.appointments)
      .values({
        salonId: ctx.salonId,
        reference: newReference(),
        customerId,
        staffId,
        status,
        source: opts.source,
        startsAt,
        endsAt,
        occupiedUntil,
        bufferMinutes: quote.bufferMinutes,
        durationMinutes: quote.durationMinutes,
        servicesTotal: quote.servicesTotal,
        addonsTotal: quote.addonsTotal,
        totalPrice: quote.total,
        hasFromPrice: quote.hasFromPrice,
        depositAmount: deposit,
        staffRequested: Boolean(input.staffId),
        customerNote: input.customer.note,
        internalNote: opts.internalNote ?? null,
        holdExpiresAt,
        confirmedAt: status === 'confirmed' ? now : null,
        manageTokenHash: sha256Hex(manageToken),
        demoVisitorHash: opts.demoVisitorHash ?? null,
        createdByAdminId: opts.actor === 'staff' ? (ctx.actor?.adminUserId ?? null) : null,
        isDemo: opts.isDemo,
        createdAt: now,
      })
      .returning()
    await insertLines(tx, appt.id, quote)
    const actorType = opts.actor === 'staff' ? 'staff' : opts.actor === 'assistant' ? 'assistant' : 'customer'
    await tx.insert(t.appointmentEvents).values({
      appointmentId: appt.id,
      kind: 'created',
      toStatus: status,
      actorType,
      actorAdminId: opts.actor === 'staff' ? (ctx.actor?.adminUserId ?? null) : null,
      note: `${quote.lines.map((l) => l.name).join(', ')} · ${formatDateTime(startsAt)}`,
      meta: { source: opts.source, staffRequested: Boolean(input.staffId), total: quote.total, deposit },
      createdAt: now,
    })

    let depositPaymentId: string | null = null
    if (deposit > 0) {
      const [payment] = await tx
        .insert(t.payments)
        .values({
          salonId: ctx.salonId,
          appointmentId: appt.id,
          kind: 'deposit',
          method: 'qpay',
          status: 'pending',
          amount: deposit,
          provider: process.env.QPAY_MODE === 'sandbox' || process.env.QPAY_MODE === 'production' ? 'qpay' : 'simulated',
          expiresAt: holdExpiresAt,
          isDemo: opts.isDemo,
        })
        .returning({ id: t.payments.id })
      depositPaymentId = payment.id
    }

    const v = vars({
      salonName: config.salon.name,
      reference: appt.reference,
      customerName: input.customer.name,
      customerPhone: input.customer.phone,
      staffName: staff.displayName,
      startsAt,
      services: quote.lines.map((l) => l.name).join(', '),
      status,
    })
    notificationIds.push(
      await queueNotification(tx, { salonId: ctx.salonId, appointmentId: appt.id, kind: 'booking_created', isDemo: opts.isDemo, vars: v }),
      await queueNotification(tx, { salonId: ctx.salonId, appointmentId: appt.id, kind: 'staff_new_booking', isDemo: opts.isDemo, vars: v }),
    )

    return {
      appointmentId: appt.id,
      reference: appt.reference,
      status,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      staffId,
      staffName: staff.displayName,
      manageToken,
      depositAmount: deposit,
      depositPaymentId,
      holdExpiresAt: holdExpiresAt?.toISOString() ?? null,
      quote,
    }
  })
  for (const id of notificationIds) await deliverNotification(ctx.db, id)
  return result
}

// ---- Status transitions ---------------------------------------------------------

export interface TransitionOptions {
  actor: TransitionActor
  reason?: CancellationReason
  note?: string | null
  /** Who in the salon performed it (audit and history). */
  adminUserId?: string | null
}

async function lockAppointment(tx: Database, salonId: string, appointmentId: string): Promise<AppointmentRow> {
  const rows = await tx.execute<{ id: string }>(
    sql`select id from salon.appointments where id = ${appointmentId} and salon_id = ${salonId} for update`,
  )
  if (!rows.rows[0]) throw ERR.notFound('Захиалга')
  const [appt] = await tx.select().from(t.appointments).where(eq(t.appointments.id, appointmentId))
  return appt
}

/** Applies an allowed status change with its side effects and history. */
export async function transitionAppointment(
  ctx: ServiceContext,
  appointmentId: string,
  to: AppointmentStatus,
  opts: TransitionOptions,
): Promise<{ status: AppointmentStatus; depositOutcome?: string }> {
  const notificationIds: (string | null)[] = []
  const out = await ctx.db.transaction(async (tx) => {
    const appt = await lockAppointment(tx, ctx.salonId, appointmentId)
    if (!canTransition(appt.status, to, opts.actor)) {
      throw new ServiceError(
        'invalid_transition',
        `«${STATUS_LABELS[appt.status]}» төлөвтэй захиалгыг «${STATUS_LABELS[to]}» болгох боломжгүй.`,
      )
    }
    const now = ctx.now
    if ((to === 'completed' || to === 'no_show') && now < appt.startsAt) {
      throw new ServiceError('too_early', 'Үйлчилгээний цаг эхлээгүй байна. Эхэлсний дараа тэмдэглэнэ үү.')
    }
    const [settings] = await tx.select().from(t.businessSettings).where(eq(t.businessSettings.salonId, ctx.salonId))
    const patch: Partial<AppointmentRow> = { status: to, updatedAt: now }
    if (to === 'confirmed') patch.confirmedAt = now
    if (to === 'cancelled' || to === 'rejected') patch.cancelledAt = now
    if (to === 'completed') patch.completedAt = now
    await tx.update(t.appointments).set(patch).where(eq(t.appointments.id, appt.id))

    let depositOutcome: 'none' | 'refund' | 'forfeit' = 'none'
    const paidDeposit = (
      await tx
        .select()
        .from(t.payments)
        .where(and(eq(t.payments.appointmentId, appt.id), eq(t.payments.kind, 'deposit'), eq(t.payments.status, 'paid')))
    )[0]
    if (to === 'cancelled' || to === 'rejected' || to === 'no_show') {
      const noticeHours = Math.floor((appt.startsAt.getTime() - now.getTime()) / 3_600_000)
      const withinPolicy = opts.actor !== 'customer' || noticeHours >= settings.cancellationNoticeHours
      if (paidDeposit) depositOutcome = to === 'no_show' || !withinPolicy ? 'forfeit' : 'refund'
      if (to !== 'no_show') {
        await tx.insert(t.cancellationRecords).values({
          appointmentId: appt.id,
          cancelledBy: opts.actor === 'customer' ? 'customer' : opts.actor === 'system' ? 'system' : 'staff',
          actorAdminId: opts.adminUserId ?? null,
          reasonCode: to === 'rejected' ? 'rejected' : (opts.reason ?? 'customer_request'),
          reasonText: opts.note ?? null,
          noticeHours,
          withinPolicy,
          depositOutcome,
          createdAt: now,
        })
      }
      if (depositOutcome === 'refund' && paidDeposit) await markRefunded(tx, paidDeposit, now, 'Цуцлалтын бодлогын дагуу буцаав')
      // An unpaid deposit request is no longer payable.
      await tx
        .update(t.payments)
        .set({ status: 'cancelled', updatedAt: now })
        .where(and(eq(t.payments.appointmentId, appt.id), eq(t.payments.status, 'pending')))
    }

    await tx.insert(t.appointmentEvents).values({
      appointmentId: appt.id,
      kind: to,
      fromStatus: appt.status,
      toStatus: to,
      actorType: opts.actor === 'staff' ? 'staff' : opts.actor === 'system' ? 'system' : 'customer',
      actorAdminId: opts.adminUserId ?? null,
      note: opts.note ?? null,
      meta: depositOutcome !== 'none' ? { depositOutcome } : null,
      createdAt: now,
    })

    const info = await notificationContext(tx, appt)
    const kinds: NotificationKind[] =
      to === 'confirmed'
        ? ['booking_confirmed']
        : to === 'rejected'
          ? ['booking_rejected']
          : to === 'cancelled'
            ? ['booking_cancelled', 'staff_cancelled']
            : []
    for (const kind of kinds) {
      notificationIds.push(
        await queueNotification(tx, { salonId: ctx.salonId, appointmentId: appt.id, kind, isDemo: appt.isDemo, vars: vars({ ...info, status: to }) }),
      )
    }
    return { status: to, depositOutcome: depositOutcome === 'none' ? undefined : depositOutcome }
  })
  for (const id of notificationIds) await deliverNotification(ctx.db, id)
  return out
}

async function markRefunded(tx: Database, payment: typeof t.payments.$inferSelect, now: Date, note: string) {
  // Simulated and manually recorded payments are refunded on record; real QPay
  // refunds go through the provider in the payment service.
  await tx.update(t.payments).set({ status: 'refunded', updatedAt: now, note }).where(eq(t.payments.id, payment.id))
  await tx.insert(t.paymentRecords).values({
    paymentId: payment.id,
    event: payment.provider === 'qpay' ? 'refund_requested' : 'refunded',
    detail: { amount: payment.amount, note },
    createdAt: now,
  })
}

// ---- Rescheduling -----------------------------------------------------------------

export interface RescheduleInput {
  date: DateKey
  start: number
  staffId: string | null
}

/**
 * Moves an appointment to a new time. The original keeps its history with
 * status "rescheduled"; a new appointment (new reference, same price
 * snapshot, same manage link) replaces it. Atomic: if the new slot is taken,
 * nothing changes.
 */
export async function rescheduleAppointment(
  ctx: ServiceContext,
  appointmentId: string,
  input: RescheduleInput,
  opts: { actor: 'customer' | 'staff'; publicRules: boolean; adminUserId?: string | null },
): Promise<{ appointmentId: string; reference: string; status: AppointmentStatus; startsAt: string; staffName: string }> {
  const [appt] = await ctx.db
    .select()
    .from(t.appointments)
    .where(and(eq(t.appointments.id, appointmentId), eq(t.appointments.salonId, ctx.salonId)))
  if (!appt) throw ERR.notFound('Захиалга')
  if (appt.status !== 'pending' && appt.status !== 'confirmed') {
    throw new ServiceError('invalid_transition', 'Зөвхөн хүлээгдэж буй эсвэл баталгаажсан захиалгын цагийг өөрчилнө.')
  }
  const lines = await ctx.db
    .select()
    .from(t.appointmentServices)
    .where(eq(t.appointmentServices.appointmentId, appt.id))
    .orderBy(asc(t.appointmentServices.sortOrder))
  const addons = await ctx.db.select().from(t.appointmentAddons).where(eq(t.appointmentAddons.appointmentId, appt.id))
  const items: SelectionItem[] = lines
    .filter((l) => l.serviceId)
    .map((l) => ({ serviceId: l.serviceId!, addonIds: addons.filter((a) => a.appointmentServiceId === l.id && a.addonId).map((a) => a.addonId!) }))

  // Staff are re-checked against today's eligibility; the price snapshot is kept.
  const prepared = await prepareSelection(ctx.db, ctx.salonId, items, input.staffId, { publicOnly: opts.publicRules })
  const { config, catalog, candidates } = prepared
  const now = ctx.now
  const durationMinutes = appt.durationMinutes
  const bufferMinutes = appt.bufferMinutes
  const oldDate = dateKeyOf(appt.startsAt)
  const notificationIds: (string | null)[] = []

  try {
    const result = await ctx.db.transaction(async (tx) => {
      for (const day of [...new Set([oldDate, input.date])].sort()) await lockSalonDay(tx, ctx.salonId, day)
      const current = await lockAppointment(tx, ctx.salonId, appt.id)
      if (current.status !== appt.status) throw new ServiceError('changed', 'Захиалга дөнгөж сая өөрчлөгдсөн байна. Хуудсаа шинэчилнэ үү.')
      // Release the old slot first so the new time may overlap it.
      await tx.update(t.appointments).set({ status: 'rescheduled', updatedAt: now }).where(eq(t.appointments.id, appt.id))

      const specials = await loadSpecialDays(tx, ctx.salonId, input.date, input.date)
      const hours = salonHoursFor(input.date, config.weekly, specials)
      if (opts.publicRules && preliminaryDayState(input.date, now, config.settings.maxAdvanceDays, hours) !== null) {
        throw new ServiceError('slot_unavailable', 'slot')
      }
      const data = await loadStaffScheduleData(tx, { staffIds: candidates.map((c) => c.id), from: input.date, to: input.date, now })
      const request = {
        date: input.date,
        now,
        hours,
        durationMinutes,
        bufferMinutes,
        slotIntervalMinutes: config.settings.slotIntervalMinutes,
        minAdvanceMinutes: opts.publicRules ? config.settings.minAdvanceMinutes : 0,
      }
      const free = candidates.filter((c) => isStaffFree(request, staffDayFor(data, c.id, input.date), input.start))
      if (free.length === 0) throw new ServiceError('slot_unavailable', 'slot')
      const staffId =
        input.staffId ??
        (free.some((f) => f.id === appt.staffId)
          ? appt.staffId
          : pickStaff(
              free.map((f) => f.id),
              bookedMinutesOn(data, input.date),
              catalog.staff.map((s) => s.id),
            )!)
      const staff = free.find((f) => f.id === staffId)!
      const startsAt = ubToUtc(input.date, input.start)
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000)
      const status: AppointmentStatus =
        opts.actor === 'staff' ? appt.status : config.settings.confirmationMode === 'auto' ? 'confirmed' : 'pending'

      const [next] = await tx
        .insert(t.appointments)
        .values({
          ...appt,
          id: undefined,
          reference: newReference(),
          staffId,
          status,
          startsAt,
          endsAt,
          occupiedUntil: new Date(endsAt.getTime() + bufferMinutes * 60_000),
          staffRequested: input.staffId ? true : appt.staffRequested,
          confirmedAt: status === 'confirmed' ? now : null,
          cancelledAt: null,
          completedAt: null,
          holdExpiresAt: null,
          rescheduledFromId: appt.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
      for (const line of lines) {
        const [svc] = await tx
          .insert(t.appointmentServices)
          .values({ ...line, id: undefined, appointmentId: next.id })
          .returning({ id: t.appointmentServices.id })
        const lineAddons = addons.filter((a) => a.appointmentServiceId === line.id)
        if (lineAddons.length) {
          await tx
            .insert(t.appointmentAddons)
            .values(lineAddons.map((a) => ({ ...a, id: undefined, appointmentId: next.id, appointmentServiceId: svc.id })))
        }
      }
      // Payments follow the booking to its new time.
      await tx.update(t.payments).set({ appointmentId: next.id, updatedAt: now }).where(eq(t.payments.appointmentId, appt.id))
      const actorType = opts.actor === 'staff' ? 'staff' : 'customer'
      await tx.insert(t.appointmentEvents).values([
        {
          appointmentId: appt.id,
          kind: 'rescheduled',
          fromStatus: appt.status,
          toStatus: 'rescheduled',
          actorType,
          actorAdminId: opts.adminUserId ?? null,
          note: `Шинэ цаг: ${formatDateTime(startsAt)} (${next.reference})`,
          meta: { newAppointmentId: next.id, newReference: next.reference },
          createdAt: now,
        },
        {
          appointmentId: next.id,
          kind: 'created',
          toStatus: status,
          actorType,
          actorAdminId: opts.adminUserId ?? null,
          note: `${appt.reference} захиалгын цагийг өөрчилж үүсгэв (өмнөх цаг: ${formatDateTime(appt.startsAt)})`,
          meta: { rescheduledFrom: appt.reference },
          createdAt: now,
        },
      ])
      const info = await notificationContext(tx, next)
      notificationIds.push(
        await queueNotification(tx, {
          salonId: ctx.salonId,
          appointmentId: next.id,
          kind: 'booking_rescheduled',
          isDemo: next.isDemo,
          vars: vars({ ...info, status }),
        }),
      )
      return { appointmentId: next.id, reference: next.reference, status, startsAt: startsAt.toISOString(), staffName: staff.displayName }
    })
    for (const id of notificationIds) await deliverNotification(ctx.db, id)
    return result
  } catch (err) {
    if (pgErrorCode(err) === '23P01' || (err instanceof ServiceError && err.code === 'slot_unavailable')) {
      throw await slotTakenError(ctx, prepared, input.date)
    }
    throw err
  }
}

/** Reminder notifications for appointments starting within the next window (cron). */
export async function queueReminders(db: Database, salonId: string, now: Date, hoursAhead: number): Promise<number> {
  const until = new Date(now.getTime() + hoursAhead * 3_600_000)
  const due = await db
    .select()
    .from(t.appointments)
    .where(
      and(
        eq(t.appointments.salonId, salonId),
        eq(t.appointments.status, 'confirmed'),
        sql`${t.appointments.startsAt} > ${now} and ${t.appointments.startsAt} <= ${until}`,
      ),
    )
  let queued = 0
  for (const a of due) {
    const info = await notificationContext(db, a)
    const id = await queueNotification(db, { salonId, appointmentId: a.id, kind: 'reminder', isDemo: a.isDemo, vars: vars({ ...info, status: a.status }) })
    if (id) {
      queued++
      await deliverNotification(db, id)
    }
  }
  return queued
}

/** Requests waiting for approval whose time has already passed are closed (cron). */
export async function expireUnhandledRequests(db: Database, salonId: string, now: Date): Promise<number> {
  const rows = await db
    .update(t.appointments)
    .set({ status: 'expired', updatedAt: now })
    .where(and(eq(t.appointments.salonId, salonId), eq(t.appointments.status, 'pending'), lt(t.appointments.startsAt, now)))
    .returning({ id: t.appointments.id })
  if (rows.length) {
    await db.insert(t.appointmentEvents).values(
      rows.map((r) => ({
        appointmentId: r.id,
        kind: 'request_expired',
        fromStatus: 'pending' as const,
        toStatus: 'expired' as const,
        actorType: 'system' as const,
        note: 'Салон хариу өгөөгүй хүсэлтийн цаг өнгөрсөн.',
        createdAt: now,
      })),
    )
  }
  return rows.length
}

export function isOwnDemoBooking(appt: Pick<AppointmentRow, 'demoVisitorHash'>, demoVisitorHash: string | null | undefined) {
  return Boolean(demoVisitorHash && appt.demoVisitorHash && appt.demoVisitorHash === demoVisitorHash)
}

