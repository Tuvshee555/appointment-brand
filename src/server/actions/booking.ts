'use server'

import type { CalendarDay } from '@/lib/availability/engine'
import { minutesToTime } from '@/lib/datetime'
import { availabilityDaySchema, availabilityMonthSchema, createBookingSchema } from '@/lib/validation/booking'
import { createBooking } from '@/server/services/booking'
import { dayAvailability, monthAvailability, prepareSelection } from '@/server/services/availability'
import { loadSalonConfig } from '@/server/services/salon'
import { publicContext, visitorHash } from '@/server/request'
import { enforceRateLimit, LIMITS } from '@/server/security/rate-limit'
import { toFailure, type ActionResult } from './result'

export interface PublicSlot {
  start: number
  label: string
  startsAt: string
  endsAt: string
  staffIds: string[]
}

/** Day states for the booking calendar. */
export async function monthAvailabilityAction(input: unknown): Promise<ActionResult<{ days: CalendarDay[] }>> {
  try {
    const parsed = availabilityMonthSchema.parse(input)
    const ctx = await publicContext()
    await enforceRateLimit(ctx.db, LIMITS.availability, ctx.ipHash)
    const prepared = await prepareSelection(ctx.db, ctx.salonId, parsed.items, parsed.staffId, { publicOnly: true })
    const days = await monthAvailability(ctx.db, prepared, parsed.month, { now: ctx.now })
    return { ok: true, data: { days } }
  } catch (err) {
    return toFailure(err)
  }
}

/** Real bookable start times for one day. */
export async function dayAvailabilityAction(
  input: unknown,
): Promise<ActionResult<{ slots: PublicSlot[]; special: string | null; closed: boolean }>> {
  try {
    const parsed = availabilityDaySchema.parse(input)
    const ctx = await publicContext()
    await enforceRateLimit(ctx.db, LIMITS.availability, ctx.ipHash)
    const prepared = await prepareSelection(ctx.db, ctx.salonId, parsed.items, parsed.staffId, { publicOnly: true })
    const day = await dayAvailability(ctx.db, prepared, parsed.date, { now: ctx.now, publicRules: true })
    return {
      ok: true,
      data: {
        slots: day.slots.map((s) => ({ start: s.start, label: minutesToTime(s.start), startsAt: s.startsAt, endsAt: s.endsAt, staffIds: s.staffIds })),
        special: day.special?.label ?? null,
        closed: !day.hours,
      },
    }
  } catch (err) {
    return toFailure(err)
  }
}

export interface BookingCreated {
  reference: string
  status: string
  token: string
  depositAmount: number
}

/** Creates the appointment. Prices, availability and status are decided on the server. */
export async function createBookingAction(input: unknown): Promise<ActionResult<BookingCreated>> {
  try {
    const parsed = createBookingSchema.parse(input)
    const ctx = await publicContext()
    await enforceRateLimit(ctx.db, LIMITS.booking, ctx.ipHash)
    const config = await loadSalonConfig(ctx.db, ctx.salonId)
    const result = await createBooking(
      ctx,
      {
        items: parsed.items,
        staffId: parsed.staffId,
        date: parsed.date,
        start: parsed.start,
        customer: {
          name: parsed.customer.name,
          phone: parsed.customer.phone,
          email: parsed.customer.email,
          note: parsed.customer.note,
          preferences: parsed.customer.preferences,
        },
      },
      {
        source: 'website',
        actor: 'customer',
        publicRules: true,
        isDemo: config.salon.isDemo,
        demoVisitorHash: config.salon.isDemo ? await visitorHash({ create: true }) : null,
      },
    )
    return { ok: true, data: { reference: result.reference, status: result.status, token: result.manageToken, depositAmount: result.depositAmount } }
  } catch (err) {
    return toFailure(err)
  }
}
