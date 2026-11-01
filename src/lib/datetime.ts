// Ulaanbaatar time helpers. Mongolia has used a fixed UTC+8 offset with no
// daylight saving since 2017, so local <-> UTC conversion is plain offset math.
// All instants are stored in UTC (timestamptz); a "date key" is a local
// calendar day in Asia/Ulaanbaatar formatted as YYYY-MM-DD.

export const TIMEZONE = 'Asia/Ulaanbaatar'
export const UB_OFFSET_MINUTES = 8 * 60
const OFFSET_MS = UB_OFFSET_MINUTES * 60_000
const DAY_MS = 86_400_000

/** ISO weekday labels, index 0 = Monday … 6 = Sunday. */
export const WEEKDAYS_MN = ['Даваа', 'Мягмар', 'Лхагва', 'Пүрэв', 'Баасан', 'Бямба', 'Ням'] as const
export const WEEKDAYS_SHORT_MN = ['Да', 'Мя', 'Лх', 'Пү', 'Ба', 'Бя', 'Ня'] as const

export type DateKey = string // YYYY-MM-DD

export interface UbParts {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  /** ISO weekday: 1 = Monday … 7 = Sunday */
  weekday: number
  minutesOfDay: number
}

export function toUbParts(date: Date): UbParts {
  const local = new Date(date.getTime() + OFFSET_MS)
  const jsDay = local.getUTCDay()
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    weekday: jsDay === 0 ? 7 : jsDay,
    minutesOfDay: local.getUTCHours() * 60 + local.getUTCMinutes(),
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

export function dateKeyOf(date: Date): DateKey {
  const p = toUbParts(date)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

export function isDateKey(value: string): value is DateKey {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** Local UB day + minutes from midnight -> UTC instant. */
export function ubToUtc(dateKey: DateKey, minutesOfDay = 0): Date {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) + minutesOfDay * 60_000 - OFFSET_MS)
}

export function addDays(dateKey: DateKey, days: number): DateKey {
  const [y, m, d] = dateKey.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS)
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a date key. */
export function weekdayOf(dateKey: DateKey): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return jsDay === 0 ? 7 : jsDay
}

export function diffDays(a: DateKey, b: DateKey): number {
  return Math.round((ubToUtc(a).getTime() - ubToUtc(b).getTime()) / DAY_MS)
}

/** 600 -> "10:00" */
export function minutesToTime(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

/** "10:30" -> 630, or null */
export function timeToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

function asDate(value: Date | string): Date {
  return typeof value === 'string' ? new Date(value) : value
}

/** "2026 оны 10 сарын 28" */
export function formatDateLong(value: Date | string): string {
  const p = toUbParts(asDate(value))
  return `${p.year} оны ${p.month} сарын ${p.day}`
}

/** "10 сарын 28, Мягмар" */
export function formatDateWithWeekday(value: Date | string): string {
  const p = toUbParts(asDate(value))
  return `${p.month} сарын ${p.day}, ${WEEKDAYS_MN[p.weekday - 1]}`
}

/** "2026.10.28" */
export function formatDateNumeric(value: Date | string): string {
  const p = toUbParts(asDate(value))
  return `${p.year}.${pad(p.month)}.${pad(p.day)}`
}

/** "10:00" */
export function formatTime(value: Date | string): string {
  const p = toUbParts(asDate(value))
  return `${pad(p.hour)}:${pad(p.minute)}`
}

/** "10 сарын 28, Мягмар · 10:00" */
export function formatDateTime(value: Date | string): string {
  return `${formatDateWithWeekday(value)} · ${formatTime(value)}`
}

/** "2026.10.28 10:00" — compact, for tables. */
export function formatDateTimeCompact(value: Date | string): string {
  return `${formatDateNumeric(value)} ${formatTime(value)}`
}

/** "10:00–14:30" */
export function formatTimeRange(start: Date | string, end: Date | string): string {
  return `${formatTime(start)}–${formatTime(end)}`
}

/** Formats a date key ("2026-10-28") as "10 сарын 28, Мягмар". */
export function formatDateKey(dateKey: DateKey): string {
  return formatDateWithWeekday(ubToUtc(dateKey, 12 * 60))
}

/** Hours from now until `date` (negative once it has passed). */
export function hoursUntil(date: Date, now: Date = new Date()): number {
  return (date.getTime() - now.getTime()) / 3_600_000
}

/** 270 -> "4 цаг 30 мин" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h && m) return `${h} цаг ${m} мин`
  if (h) return `${h} цаг`
  return `${m} мин`
}

export const MONTHS_MN = [
  '1-р сар',
  '2-р сар',
  '3-р сар',
  '4-р сар',
  '5-р сар',
  '6-р сар',
  '7-р сар',
  '8-р сар',
  '9-р сар',
  '10-р сар',
  '11-р сар',
  '12-р сар',
] as const

/** Monday of the week containing the date. */
export function startOfWeek(dateKey: DateKey): DateKey {
  return addDays(dateKey, 1 - weekdayOf(dateKey))
}

/** "2026-11" for a date key. */
export function monthOf(dateKey: DateKey): string {
  return dateKey.slice(0, 7)
}

export function firstOfMonth(dateKey: DateKey): DateKey {
  return `${dateKey.slice(0, 7)}-01`
}

/** Adds whole months to the first day of a month: ("2026-11-01", 1) -> "2026-12-01". */
export function addMonths(dateKey: DateKey, months: number): DateKey {
  const [y, m] = dateKey.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + months, 1))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-01`
}

export function daysInMonth(dateKey: DateKey): number {
  const [y, m] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** "2026 оны 11-р сар" */
export function formatMonthYear(dateKey: DateKey): string {
  const [y, m] = dateKey.split('-').map(Number)
  return `${y} оны ${MONTHS_MN[m - 1]}`
}

/** "11/28" — compact day label for charts. */
export function formatShortDate(dateKey: DateKey): string {
  const [, m, d] = dateKey.split('-').map(Number)
  return `${m}/${d}`
}

/** UTC instants bounding a local UB day: [start, next day start). */
export function dayBounds(dateKey: DateKey): { start: Date; end: Date } {
  return { start: ubToUtc(dateKey, 0), end: ubToUtc(addDays(dateKey, 1), 0) }
}

/** "Өнөөдөр" / "Маргааш" / "11 сарын 3, Мягмар". */
export function relativeDayLabel(dateKey: DateKey, today: DateKey): string {
  const d = diffDays(dateKey, today)
  if (d === 0) return 'Өнөөдөр'
  if (d === 1) return 'Маргааш'
  return formatDateKey(dateKey)
}

/** Minutes from local midnight of an instant. */
export function minutesOfDay(value: Date | string): number {
  return toUbParts(asDate(value)).minutesOfDay
}
