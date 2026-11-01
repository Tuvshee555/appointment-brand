import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  dateKeyOf,
  dayBounds,
  daysInMonth,
  diffDays,
  formatDuration,
  isDateKey,
  minutesOfDay,
  minutesToTime,
  relativeDayLabel,
  startOfWeek,
  timeToMinutes,
  ubToUtc,
  weekdayOf,
} from '@/lib/datetime'
import { formatMoney, parseMoneyInput, percentOf } from '@/lib/money'
import { formatPhone, maskPhone, normalizePhone } from '@/lib/phone'

describe('Ulaanbaatar time (UTC+8, no daylight saving)', () => {
  it('converts wall-clock time to UTC and back', () => {
    const start = ubToUtc('2026-11-12', 10 * 60)
    expect(start.toISOString()).toBe('2026-11-12T02:00:00.000Z')
    expect(minutesOfDay(start)).toBe(600)
  })

  it('uses the local calendar day, not the UTC one', () => {
    expect(dateKeyOf(new Date('2026-11-12T17:30:00Z'))).toBe('2026-11-13') // 01:30 in UB
    expect(dateKeyOf(new Date('2026-11-12T15:59:00Z'))).toBe('2026-11-12')
  })

  it('bounds a local day', () => {
    const { start, end } = dayBounds('2026-11-12')
    expect(start.toISOString()).toBe('2026-11-11T16:00:00.000Z')
    expect(end.getTime() - start.getTime()).toBe(24 * 3_600_000)
  })

  it('does calendar arithmetic on date keys', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(diffDays('2027-01-02', '2026-11-03')).toBe(60)
    expect(weekdayOf('2026-11-12')).toBe(4)
    expect(weekdayOf('2026-11-15')).toBe(7)
    expect(startOfWeek('2026-11-15')).toBe('2026-11-09')
    expect(addMonths('2026-11-01', 2)).toBe('2027-01-01')
    expect(daysInMonth('2028-02-01')).toBe(29)
    expect(isDateKey('2026-02-30')).toBe(false)
    expect(relativeDayLabel('2026-11-13', '2026-11-12')).toBe('Маргааш')
  })

  it('parses and formats clock times', () => {
    expect(timeToMinutes('9:05')).toBe(545)
    expect(timeToMinutes('24:00')).toBeNull()
    expect(timeToMinutes('10.30')).toBeNull()
    expect(minutesToTime(545)).toBe('09:05')
    expect(formatDuration(150)).toBe('2 цаг 30 мин')
    expect(formatDuration(60)).toBe('1 цаг')
    expect(formatDuration(45)).toBe('45 мин')
  })
})

describe('money', () => {
  it('formats whole tögrög', () => {
    expect(formatMoney(125_000)).toBe('125,000₮')
    expect(formatMoney(-45_800)).toBe('-45,800₮')
  })
  it('parses user input', () => {
    expect(parseMoneyInput('125,000₮')).toBe(125_000)
    expect(parseMoneyInput('12.5')).toBeNull()
  })
  it('computes percentages from basis points', () => {
    expect(percentOf(65_000, 3000)).toBe(19_500)
    expect(percentOf(65_000, 3000, 1000)).toBe(20_000)
  })
})

describe('Mongolian phone numbers', () => {
  it('normalises common spellings to 8 digits', () => {
    expect(normalizePhone('9911 2233')).toBe('99112233')
    expect(normalizePhone('+976 8811-2233')).toBe('88112233')
    expect(normalizePhone('97699112233')).toBe('99112233')
  })
  it('rejects numbers that are not Mongolian', () => {
    expect(normalizePhone('1234')).toBeNull()
    expect(normalizePhone('11223344')).toBeNull()
  })
  it('formats and masks', () => {
    expect(formatPhone('99112233')).toBe('9911 2233')
    expect(maskPhone('99112233')).toBe('99****33')
  })
})
