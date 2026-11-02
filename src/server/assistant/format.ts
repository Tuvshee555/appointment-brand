// How the assistant writes facts: prices, durations, dates and hours, in Mongolian or English.
import {
  diffDays,
  formatDateKey,
  formatDuration,
  minutesToTime,
  relativeDayLabel,
  weekdayOf,
  WEEKDAYS_MN,
  type DateKey,
} from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { formatPhone } from '@/lib/phone'
import type { PortSalon, PortService } from './salon/port'

export type Locale = 'mn' | 'en'

export const say = (locale: Locale, mn: string, en: string) => (locale === 'en' ? en : mn)

const WEEKDAYS_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function duration(minutes: number, locale: Locale): string {
  if (locale === 'mn') return formatDuration(minutes)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return [h ? `${h} hour${h > 1 ? 's' : ''}` : '', m ? `${m} min` : ''].filter(Boolean).join(' ')
}

export function price(s: { price: number; priceType: 'fixed' | 'from' }, locale: Locale): string {
  return `${formatMoney(s.price)}${s.priceType === 'from' ? say(locale, '-өөс', ' and up') : ''}`
}

export function dayLabel(date: DateKey, today: DateKey, locale: Locale): string {
  if (locale === 'mn') return relativeDayLabel(date, today)
  const d = diffDays(date, today)
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  const [, m, day] = date.split('-').map(Number)
  return `${WEEKDAYS_EN[weekdayOf(date) - 1]}, ${MONTHS_EN[m - 1]} ${day}`
}

/** "Маргааш (11 сарын 11, Лхагва)" / "tomorrow (Wednesday, Nov 11)". */
export function fullDayLabel(date: DateKey, today: DateKey, locale: Locale): string {
  const rel = dayLabel(date, today, locale)
  const abs = locale === 'mn' ? formatDateKey(date) : dayLabel(date, '0000-00-00', 'en')
  return diffDays(date, today) <= 1 ? `${rel} (${abs})` : abs
}

export const clock = minutesToTime

export function serviceLine(s: PortService, locale: Locale): string {
  return `${s.name} — ${price(s, locale)}, ${duration(s.durationMinutes, locale)}`
}

export function weekdayName(isoWeekday: number, locale: Locale): string {
  return locale === 'mn' ? WEEKDAYS_MN[isoWeekday - 1] : WEEKDAYS_EN[isoWeekday - 1]
}

/** Weekly hours with equal days grouped: "Мягмар–Баасан: 10:00–20:00". */
export function weeklyHours(salon: PortSalon, locale: Locale): string[] {
  const rows = [...salon.weekly].sort((a, b) => a.weekday - b.weekday)
  const label = (w: (typeof rows)[number]) =>
    w.isClosed ? say(locale, 'амарна', 'closed') : `${clock(w.opensAt)}–${clock(w.closesAt)}`
  const groups: { from: number; to: number; text: string }[] = []
  for (const w of rows) {
    const text = label(w)
    const last = groups.at(-1)
    if (last && last.text === text && last.to === w.weekday - 1) last.to = w.weekday
    else groups.push({ from: w.weekday, to: w.weekday, text })
  }
  return groups.map(
    (g) =>
      `${weekdayName(g.from, locale)}${g.to !== g.from ? `${g.to === g.from + 1 ? ', ' : '–'}${weekdayName(g.to, locale)}` : ''}: ${g.text}`,
  )
}

export const phone = formatPhone
