// Dates and clock times in customers' words. Input is normText() output (Cyrillic words, clock
// times kept as "15:30"); the original lower-cased text is passed too for English forms
// ("4pm", "nov 20"). A bare hour is read against the business hours of that day: "3 tsagt" at a
// salon open 10:00–20:00 is 15:00, "10 tsagt" is 10:00. Pure and business-agnostic.
import { addDays, isDateKey, weekdayOf, type DateKey } from '@/lib/datetime'

export interface Hours {
  opensAt: number
  closesAt: number
}

export interface TimeRange {
  from?: number
  to?: number
  label: 'morning' | 'afternoon' | 'evening' | 'custom'
}

export interface WhenParse {
  date?: DateKey
  /** The day came from a weekday name (the customer did not give a calendar date). */
  fromWeekday?: boolean
  time?: number
  range?: TimeRange
  /** The message asks how long something takes ("hed tsag oroh ve"), not at what time. */
  durationQuestion?: boolean
}

const WEEKDAYS = ['даваа', 'мягмар', 'лхагва', 'пүрэв', 'баасан', 'бямба', 'ням']
const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DEFAULT_HOURS: Hours = { opensAt: 10 * 60, closesAt: 20 * 60 }
const DURATION_AFTER = '(?:орох|ордог|үргэлжл|болох|болдог|зарцуул|шаард|хэрэгт|орно)'

function upcomingWeekday(today: DateKey, isoWeekday: number): DateKey {
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i)
    if (weekdayOf(d) === isoWeekday) return d
  }
  return today
}

/** The next occurrence of month/day on or after today (rolling into next year). */
function monthDay(today: DateKey, month: number, day: number): DateKey | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  const year = Number(today.slice(0, 4))
  const key = (y: number) => `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const thisYear = key(year)
  if (!isDateKey(thisYear)) return undefined
  return thisYear < today ? key(year + 1) : thisYear
}

export function parseDate(norm: string, raw: string, today: DateKey): { date?: DateKey; fromWeekday?: boolean } {
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(raw)
  if (iso && isDateKey(iso[1])) return { date: iso[1] }
  if (/нөгөөдөр/.test(norm)) return { date: addDays(today, 2) }
  if (/маргааш/.test(norm)) return { date: addDays(today, 1) }
  if (/өнөөдөр/.test(norm)) return { date: today }
  const inDays = /(\d{1,2})\s*(?:хоногийн|өдрийн|honogiin|udriin)\s*дараа/.exec(norm)
  if (inDays) return { date: addDays(today, Number(inDays[1])) }

  // "11 сарын 20", "11-р сарын 20-нд"
  const mnMonth = /(\d{1,2})\s*(?:р|-р|-р\s)?\s*сарын\s*(\d{1,2})/.exec(norm)
  if (mnMonth) {
    const d = monthDay(today, Number(mnMonth[1]), Number(mnMonth[2]))
    if (d) return { date: d }
  }
  // "11/20"
  const slash = /\b(\d{1,2})\/(\d{1,2})\b/.exec(raw)
  if (slash) {
    const d = monthDay(today, Number(slash[1]), Number(slash[2]))
    if (d) return { date: d }
  }
  // "nov 20", "20 november"
  const en = new RegExp(
    `\\b(?:(${MONTHS_EN.join('|')})[a-z]*\\.?\\s*(\\d{1,2})|(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS_EN.join('|')})[a-z]*)\\b`,
  ).exec(raw)
  if (en) {
    const month = MONTHS_EN.indexOf((en[1] ?? en[4]).slice(0, 3)) + 1
    const d = monthDay(today, month, Number(en[2] ?? en[3]))
    if (d) return { date: d }
  }
  // "20-нд", "20nd" — a day of this month (or the next, once it has passed)
  const dayOnly = /(?:^|\s)(\d{1,2})\s*-?\s*(?:нд|ны|ний|ний өдөр|nd|nii|ny|ni|th)(?=\s|$)/.exec(`${norm} ${raw}`)
  if (dayOnly) {
    const day = Number(dayOnly[1])
    let month = Number(today.slice(5, 7))
    if (day < Number(today.slice(8, 10))) month = (month % 12) + 1
    const d = monthDay(today, month, day)
    if (d) return { date: d }
  }

  const wd = WEEKDAYS.findIndex((w) => new RegExp(`(?:^|\\s)${w}`).test(norm))
  if (wd >= 0) {
    let date = upcomingWeekday(today, wd + 1)
    if (/(?:дараа|ирэх|дараагийн)\s*(?:долоо|7)\s*хоног|next\s+week/.test(`${norm} ${raw}`)) date = addDays(date, 7)
    return { date, fromWeekday: true }
  }
  return {}
}

/**
 * The minute of day a customer means by hour `h` (with optional minutes): morning/evening words
 * and am/pm decide; otherwise the reading inside the business hours wins, then the nearer one.
 */
export function resolveHour(
  h: number,
  m: number,
  opts: { part?: 'am' | 'pm' | 'morning' | 'afternoon' | 'evening'; hours?: Hours | null } = {},
): number | undefined {
  if (h < 0 || h > 24 || m < 0 || m > 59) return undefined
  const { part } = opts
  if (part === 'am') return (h % 12) * 60 + m
  if (part === 'pm' || part === 'evening' || part === 'afternoon') return ((h % 12) + 12) * 60 + m
  if (part === 'morning' || h >= 13 || h === 0) return h * 60 + m
  const hours = opts.hours ?? DEFAULT_HOURS
  const candidates = h === 12 ? [12 * 60 + m] : [h * 60 + m, (h + 12) * 60 + m]
  const inside = candidates.filter((t) => t >= hours.opensAt && t < hours.closesAt)
  if (inside.length) return inside[0]
  const distance = (t: number) => (t < hours.opensAt ? hours.opensAt - t : t - hours.closesAt)
  return [...candidates].sort((a, b) => distance(a) - distance(b))[0]
}

function partOfDay(norm: string, raw: string): 'am' | 'pm' | 'morning' | 'afternoon' | 'evening' | undefined {
  if (/\b\d{1,2}(?::\d\d)?\s*am\b/.test(raw)) return 'am'
  if (/\b\d{1,2}(?::\d\d)?\s*pm\b/.test(raw)) return 'pm'
  if (/орой/.test(norm)) return 'evening'
  if (/үдээс\s*хойш|өд(?:өр|рийн)\s*\d/.test(norm)) return 'afternoon'
  if (/өглөө/.test(norm)) return 'morning'
  return undefined
}

/** Clock time, a time window ("орой", "15 цагаас хойш") or a duration question. */
export function parseTime(norm: string, raw: string, hours?: Hours | null): Omit<WhenParse, 'date' | 'fromWeekday'> {
  const text = `${norm} `
  if (
    /хэр\s*удаан|хугацаа|how\s+long/.test(`${norm} ${raw}`) ||
    new RegExp(`(?:хэдэн|хэд|\\d+)\\s*(?:цаг(?!т(?:\\s|$))|минут)[а-яөүё]*\\s*${DURATION_AFTER}`).test(norm)
  ) {
    return { durationQuestion: true }
  }
  const part = partOfDay(norm, raw)
  const opts = { part, hours }

  // "15:30", "3:30"
  const clock = /(?:^|\s)(\d{1,2}):(\d{2})(?=\s|$|\D)/.exec(text)
  if (clock) {
    const time = resolveHour(Number(clock[1]), Number(clock[2]), opts)
    if (time !== undefined) return { time }
  }
  // "3 цаг хагаст", "3 цаг 15 минутад"
  const half = /(\d{1,2})\s*цаг[а-яөүё]*\s*хагас/.exec(norm)
  if (half) return { time: resolveHour(Number(half[1]), 30, opts) }
  const hm = /(\d{1,2})\s*цаг[а-яөүё]*\s*(\d{1,2})\s*минут/.exec(norm)
  if (hm) return { time: resolveHour(Number(hm[1]), Number(hm[2]), opts) }
  // "15 цагаас хойш", "17 цаг хүртэл", "15-17 цагийн хооронд"
  const between = /(\d{1,2})\s*(?:-|аас|ээс|оос)?\s*(\d{1,2})\s*цаг[а-яөүё]*\s*(?:хооронд|хүртэл)/.exec(norm)
  if (between) {
    const from = resolveHour(Number(between[1]), 0, opts)
    const to = resolveHour(Number(between[2]), 0, opts)
    if (from !== undefined && to !== undefined && to > from) return { range: { from, to, label: 'custom' } }
  }
  const after = /(\d{1,2})\s*цаг(?:аас|ийн\s*дараа)?\s*хойш/.exec(norm)
  if (after) return { range: { from: resolveHour(Number(after[1]), 0, opts), label: 'custom' } }
  const until = /(\d{1,2})\s*цаг[а-яөүё]*\s*хүртэл/.exec(norm)
  if (until) return { range: { to: resolveHour(Number(until[1]), 0, opts), label: 'custom' } }
  // "3 цагт", "15 цаг", "орой 6", "4 pm", "at 11", "11am"
  const hour =
    /(?:^|\s)(\d{1,2})\s*цаг(?:т|ийн|аас)?(?=\s|$)/.exec(text) ??
    /\b(\d{1,2})\s*(?:am|pm)\b/.exec(raw) ??
    /\bat\s+(\d{1,2})\b/.exec(raw) ??
    (part && part !== 'am' && part !== 'pm' ? /(?:орой|өглөө|өдөр|өдрийн)\s*(\d{1,2})(?=\s|$)/.exec(norm) : null)
  if (hour) {
    const time = resolveHour(Number(hour[1]), 0, opts)
    if (time !== undefined) return { time }
  }
  if (part === 'evening') return { range: { from: 17 * 60, label: 'evening' } }
  if (part === 'afternoon') return { range: { from: 13 * 60, to: 17 * 60, label: 'afternoon' } }
  if (part === 'morning') return { range: { to: 12 * 60, label: 'morning' } }
  return {}
}

/** A bare number answering "which time?": "15" → 15:00, "3" → 15:00 inside 10:00–20:00. */
export function bareHour(raw: string, hours?: Hours | null): number | undefined {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(?:цаг[а-яөүё]*|tsag\w*|h)?\s*[.!]?\s*$/i.exec(raw)
  if (!m) return undefined
  const h = Number(m[1])
  if (h > 23) return undefined
  return resolveHour(h, Number(m[2] ?? 0), { hours })
}

/** Date and time of one message; `fallbackDate` (the day already agreed) sets the hours for a bare time. */
export function parseWhen(
  norm: string,
  raw: string,
  today: DateKey,
  hoursFor?: (d: DateKey) => Hours | null,
  fallbackDate?: DateKey,
) {
  const day = parseDate(norm, raw, today)
  const hoursDay = day.date ?? fallbackDate
  const time = parseTime(norm, raw, hoursDay && hoursFor ? hoursFor(hoursDay) : undefined)
  return { ...day, ...time } satisfies WhenParse
}
