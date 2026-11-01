// Availability engine. Pure and deterministic: the server feeds it rows loaded
// from the database (hours, shifts, breaks, time off, slot-holding
// appointments) and it returns real bookable start times. The same function
// runs again inside the booking transaction, so a slot shown to a customer is
// re-validated against fresh data before anything is written.
//
// Units: times of day are minutes from local midnight (Asia/Ulaanbaatar);
// instants are UTC epoch milliseconds.
import { addDays, dateKeyOf, diffDays, ubToUtc, weekdayOf, type DateKey } from '@/lib/datetime'

export interface MinuteRange {
  startsAt: number
  endsAt: number
}

export interface InstantRange {
  start: number
  end: number
}

export interface WeeklyHours {
  weekday: number
  isClosed: boolean
  opensAt: number
  closesAt: number
}

export interface SpecialDay {
  date: DateKey
  kind: 'closed' | 'special_hours'
  opensAt: number | null
  closesAt: number | null
  label: string
}

export interface StaffDay {
  staffId: string
  /** Working shift for this date, or null when the specialist is off. */
  shift: MinuteRange | null
  breaks: MinuteRange[]
  /** Slot-holding appointments: [starts_at, occupied_until). */
  busy: InstantRange[]
  timeOff: InstantRange[]
}

export interface DayRequest {
  date: DateKey
  now: Date
  /** Salon opening window for the date (after special-day overrides), or null when closed. */
  hours: MinuteRange | null
  durationMinutes: number
  bufferMinutes: number
  slotIntervalMinutes: number
  minAdvanceMinutes: number
  staff: StaffDay[]
}

export interface Slot {
  /** Minutes from local midnight. */
  start: number
  end: number
  startsAt: string
  endsAt: string
  /** Specialists free for the whole appointment at this start time. */
  staffIds: string[]
}

const MINUTE = 60_000

export function overlaps(a: InstantRange, b: InstantRange): boolean {
  return a.start < b.end && b.start < a.end
}

function minutesOverlap(a: MinuteRange, b: MinuteRange): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt
}

/** The salon's opening window on a date: special days override the weekly template. */
export function salonHoursFor(date: DateKey, weekly: WeeklyHours[], specials: SpecialDay[]): MinuteRange | null {
  const special = specials.find((s) => s.date === date)
  if (special) {
    if (special.kind === 'closed' || special.opensAt === null || special.closesAt === null) return null
    return { startsAt: special.opensAt, endsAt: special.closesAt }
  }
  const day = weekly.find((w) => w.weekday === weekdayOf(date))
  if (!day || day.isClosed) return null
  return { startsAt: day.opensAt, endsAt: day.closesAt }
}

/** Can this specialist take an appointment starting at `start` (local minutes)? */
export function isStaffFree(request: Omit<DayRequest, 'staff'>, staff: StaffDay, start: number): boolean {
  const { hours, durationMinutes, bufferMinutes } = request
  if (!hours || !staff.shift) return false
  const end = start + durationMinutes
  const windowStart = Math.max(hours.startsAt, staff.shift.startsAt)
  const windowEnd = Math.min(hours.endsAt, staff.shift.endsAt)
  if (start < windowStart || end > windowEnd) return false
  if (staff.breaks.some((b) => minutesOverlap({ startsAt: start, endsAt: end }, b))) return false

  const startMs = ubToUtc(request.date, start).getTime()
  if (startMs < request.now.getTime() + request.minAdvanceMinutes * MINUTE) return false
  const endMs = startMs + durationMinutes * MINUTE
  if (staff.timeOff.some((t) => overlaps({ start: startMs, end: endMs }, t))) return false
  // The new appointment occupies the specialist until its buffer has passed.
  const occupied = { start: startMs, end: endMs + bufferMinutes * MINUTE }
  return !staff.busy.some((b) => overlaps(occupied, b))
}

/** All bookable start times on one date, with the specialists free at each. */
export function computeDaySlots(request: DayRequest): Slot[] {
  const { hours, durationMinutes, slotIntervalMinutes: step } = request
  if (!hours || durationMinutes <= 0 || step <= 0) return []
  const first = Math.ceil(hours.startsAt / step) * step
  const slots: Slot[] = []
  for (let start = first; start + durationMinutes <= hours.endsAt; start += step) {
    const staffIds = request.staff.filter((s) => isStaffFree(request, s, start)).map((s) => s.staffId)
    if (staffIds.length === 0) continue
    const startsAt = ubToUtc(request.date, start)
    slots.push({
      start,
      end: start + durationMinutes,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + durationMinutes * MINUTE).toISOString(),
      staffIds,
    })
  }
  return slots
}

export type DayState = 'available' | 'full' | 'closed' | 'past' | 'beyond'

export interface CalendarDay {
  date: DateKey
  state: DayState
  slotCount: number
  label: string | null
}

export function bookingWindow(now: Date, maxAdvanceDays: number) {
  const today = dateKeyOf(now)
  return { first: today, last: addDays(today, maxAdvanceDays) }
}

/** Classifies a date for the booking calendar before any slot is computed. */
export function preliminaryDayState(date: DateKey, now: Date, maxAdvanceDays: number, hours: MinuteRange | null): DayState | null {
  const { first, last } = bookingWindow(now, maxAdvanceDays)
  if (diffDays(date, first) < 0) return 'past'
  if (diffDays(date, last) > 0) return 'beyond'
  if (!hours) return 'closed'
  return null
}

/**
 * Chooses a specialist for "any available": the one with the least booked
 * time that day, then the salon's display order. Keeps work evenly shared.
 */
export function pickStaff(candidates: string[], bookedMinutes: Map<string, number>, order: string[]): string | null {
  if (candidates.length === 0) return null
  const rank = (id: string) => {
    const i = order.indexOf(id)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return [...candidates].sort((a, b) => (bookedMinutes.get(a) ?? 0) - (bookedMinutes.get(b) ?? 0) || rank(a) - rank(b))[0]
}

/** Groups slots into parts of the day for touch-friendly pickers. */
export function groupSlots(slots: Slot[]) {
  return {
    morning: slots.filter((s) => s.start < 12 * 60),
    afternoon: slots.filter((s) => s.start >= 12 * 60 && s.start < 17 * 60),
    evening: slots.filter((s) => s.start >= 17 * 60),
  }
}
