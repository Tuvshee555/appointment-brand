// Loads scheduling data from the database and runs the availability engine.
// Used by the public booking flow, the admin calendar, the AI assistant and,
// inside a transaction, by the booking service to re-validate a slot.
import { and, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'
import {
  computeDaySlots,
  preliminaryDayState,
  salonHoursFor,
  type CalendarDay,
  type MinuteRange,
  type Slot,
  type SpecialDay,
  type StaffDay,
} from '@/lib/availability/engine'
import { buildQuote, QuoteError, type Quote, type SelectionItem } from '@/lib/booking/pricing'
import { SLOT_HOLDING_STATUSES } from '@/lib/booking/status'
import { addDays, dayBounds, diffDays, daysInMonth, weekdayOf, type DateKey } from '@/lib/datetime'
import type { Database } from '@/server/db/client'
import * as t from '@/server/db/schema'
import { ServiceError } from '@/server/context'
import { candidateStaff, loadBookingCatalog, type BookingCatalog, type StaffSummary } from './catalog'
import { depositPolicy, loadSalonConfig, loadSpecialDays, type SalonConfig } from './salon'

export interface StaffScheduleData {
  schedules: (typeof t.staffSchedules.$inferSelect)[]
  breaks: (typeof t.staffBreaks.$inferSelect)[]
  timeOff: { staffId: string; start: number; end: number }[]
  busy: { staffId: string; start: number; end: number; durationMinutes: number; appointmentId: string }[]
}

/** Schedules, breaks, time off and slot-holding appointments for staff over [from, to]. */
export async function loadStaffScheduleData(
  db: Database,
  {
    staffIds,
    from,
    to,
    now,
    excludeAppointmentId,
  }: { staffIds: string[]; from: DateKey; to: DateKey; now: Date; excludeAppointmentId?: string },
): Promise<StaffScheduleData> {
  if (staffIds.length === 0) return { schedules: [], breaks: [], timeOff: [], busy: [] }
  const rangeStart = dayBounds(from).start
  const rangeEnd = dayBounds(to).end
  const [schedules, breaks, timeOffRows, busyRows] = await Promise.all([
    db.select().from(t.staffSchedules).where(inArray(t.staffSchedules.staffId, staffIds)),
    db.select().from(t.staffBreaks).where(inArray(t.staffBreaks.staffId, staffIds)),
    db
      .select()
      .from(t.staffTimeOff)
      .where(
        and(
          inArray(t.staffTimeOff.staffId, staffIds),
          lt(t.staffTimeOff.startsAt, rangeEnd),
          gt(t.staffTimeOff.endsAt, rangeStart),
        ),
      ),
    db
      .select({
        id: t.appointments.id,
        staffId: t.appointments.staffId,
        startsAt: t.appointments.startsAt,
        occupiedUntil: t.appointments.occupiedUntil,
        durationMinutes: t.appointments.durationMinutes,
      })
      .from(t.appointments)
      .where(
        and(
          inArray(t.appointments.staffId, staffIds),
          lt(t.appointments.startsAt, rangeEnd),
          gt(t.appointments.occupiedUntil, rangeStart),
          inArray(t.appointments.status, [...SLOT_HOLDING_STATUSES]),
          // An unpaid deposit hold stops blocking the slot once it expires.
          or(
            ne(t.appointments.status, 'awaiting_deposit'),
            isNull(t.appointments.holdExpiresAt),
            gt(t.appointments.holdExpiresAt, now),
          ),
          excludeAppointmentId ? ne(t.appointments.id, excludeAppointmentId) : undefined,
        ),
      ),
  ])
  return {
    schedules,
    breaks,
    timeOff: timeOffRows.map((r) => ({ staffId: r.staffId, start: r.startsAt.getTime(), end: r.endsAt.getTime() })),
    busy: busyRows.map((r) => ({
      staffId: r.staffId,
      start: r.startsAt.getTime(),
      end: r.occupiedUntil.getTime(),
      durationMinutes: r.durationMinutes,
      appointmentId: r.id,
    })),
  }
}

export function staffDayFor(data: StaffScheduleData, staffId: string, date: DateKey): StaffDay {
  const weekday = weekdayOf(date)
  const schedule = data.schedules.find((s) => s.staffId === staffId && s.weekday === weekday)
  const { start, end } = dayBounds(date)
  const inDay = (r: { start: number; end: number }) => r.start < end.getTime() && r.end > start.getTime()
  return {
    staffId,
    shift: schedule?.isWorking ? { startsAt: schedule.startsAt, endsAt: schedule.endsAt } : null,
    breaks: data.breaks
      .filter((b) => b.staffId === staffId && (b.weekday === null || b.weekday === weekday))
      .map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt })),
    busy: data.busy.filter((b) => b.staffId === staffId && inDay(b)),
    timeOff: data.timeOff.filter((r) => r.staffId === staffId && inDay(r)),
  }
}

/** Minutes already booked per specialist on a date — used to share "any" bookings fairly. */
export function bookedMinutesOn(data: StaffScheduleData, date: DateKey): Map<string, number> {
  const { start, end } = dayBounds(date)
  const out = new Map<string, number>()
  for (const b of data.busy) {
    if (b.start >= start.getTime() && b.start < end.getTime())
      out.set(b.staffId, (out.get(b.staffId) ?? 0) + b.durationMinutes)
  }
  return out
}

export interface PreparedSelection {
  config: SalonConfig
  catalog: BookingCatalog
  quote: Quote
  candidates: StaffSummary[]
}

/** Validates a selection against the live catalogue and returns its server-side quote. */
export async function prepareSelection(
  db: Database,
  salonId: string,
  items: SelectionItem[],
  staffId: string | null,
  { publicOnly }: { publicOnly: boolean },
): Promise<PreparedSelection> {
  const [config, catalog] = await Promise.all([loadSalonConfig(db, salonId), loadBookingCatalog(db, salonId)])
  let quote: Quote
  try {
    quote = buildQuote(items, catalog, {
      defaultBufferMinutes: config.settings.defaultBufferMinutes,
      deposit: depositPolicy(config.settings),
      maxServices: publicOnly ? config.settings.maxServicesPerBooking : undefined,
    })
  } catch (err) {
    if (err instanceof QuoteError) throw new ServiceError(err.code, err.message)
    throw err
  }
  const candidates = candidateStaff(catalog, items, staffId, { publicOnly })
  return { config, catalog, quote, candidates }
}

export interface DayAvailability {
  date: DateKey
  hours: MinuteRange | null
  special: SpecialDay | null
  slots: Slot[]
}

export async function dayAvailability(
  db: Database,
  prepared: PreparedSelection,
  date: DateKey,
  { now, publicRules, excludeAppointmentId }: { now: Date; publicRules: boolean; excludeAppointmentId?: string },
): Promise<DayAvailability> {
  const { config, quote, candidates } = prepared
  const specials = await loadSpecialDays(db, config.salon.id, date, date)
  const hours = salonHoursFor(date, config.weekly, specials)
  const special = specials[0] ?? null
  if (publicRules && preliminaryDayState(date, now, config.settings.maxAdvanceDays, hours) !== null) {
    return { date, hours, special, slots: [] }
  }
  const data = await loadStaffScheduleData(db, {
    staffIds: candidates.map((c) => c.id),
    from: date,
    to: date,
    now,
    excludeAppointmentId,
  })
  const slots = computeDaySlots({
    date,
    now,
    hours,
    durationMinutes: quote.durationMinutes,
    bufferMinutes: quote.bufferMinutes,
    slotIntervalMinutes: config.settings.slotIntervalMinutes,
    minAdvanceMinutes: publicRules ? config.settings.minAdvanceMinutes : 0,
    staff: candidates.map((c) => staffDayFor(data, c.id, date)),
  })
  return { date, hours, special, slots }
}

/** Day states for a whole month (available / full / closed / past / beyond). */
export async function monthAvailability(
  db: Database,
  prepared: PreparedSelection,
  month: string,
  { now, excludeAppointmentId }: { now: Date; excludeAppointmentId?: string },
): Promise<CalendarDay[]> {
  const { config, quote, candidates } = prepared
  const first = `${month}-01`
  const last = addDays(first, daysInMonth(first) - 1)
  const [specials, data] = await Promise.all([
    loadSpecialDays(db, config.salon.id, first, last),
    loadStaffScheduleData(db, {
      staffIds: candidates.map((c) => c.id),
      from: first,
      to: last,
      now,
      excludeAppointmentId,
    }),
  ])
  const days: CalendarDay[] = []
  for (let date = first; diffDays(date, last) <= 0; date = addDays(date, 1)) {
    const hours = salonHoursFor(date, config.weekly, specials)
    const special = specials.find((s) => s.date === date)
    const pre = preliminaryDayState(date, now, config.settings.maxAdvanceDays, hours)
    if (pre) {
      days.push({ date, state: pre, slotCount: 0, label: special?.label ?? null })
      continue
    }
    const slots = computeDaySlots({
      date,
      now,
      hours,
      durationMinutes: quote.durationMinutes,
      bufferMinutes: quote.bufferMinutes,
      slotIntervalMinutes: config.settings.slotIntervalMinutes,
      minAdvanceMinutes: config.settings.minAdvanceMinutes,
      staff: candidates.map((c) => staffDayFor(data, c.id, date)),
    })
    days.push({
      date,
      state: slots.length ? 'available' : 'full',
      slotCount: slots.length,
      label: special?.label ?? null,
    })
  }
  return days
}

/** First few bookable slots from a date onward — offered after a conflict. */
export async function nextAvailableSlots(
  db: Database,
  prepared: PreparedSelection,
  from: DateKey,
  { now, limit = 4, days = 7 }: { now: Date; limit?: number; days?: number },
): Promise<{ date: DateKey; start: number; startsAt: string }[]> {
  const out: { date: DateKey; start: number; startsAt: string }[] = []
  for (let i = 0; i < days && out.length < limit; i++) {
    const date = addDays(from, i)
    const day = await dayAvailability(db, prepared, date, { now, publicRules: true })
    for (const slot of day.slots) {
      if (out.length >= limit) break
      out.push({ date, start: slot.start, startsAt: slot.startsAt })
    }
  }
  return out
}

/** Postgres advisory lock serialising all bookings of a salon day inside a transaction. */
export async function lockSalonDay(tx: Database, salonId: string, date: DateKey) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`salon-day:${salonId}:${date}`}, 0))`)
}
