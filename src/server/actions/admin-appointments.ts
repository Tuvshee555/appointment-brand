'use server'

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { APPOINTMENT_STATUSES, CANCELLATION_REASONS, STATUS_LABELS } from '@/lib/booking/status'
import { minutesToTime } from '@/lib/datetime'
import { selectionItems } from '@/lib/validation/booking'
import { dateKey, id, minuteOfDay, optionalEmail, optionalText, personName, phone } from '@/lib/validation/common'
import * as t from '@/server/db/schema'
import { ServiceError } from '@/server/context'
import { recordManualPayment, refundPayment } from '@/server/payments/service'
import { dayAvailability, prepareSelection } from '@/server/services/availability'
import { createBooking, rescheduleAppointment, transitionAppointment } from '@/server/services/booking'
import { audit, runAdminAction, safeParse } from './admin-run'
import type { PublicSlot } from './booking'

const transitionSchema = z.object({
  appointmentId: id,
  to: z.enum(APPOINTMENT_STATUSES),
  reason: z
    .enum(
      Object.keys(CANCELLATION_REASONS) as [
        keyof typeof CANCELLATION_REASONS,
        ...(keyof typeof CANCELLATION_REASONS)[],
      ],
    )
    .optional(),
  note: optionalText(500),
})

export async function transitionAction(input: unknown) {
  const p = safeParse(transitionSchema, input)
  if (!p.ok) return p
  const parsed = p.data
  return runAdminAction(
    'appointments.manage',
    async (ctx) => {
      if (ctx.actor.role === 'specialist') {
        const [row] = await ctx.db
          .select({ staffId: t.appointments.staffId })
          .from(t.appointments)
          .where(eq(t.appointments.id, parsed.appointmentId))
        if (row?.staffId !== ctx.actor.staffId) throw new ServiceError('forbidden', 'Зөвхөн өөрийн захиалгыг өөрчилнө.')
      }
      const result = await transitionAppointment(ctx, parsed.appointmentId, parsed.to, {
        actor: 'staff',
        reason: parsed.reason,
        note: parsed.note,
        adminUserId: ctx.actor.adminUserId,
      })
      if (parsed.to === 'cancelled' || parsed.to === 'rejected' || parsed.to === 'no_show') {
        await audit(ctx, {
          action: `appointment.${parsed.to}`,
          entity: 'appointment',
          entityId: parsed.appointmentId,
          summary: `Захиалгын төлөвийг «${STATUS_LABELS[parsed.to]}» болгосон${parsed.note ? `: ${parsed.note}` : ''}`,
        })
      }
      return result
    },
    { ownAppointmentId: parsed.appointmentId },
  )
}

const rescheduleSchema = z.object({ appointmentId: id, date: dateKey, start: minuteOfDay, staffId: id.nullable() })

export async function adminRescheduleAction(input: unknown) {
  const p = safeParse(rescheduleSchema, input)
  if (!p.ok) return p
  const parsed = p.data
  return runAdminAction(
    'appointments.manage',
    async (ctx) => {
      const result = await rescheduleAppointment(
        ctx,
        parsed.appointmentId,
        { date: parsed.date, start: parsed.start, staffId: parsed.staffId },
        { actor: 'staff', publicRules: false, adminUserId: ctx.actor.adminUserId },
      )
      await audit(ctx, {
        action: 'appointment.reschedule',
        entity: 'appointment',
        entityId: parsed.appointmentId,
        summary: `Цагийг ${parsed.date} ${minutesToTime(parsed.start)} болгож шилжүүлсэн (${result.reference})`,
      })
      return result
    },
    { ownAppointmentId: parsed.appointmentId },
  )
}

/** Free start times for staff use (no minimum notice; any active specialist). */
export async function adminSlotsAction(input: unknown) {
  const p = safeParse(
    z.object({ items: selectionItems, staffId: id.nullable(), date: dateKey, excludeAppointmentId: id.optional() }),
    input,
  )
  if (!p.ok) return p
  const parsed = p.data
  return runAdminAction('appointments.view', async (ctx) => {
    const prepared = await prepareSelection(ctx.db, ctx.salonId, parsed.items, parsed.staffId, { publicOnly: false })
    const day = await dayAvailability(ctx.db, prepared, parsed.date, {
      now: ctx.now,
      publicRules: false,
      excludeAppointmentId: parsed.excludeAppointmentId,
    })
    const slots: PublicSlot[] = day.slots.map((s) => ({
      start: s.start,
      label: minutesToTime(s.start),
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      staffIds: s.staffIds,
    }))
    return {
      slots,
      quote: prepared.quote,
      staff: prepared.candidates.map((c) => ({ id: c.id, name: c.displayName })),
      closed: !day.hours,
    }
  })
}

const createSchema = z.object({
  items: selectionItems,
  staffId: id.nullable(),
  date: dateKey,
  start: minuteOfDay,
  source: z.enum(['admin', 'phone', 'walk_in', 'messenger']),
  status: z.enum(['confirmed', 'pending']),
  customer: z.object({
    name: personName,
    phone,
    email: optionalEmail,
    note: optionalText(500),
    preferences: optionalText(300),
  }),
  internalNote: optionalText(500),
})

export async function adminCreateBookingAction(input: unknown) {
  const p = safeParse(createSchema, input)
  if (!p.ok) return p
  const parsed = p.data
  return runAdminAction('appointments.manage', async (ctx) => {
    const [salon] = await ctx.db.select({ isDemo: t.salons.isDemo }).from(t.salons).where(eq(t.salons.id, ctx.salonId))
    const result = await createBooking(
      ctx,
      {
        items: parsed.items,
        staffId: parsed.staffId,
        date: parsed.date,
        start: parsed.start,
        customer: parsed.customer,
      },
      {
        source: parsed.source,
        actor: 'staff',
        publicRules: false,
        isDemo: salon.isDemo,
        staffStatus: parsed.status,
        internalNote: parsed.internalNote,
        demoVisitorHash: ctx.actor.demoVisitorHash,
      },
    )
    return { appointmentId: result.appointmentId, reference: result.reference, status: result.status }
  })
}

export async function updateInternalNoteAction(input: unknown) {
  const p = safeParse(z.object({ appointmentId: id, note: optionalText(1000) }), input)
  if (!p.ok) return p
  const parsed = p.data
  return runAdminAction(
    'appointments.manage',
    async (ctx) => {
      const rows = await ctx.db
        .update(t.appointments)
        .set({ internalNote: parsed.note, updatedAt: ctx.now })
        .where(and(eq(t.appointments.id, parsed.appointmentId), eq(t.appointments.salonId, ctx.salonId)))
        .returning({ id: t.appointments.id })
      if (!rows.length) throw new ServiceError('not_found', 'Захиалга олдсонгүй.')
      return null
    },
    { ownAppointmentId: parsed.appointmentId },
  )
}

const paymentSchema = z.object({
  appointmentId: id,
  amount: z.number().int().min(1, { error: 'Дүн оруулна уу.' }).max(10_000_000),
  method: z.enum(['cash', 'card', 'bank_transfer', 'qpay']),
  kind: z.enum(['balance', 'full', 'deposit']),
  note: optionalText(300),
})

export async function recordPaymentAction(input: unknown) {
  const p = safeParse(paymentSchema, input)
  if (!p.ok) return p
  const parsed = p.data
  return runAdminAction(
    'payments.manage',
    async (ctx) => {
      const row = await recordManualPayment(ctx, parsed.appointmentId, parsed)
      await audit(ctx, {
        action: 'payment.record',
        entity: 'payment',
        entityId: row.id,
        summary: `${parsed.amount}₮ төлбөр бүртгэв (${parsed.method})`,
      })
      return { paymentId: row.id }
    },
    { ownAppointmentId: parsed.appointmentId },
  )
}

export async function refundPaymentAction(input: unknown) {
  const p = safeParse(z.object({ paymentId: id, note: optionalText(300) }), input)
  if (!p.ok) return p
  const parsed = p.data
  return runAdminAction('payments.manage', async (ctx) => {
    await refundPayment(ctx, parsed.paymentId, parsed.note)
    await audit(ctx, {
      action: 'payment.refund',
      entity: 'payment',
      entityId: parsed.paymentId,
      summary: `Төлбөр буцаав${parsed.note ? `: ${parsed.note}` : ''}`,
    })
    return null
  })
}
