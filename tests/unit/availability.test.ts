import { describe, expect, it } from 'vitest'
import {
  computeDaySlots,
  groupSlots,
  isStaffFree,
  overlaps,
  pickStaff,
  preliminaryDayState,
  salonHoursFor,
  type DayRequest,
  type StaffDay,
  type WeeklyHours,
} from '@/lib/availability/engine'
import { ubToUtc } from '@/lib/datetime'

const DATE = '2026-11-12' // Thursday
const h = (hours: number, minutes = 0) => hours * 60 + minutes
const at = (minutes: number, date = DATE) => ubToUtc(date, minutes).getTime()

function staff(overrides: Partial<StaffDay> = {}): StaffDay {
  return { staffId: 'a', shift: { startsAt: h(10), endsAt: h(18) }, breaks: [], busy: [], timeOff: [], ...overrides }
}

function request(overrides: Partial<DayRequest> = {}): DayRequest {
  return {
    date: DATE,
    now: new Date('2026-11-03T00:00:00Z'),
    hours: { startsAt: h(10), endsAt: h(20) },
    durationMinutes: 60,
    bufferMinutes: 10,
    slotIntervalMinutes: 15,
    minAdvanceMinutes: 120,
    staff: [staff()],
    ...overrides,
  }
}

const starts = (req: DayRequest) => computeDaySlots(req).map((s) => s.start)

describe('salonHoursFor', () => {
  const weekly: WeeklyHours[] = [
    { weekday: 1, isClosed: true, opensAt: h(10), closesAt: h(20) },
    { weekday: 4, isClosed: false, opensAt: h(10), closesAt: h(20) },
  ]

  it('uses the weekly template', () => {
    expect(salonHoursFor(DATE, weekly, [])).toEqual({ startsAt: h(10), endsAt: h(20) })
    expect(salonHoursFor('2026-11-09', weekly, [])).toBeNull() // Monday, closed
    expect(salonHoursFor('2026-11-11', weekly, [])).toBeNull() // no row for Wednesday
  })

  it('lets special days override the template', () => {
    const closed = { date: DATE, kind: 'closed' as const, opensAt: null, closesAt: null, label: 'Баяр' }
    expect(salonHoursFor(DATE, weekly, [closed])).toBeNull()
    const short = { date: DATE, kind: 'special_hours' as const, opensAt: h(12), closesAt: h(16), label: 'Богино' }
    expect(salonHoursFor(DATE, weekly, [short])).toEqual({ startsAt: h(12), endsAt: h(16) })
  })
})

describe('computeDaySlots', () => {
  it('offers every step inside the shift, ending by the shift end', () => {
    const slots = starts(request())
    expect(slots[0]).toBe(h(10))
    expect(slots.at(-1)).toBe(h(17)) // 17:00 + 60 min = 18:00 shift end
    expect(slots).toHaveLength((h(17) - h(10)) / 15 + 1)
  })

  it('aligns the first start to the slot interval', () => {
    expect(starts(request({ hours: { startsAt: h(10, 5), endsAt: h(20) } }))[0]).toBe(h(10, 15))
  })

  it('returns nothing when the salon is closed or the specialist is off', () => {
    expect(computeDaySlots(request({ hours: null }))).toEqual([])
    expect(computeDaySlots(request({ staff: [staff({ shift: null })] }))).toEqual([])
  })

  it('keeps appointments out of breaks', () => {
    const slots = starts(request({ staff: [staff({ breaks: [{ startsAt: h(13), endsAt: h(13, 30) }] })] }))
    expect(slots).toContain(h(12)) // ends exactly when the break starts
    expect(slots).not.toContain(h(12, 15))
    expect(slots).not.toContain(h(13, 15))
    expect(slots).toContain(h(13, 30))
  })

  it('respects existing appointments and the buffer on both sides', () => {
    // Existing 12:00–13:00, occupied until 13:10 (10 min buffer).
    const busy = [{ start: at(h(12)), end: at(h(13, 10)) }]
    const slots = starts(request({ staff: [staff({ busy })] }))
    expect(slots).toContain(h(10, 45)) // 10:45–11:45, its own buffer ends 11:55
    expect(slots).not.toContain(h(11)) // its buffer would run into 12:00
    expect(slots).not.toContain(h(13)) // still inside the previous buffer
    expect(slots).toContain(h(13, 15))
  })

  it('applies the minimum notice', () => {
    // 09:00 in Ulaanbaatar on the same day, 120 minutes notice -> 11:00 at the earliest.
    const now = new Date(at(h(9)))
    const slots = starts(request({ now }))
    expect(slots[0]).toBe(h(11))
  })

  it('blocks time off', () => {
    const timeOff = [{ start: at(h(14)), end: at(h(18)) }]
    const slots = starts(request({ staff: [staff({ timeOff })] }))
    expect(slots.at(-1)).toBe(h(13)) // 13:00–14:00 is the last one that fits
  })

  it('lists every specialist free at each time', () => {
    const a = staff({ staffId: 'a', busy: [{ start: at(h(10)), end: at(h(11)) }] })
    const b = staff({ staffId: 'b' })
    const slots = computeDaySlots(request({ staff: [a, b] }))
    expect(slots.find((s) => s.start === h(10))?.staffIds).toEqual(['b'])
    expect(slots.find((s) => s.start === h(12))?.staffIds).toEqual(['a', 'b'])
  })

  it('returns UTC instants for Ulaanbaatar wall-clock times', () => {
    const [first] = computeDaySlots(request())
    expect(first.startsAt).toBe('2026-11-12T02:00:00.000Z')
    expect(first.endsAt).toBe('2026-11-12T03:00:00.000Z')
  })
})

describe('isStaffFree', () => {
  it('rejects starts outside the overlap of salon hours and the shift', () => {
    const req = request({ hours: { startsAt: h(11), endsAt: h(20) } })
    expect(isStaffFree(req, staff(), h(10))).toBe(false)
    expect(isStaffFree(req, staff(), h(11))).toBe(true)
    expect(isStaffFree(req, staff(), h(17, 15))).toBe(false) // would end after 18:00
  })
})

describe('overlaps', () => {
  it('treats ranges as half-open', () => {
    expect(overlaps({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false)
    expect(overlaps({ start: 0, end: 11 }, { start: 10, end: 20 })).toBe(true)
  })
})

describe('preliminaryDayState', () => {
  const now = new Date('2026-11-03T00:00:00Z')
  const open = { startsAt: h(10), endsAt: h(20) }
  it('classifies dates before computing slots', () => {
    expect(preliminaryDayState('2026-11-02', now, 60, open)).toBe('past')
    expect(preliminaryDayState('2027-01-03', now, 60, open)).toBe('beyond')
    expect(preliminaryDayState('2027-01-02', now, 60, open)).toBeNull()
    expect(preliminaryDayState(DATE, now, 60, null)).toBe('closed')
  })
})

describe('pickStaff', () => {
  it('prefers the least booked specialist, then display order', () => {
    const booked = new Map([
      ['a', 120],
      ['b', 30],
    ])
    expect(pickStaff(['a', 'b', 'c'], booked, ['a', 'b', 'c'])).toBe('c')
    expect(pickStaff(['a', 'b'], booked, ['a', 'b'])).toBe('b')
    expect(pickStaff(['b', 'a'], new Map(), ['a', 'b'])).toBe('a')
    expect(pickStaff([], booked, [])).toBeNull()
  })
})

describe('groupSlots', () => {
  it('splits the day into morning, afternoon and evening', () => {
    const groups = groupSlots(
      computeDaySlots(request({ staff: [staff({ shift: { startsAt: h(10), endsAt: h(20) } })] })),
    )
    expect(groups.morning.every((s) => s.start < h(12))).toBe(true)
    expect(groups.afternoon[0].start).toBe(h(12))
    expect(groups.evening[0].start).toBe(h(17))
  })
})
