'use server'

import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { CalendarDay } from '@/lib/availability/engine'
import { hoursUntil, minutesToTime } from '@/lib/datetime'
import { bookingLookupSchema } from '@/lib/validation/booking'
import { dateKey, minuteOfDay, optionalText } from '@/lib/validation/common'
import * as t from '@/server/db/schema'
import { ERR, ServiceError, type ServiceContext } from '@/server/context'
import { ensureDepositInvoice, simulateBankPayment, verifyPayment, type PaymentView } from '@/server/payments/service'
import { authorizeBooking, grantLookup } from '@/server/queries/customer-booking'
import { publicContext } from '@/server/request'
import { enforceRateLimit, LIMITS } from '@/server/security/rate-limit'
import { dayAvailability, monthAvailability, prepareSelection } from '@/server/services/availability'
import { rescheduleAppointment, transitionAppointment } from '@/server/services/booking'
import { loadSalonConfig } from '@/server/services/salon'
import { toFailure, type ActionResult } from './result'
import type { PublicSlot } from './booking'

const access = z.object({ reference: z.string().trim().toUpperCase().max(16), token: z.string().max(80).nullish() })

async function authorized(input: unknown): Promise<{ ctx: ServiceContext; appointmentId: string }> {
  const { reference, token } = access.parse(input)
  const ctx = await publicContext()
  const ok = await authorizeBooking({ reference, token })
  if (!ok)
    throw new ServiceError('forbidden', 'Энэ захиалгыг харах эрх алга. Захиалгын дугаар, утсаараа дахин нэвтэрнэ үү.')
  return { ctx, appointmentId: ok.id }
}

async function loadAppointment(ctx: ServiceContext, id: string) {
  const [appt] = await ctx.db
    .select()
    .from(t.appointments)
    .where(and(eq(t.appointments.id, id), eq(t.appointments.salonId, ctx.salonId)))
  if (!appt) throw ERR.notFound('Захиалга')
  return appt
}

/** Reference + phone lookup → a short-lived signed access cookie. */
export async function lookupBookingAction(input: unknown): Promise<ActionResult<{ reference: string }>> {
  try {
    const { reference, phone } = bookingLookupSchema.parse(input)
    const ctx = await publicContext()
    await enforceRateLimit(ctx.db, LIMITS.lookup, ctx.ipHash)
    const [row] = await ctx.db
      .select({ phone: t.customers.phone })
      .from(t.appointments)
      .innerJoin(t.customers, eq(t.customers.id, t.appointments.customerId))
      .where(and(eq(t.appointments.salonId, ctx.salonId), eq(t.appointments.reference, reference)))
    // Same message for "no such booking" and "wrong phone": no enumeration.
    if (!row || row.phone !== phone)
      throw new ServiceError('not_found', 'Захиалгын дугаар эсвэл утасны дугаар таарсангүй.')
    await grantLookup(reference)
    return { ok: true, data: { reference } }
  } catch (err) {
    return toFailure(err)
  }
}

export async function cancelBookingAction(
  input: unknown,
): Promise<ActionResult<{ status: string; depositOutcome?: string }>> {
  try {
    const { reason } = z.object({ reason: optionalText(300) }).parse(input)
    const { ctx, appointmentId } = await authorized(input)
    await enforceRateLimit(ctx.db, LIMITS.customerChange, ctx.ipHash)
    const appt = await loadAppointment(ctx, appointmentId)
    if (appt.startsAt <= ctx.now)
      throw new ServiceError(
        'started',
        'Эхэлсэн эсвэл өнгөрсөн цагийг онлайнаар цуцлах боломжгүй. Салон руу залгана уу.',
      )
    const result = await transitionAppointment(ctx, appointmentId, 'cancelled', {
      actor: 'customer',
      reason: 'customer_request',
      note: reason,
    })
    return { ok: true, data: result }
  } catch (err) {
    return toFailure(err)
  }
}

async function rescheduleSelection(ctx: ServiceContext, appointmentId: string) {
  const appt = await loadAppointment(ctx, appointmentId)
  const config = await loadSalonConfig(ctx.db, ctx.salonId)
  if (appt.status !== 'pending' && appt.status !== 'confirmed') {
    throw new ServiceError('not_reschedulable', 'Энэ захиалгын цагийг өөрчлөх боломжгүй.')
  }
  if (hoursUntil(appt.startsAt, ctx.now) < config.settings.rescheduleNoticeHours) {
    throw new ServiceError(
      'too_late',
      `Цаг эхлэхээс ${config.settings.rescheduleNoticeHours} цагийн дотор онлайнаар өөрчлөх боломжгүй. Салон руу залгана уу.`,
    )
  }
  const lines = await ctx.db
    .select()
    .from(t.appointmentServices)
    .where(eq(t.appointmentServices.appointmentId, appt.id))
    .orderBy(asc(t.appointmentServices.sortOrder))
  const addons = await ctx.db.select().from(t.appointmentAddons).where(eq(t.appointmentAddons.appointmentId, appt.id))
  const items = lines
    .filter((l) => l.serviceId)
    .map((l) => ({
      serviceId: l.serviceId!,
      addonIds: addons.filter((a) => a.appointmentServiceId === l.id && a.addonId).map((a) => a.addonId!),
    }))
  if (items.length !== lines.length)
    throw new ServiceError('service_removed', 'Үйлчилгээ шинэчлэгдсэн тул салон руу залгаж цагаа өөрчилнө үү.')
  // A customer who chose a specialist keeps them; "any" stays "any".
  const staffId = appt.staffRequested ? appt.staffId : null
  return { appt, items, staffId }
}

export async function rescheduleMonthAction(input: unknown): Promise<ActionResult<{ days: CalendarDay[] }>> {
  try {
    const { month } = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(input)
    const { ctx, appointmentId } = await authorized(input)
    await enforceRateLimit(ctx.db, LIMITS.availability, ctx.ipHash)
    const { items, staffId } = await rescheduleSelection(ctx, appointmentId)
    const prepared = await prepareSelection(ctx.db, ctx.salonId, items, staffId, { publicOnly: true })
    const days = await monthAvailability(ctx.db, prepared, month, { now: ctx.now, excludeAppointmentId: appointmentId })
    return { ok: true, data: { days } }
  } catch (err) {
    return toFailure(err)
  }
}

export async function rescheduleDayAction(input: unknown): Promise<ActionResult<{ slots: PublicSlot[] }>> {
  try {
    const { date } = z.object({ date: dateKey }).parse(input)
    const { ctx, appointmentId } = await authorized(input)
    await enforceRateLimit(ctx.db, LIMITS.availability, ctx.ipHash)
    const { items, staffId } = await rescheduleSelection(ctx, appointmentId)
    const prepared = await prepareSelection(ctx.db, ctx.salonId, items, staffId, { publicOnly: true })
    const day = await dayAvailability(ctx.db, prepared, date, {
      now: ctx.now,
      publicRules: true,
      excludeAppointmentId: appointmentId,
    })
    return {
      ok: true,
      data: {
        slots: day.slots.map((s) => ({
          start: s.start,
          label: minutesToTime(s.start),
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          staffIds: s.staffIds,
        })),
      },
    }
  } catch (err) {
    return toFailure(err)
  }
}

export async function rescheduleBookingAction(
  input: unknown,
): Promise<ActionResult<{ reference: string; status: string }>> {
  try {
    const { date, start } = z.object({ date: dateKey, start: minuteOfDay }).parse(input)
    const { ctx, appointmentId } = await authorized(input)
    await enforceRateLimit(ctx.db, LIMITS.customerChange, ctx.ipHash)
    const { token } = access.parse(input)
    const { staffId } = await rescheduleSelection(ctx, appointmentId)
    const result = await rescheduleAppointment(
      ctx,
      appointmentId,
      { date, start, staffId },
      { actor: 'customer', publicRules: true },
    )
    // The new booking keeps the same private link; lookup-cookie visitors get access to it too.
    if (!token) await grantLookup(result.reference)
    return { ok: true, data: { reference: result.reference, status: result.status } }
  } catch (err) {
    return toFailure(err)
  }
}

async function depositPaymentId(ctx: ServiceContext, appointmentId: string) {
  const [payment] = await ctx.db
    .select({ id: t.payments.id })
    .from(t.payments)
    .where(and(eq(t.payments.appointmentId, appointmentId), eq(t.payments.kind, 'deposit')))
    .orderBy(asc(t.payments.createdAt))
  if (!payment) throw new ServiceError('no_deposit', 'Энэ захиалгад урьдчилгаа шаардлагагүй.')
  return payment.id
}

export async function startPaymentAction(input: unknown): Promise<ActionResult<PaymentView>> {
  try {
    const { ctx, appointmentId } = await authorized(input)
    await enforceRateLimit(ctx.db, LIMITS.payment, ctx.ipHash)
    return { ok: true, data: await ensureDepositInvoice(ctx, await depositPaymentId(ctx, appointmentId)) }
  } catch (err) {
    return toFailure(err)
  }
}

/** Demo only: stands in for paying in a bank app, then verifies through the provider. */
export async function simulatePaymentAction(input: unknown): Promise<ActionResult<PaymentView>> {
  try {
    const { ctx, appointmentId } = await authorized(input)
    await enforceRateLimit(ctx.db, LIMITS.payment, ctx.ipHash)
    return { ok: true, data: await simulateBankPayment(ctx, await depositPaymentId(ctx, appointmentId)) }
  } catch (err) {
    return toFailure(err)
  }
}

export async function checkPaymentAction(input: unknown): Promise<ActionResult<PaymentView>> {
  try {
    const { ctx, appointmentId } = await authorized(input)
    await enforceRateLimit(ctx.db, LIMITS.payment, ctx.ipHash)
    return { ok: true, data: await verifyPayment(ctx, await depositPaymentId(ctx, appointmentId), 'customer') }
  } catch (err) {
    return toFailure(err)
  }
}
