import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import Link from 'next/link'
import { connection } from 'next/server'
import { PageHeader } from '@/components/admin/ui'
import { buttonClass } from '@/components/ui/button'
import { STATUS_SHORT } from '@/lib/booking/status'
import {
  addDays,
  addMonths,
  dateKeyOf,
  dayBounds,
  daysInMonth,
  diffDays,
  firstOfMonth,
  formatDateKey,
  formatMonthYear,
  formatShortDate,
  isDateKey,
  minutesOfDay,
  minutesToTime,
  startOfWeek,
  weekdayOf,
  WEEKDAYS_SHORT_MN,
  type DateKey,
} from '@/lib/datetime'
import { cn } from '@/lib/cn'
import { requireAdminPage } from '@/server/auth/current'
import { loadCalendar, type CalendarAppointment } from '@/server/queries/admin-calendar'

export const metadata = { title: 'Хуанли' }

type View = 'day' | 'week' | 'month'

const BLOCK_STYLE: Record<string, string> = {
  confirmed: 'bg-porcelain border-l-4',
  pending: 'bg-sky-50 border-l-4 border-dashed',
  awaiting_deposit: 'bg-amber-50 border-l-4 border-dashed',
  completed: 'bg-cocoa-50 border-l-4 opacity-80',
  no_show: 'bg-rose-50 border-l-4',
  cancelled: 'bg-sand border-l-4 line-through opacity-60',
  rejected: 'bg-sand border-l-4 line-through opacity-60',
  expired: 'bg-sand border-l-4 line-through opacity-60',
  rescheduled: 'bg-sand border-l-4 line-through opacity-60',
}

function href(params: { view: View; date: DateKey; staff: string | null; cancelled: boolean }) {
  const q = new URLSearchParams({ view: params.view, date: params.date })
  if (params.staff) q.set('staff', params.staff)
  if (params.cancelled) q.set('cancelled', '1')
  return `/admin/calendar?${q.toString()}`
}

function Block({
  a,
  color,
  top,
  height,
  left = 0,
  width = 100,
  compact,
}: {
  a: CalendarAppointment
  color: string
  top: number
  height: number
  left?: number
  width?: number
  compact?: boolean
}) {
  return (
    <Link
      href={`/admin/appointments/${a.id}`}
      className={cn(
        'absolute overflow-hidden rounded-xs border border-line px-2 py-1 text-[0.72rem] leading-tight shadow-sm hover:z-10 hover:shadow-soft',
        BLOCK_STYLE[a.status],
      )}
      style={{
        top,
        height: Math.max(height, 22),
        left: `calc(${left}% + 2px)`,
        width: `calc(${width}% - 4px)`,
        borderLeftColor: color,
      }}
      title={`${minutesToTime(minutesOfDay(a.startsAt))}–${minutesToTime(minutesOfDay(a.endsAt))} · ${a.customerName} · ${a.services} · ${STATUS_SHORT[a.status]}`}
    >
      <span className="tabular block font-medium text-ink">
        {minutesToTime(minutesOfDay(a.startsAt))} {compact ? '' : `– ${minutesToTime(minutesOfDay(a.endsAt))}`}
      </span>
      <span className="block truncate text-ink-2">{a.customerName}</span>
      {height > 52 ? <span className="block truncate text-ink-3">{a.services}</span> : null}
      {height > 70 ? <span className="block text-[0.65rem] text-ink-3">{STATUS_SHORT[a.status]}</span> : null}
    </Link>
  )
}

function lanes(items: CalendarAppointment[]) {
  const ends: number[] = []
  const lane = new Map<string, number>()
  for (const a of [...items].sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime())) {
    let i = ends.findIndex((e) => e <= a.startsAt.getTime())
    if (i === -1) i = ends.push(0) - 1
    ends[i] = a.endsAt.getTime()
    lane.set(a.id, i)
  }
  return { lane, count: Math.max(1, ends.length) }
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; staff?: string; cancelled?: string }>
}) {
  const session = await requireAdminPage('appointments.view')
  await connection()
  const sp = await searchParams
  const today = dateKeyOf(new Date())
  const view: View = sp.view === 'week' || sp.view === 'month' ? sp.view : 'day'
  const date = sp.date && isDateKey(sp.date) ? sp.date : today
  const staffParam = sp.staff && /^[0-9a-f-]{36}$/.test(sp.staff) ? sp.staff : null
  const showCancelled = sp.cancelled === '1'
  const range =
    view === 'day'
      ? { from: date, to: date }
      : view === 'week'
        ? { from: startOfWeek(date), to: addDays(startOfWeek(date), 6) }
        : { from: firstOfMonth(date), to: addDays(firstOfMonth(date), daysInMonth(date) - 1) }
  const data = await loadCalendar(session, range.from, range.to, { staffId: staffParam, showCancelled })
  const colorOf = new Map(data.staff.map((s) => [s.id, s.color]))
  const step = view === 'day' ? 1 : view === 'week' ? 7 : 0
  const prev = view === 'month' ? addMonths(date, -1) : addDays(date, -step)
  const next = view === 'month' ? addMonths(date, 1) : addDays(date, step)
  const title =
    view === 'day'
      ? formatDateKey(date)
      : view === 'week'
        ? `${formatShortDate(range.from)} – ${formatShortDate(range.to)}`
        : formatMonthYear(date)
  const nav = { view, staff: staffParam, cancelled: showCancelled }

  // Time axis for day/week views: earliest opening to latest closing in range.
  const open = data.days.filter((d) => d.hours)
  const axisStart = open.length ? Math.floor(Math.min(...open.map((d) => d.hours!.startsAt)) / 60) * 60 : 600
  const axisEnd = open.length ? Math.ceil(Math.max(...open.map((d) => d.hours!.endsAt)) / 60) * 60 : 1200
  const ppm = view === 'day' ? 1.15 : 0.85
  const hours = Array.from({ length: (axisEnd - axisStart) / 60 + 1 }, (_, i) => axisStart + i * 60)

  return (
    <>
      <PageHeader
        title="Хуанли"
        description={
          session.role === 'specialist'
            ? 'Зөвхөн таны захиалга.'
            : 'Захиалга дээр дарж дэлгэрэнгүйг нээнэ. Хоосон цаг дээр дарж шинэ захиалга нэмнэ.'
        }
        actions={
          session.role !== 'specialist' ? (
            <Link href={`/admin/appointments/new?date=${date}`} className={buttonClass('primary', 'md')}>
              <Plus className="size-4" aria-hidden /> Захиалга нэмэх
            </Link>
          ) : null
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div
          className="inline-flex rounded-xs border border-line-strong bg-porcelain p-0.5"
          role="tablist"
          aria-label="Харагдац"
        >
          {(['day', 'week', 'month'] as View[]).map((v) => (
            <Link
              key={v}
              href={href({ ...nav, view: v, date })}
              role="tab"
              aria-selected={view === v}
              className={cn(
                'rounded-[3px] px-3.5 py-1.5 text-sm',
                view === v ? 'bg-cocoa-800 text-ivory' : 'text-ink-2 hover:bg-sand',
              )}
            >
              {v === 'day' ? 'Өдөр' : v === 'week' ? 'Долоо хоног' : 'Сар'}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={href({ ...nav, date: prev })}
            className="inline-flex size-9 items-center justify-center rounded-xs border border-line-strong hover:bg-sand"
            aria-label="Өмнөх"
          >
            <ChevronLeft className="size-4" />
          </Link>
          <Link
            href={href({ ...nav, date: today })}
            className="rounded-xs border border-line-strong px-3 py-1.5 text-sm hover:bg-sand"
          >
            Өнөөдөр
          </Link>
          <Link
            href={href({ ...nav, date: next })}
            className="inline-flex size-9 items-center justify-center rounded-xs border border-line-strong hover:bg-sand"
            aria-label="Дараах"
          >
            <ChevronRight className="size-4" />
          </Link>
        </div>
        <h2 className="font-display text-2xl text-cocoa-900">{title}</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          {session.role !== 'specialist' ? (
            <>
              <Link
                href={href({ ...nav, date, staff: null })}
                className={cn(
                  'rounded-full border px-3 py-1',
                  !staffParam ? 'border-cocoa-800 bg-cocoa-800 text-ivory' : 'border-line-strong text-ink-2',
                )}
              >
                Бүх мастер
              </Link>
              {data.allStaff.length > 1
                ? data.allStaff.map((s) => (
                    <Link
                      key={s.id}
                      href={href({ ...nav, date, staff: s.id })}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1',
                        staffParam === s.id
                          ? 'border-cocoa-800 bg-cocoa-800 text-ivory'
                          : 'border-line-strong text-ink-2',
                      )}
                    >
                      <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
                      {s.name}
                    </Link>
                  ))
                : null}
            </>
          ) : null}
          <Link
            href={href({ ...nav, date, cancelled: !showCancelled })}
            className="text-ink-3 underline underline-offset-4"
          >
            {showCancelled ? 'Цуцлагдсаныг нуух' : 'Цуцлагдсаныг харуулах'}
          </Link>
        </div>
      </div>

      {view === 'day' && (
        <div className="surface overflow-x-auto">
          {!data.days[0].hours ? (
            <p className="p-8 text-center text-ink-3">
              Салон энэ өдөр амарна{data.days[0].special ? ` — ${data.days[0].special}` : ''}.
            </p>
          ) : (
            <div className="flex min-w-[48rem]">
              <div className="w-14 shrink-0 border-r border-line pt-11">
                {hours.map((h) => (
                  <div
                    key={h}
                    className="tabular relative text-right text-[0.68rem] text-ink-3"
                    style={{ height: h === axisEnd ? 0 : 60 * ppm }}
                  >
                    <span className="absolute -top-2 right-2">{minutesToTime(h)}</span>
                  </div>
                ))}
              </div>
              {data.staff.map((s) => {
                const wd = weekdayOf(date)
                const shift = data.schedules.find((x) => x.staffId === s.id && x.weekday === wd)
                const dayStart = dayBounds(date).start.getTime()
                const off = data.timeOff.filter((x) => x.staffId === s.id)
                const brks = data.breaks.filter((b) => b.staffId === s.id && (b.weekday === null || b.weekday === wd))
                const items = data.appointments.filter((a) => a.staffId === s.id)
                const { lane, count } = lanes(items)
                return (
                  <div key={s.id} className="min-w-44 flex-1 border-r border-line last:border-r-0">
                    <div className="sticky top-0 flex h-11 items-center gap-2 border-b border-line bg-porcelain px-3 text-sm font-medium">
                      <span className="size-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
                      {s.name}
                    </div>
                    <div className="relative" style={{ height: (axisEnd - axisStart) * ppm }}>
                      {hours.slice(0, -1).map((h) => (
                        <div
                          key={h}
                          className="absolute inset-x-0 border-t border-line/70"
                          style={{ top: (h - axisStart) * ppm }}
                        />
                      ))}
                      {/* Outside the shift */}
                      {!shift?.isWorking ? (
                        <div className="absolute inset-0 bg-sand/70 p-3 text-center text-xs text-ink-3">
                          Амралтын өдөр
                        </div>
                      ) : (
                        <>
                          <div
                            className="absolute inset-x-0 bg-sand/60"
                            style={{ top: 0, height: Math.max(0, (shift.startsAt - axisStart) * ppm) }}
                          />
                          <div
                            className="absolute inset-x-0 bottom-0 bg-sand/60"
                            style={{ top: Math.max(0, (shift.endsAt - axisStart) * ppm) }}
                          />
                          <Link
                            href={`/admin/appointments/new?date=${date}&staff=${s.id}`}
                            className="absolute inset-x-0 hover:bg-blush-50/60"
                            style={{
                              top: (shift.startsAt - axisStart) * ppm,
                              height: (shift.endsAt - shift.startsAt) * ppm,
                            }}
                            aria-label={`${s.name}-д шинэ захиалга нэмэх`}
                          />
                        </>
                      )}
                      {brks.map((b) => (
                        <div
                          key={b.id}
                          className="absolute inset-x-0 flex items-center justify-center bg-[repeating-linear-gradient(135deg,var(--color-sand)_0_6px,transparent_6px_12px)] text-[0.65rem] text-ink-3"
                          style={{ top: (b.startsAt - axisStart) * ppm, height: (b.endsAt - b.startsAt) * ppm }}
                        >
                          {b.label}
                        </div>
                      ))}
                      {off.map((o) => {
                        const from = Math.max(axisStart, (o.startsAt.getTime() - dayStart) / 60_000)
                        const to = Math.min(axisEnd, (o.endsAt.getTime() - dayStart) / 60_000)
                        return to > from ? (
                          <div
                            key={o.id}
                            className="absolute inset-x-0 flex items-start justify-center bg-rose-50/90 pt-2 text-[0.7rem] text-rose-700"
                            style={{ top: (from - axisStart) * ppm, height: (to - from) * ppm }}
                          >
                            Чөлөө{o.note ? ` · ${o.note}` : ''}
                          </div>
                        ) : null
                      })}
                      {items.map((a) => (
                        <Block
                          key={a.id}
                          a={a}
                          color={s.color}
                          top={(minutesOfDay(a.startsAt) - axisStart) * ppm}
                          height={a.durationMinutes * ppm}
                          left={(lane.get(a.id)! / count) * 100}
                          width={100 / count}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {view === 'week' && (
        <div className="surface overflow-x-auto">
          <div className="flex min-w-[56rem]">
            <div className="w-12 shrink-0 border-r border-line pt-11">
              {hours.map((h) => (
                <div
                  key={h}
                  className="tabular relative text-right text-[0.65rem] text-ink-3"
                  style={{ height: h === axisEnd ? 0 : 60 * ppm }}
                >
                  <span className="absolute -top-2 right-1.5">{minutesToTime(h)}</span>
                </div>
              ))}
            </div>
            {data.days.map((d) => {
              const items = data.appointments.filter((a) => dateKeyOf(a.startsAt) === d.date)
              const { lane, count } = lanes(items)
              return (
                <div key={d.date} className="min-w-28 flex-1 border-r border-line last:border-r-0">
                  <Link
                    href={href({ ...nav, view: 'day', date: d.date })}
                    className={cn(
                      'flex h-11 flex-col justify-center border-b border-line px-2 text-xs hover:bg-sand',
                      d.date === today ? 'bg-cocoa-800 text-ivory' : 'bg-porcelain',
                    )}
                  >
                    <span className="font-medium">
                      {WEEKDAYS_SHORT_MN[weekdayOf(d.date) - 1]} {formatShortDate(d.date)}
                    </span>
                    <span className={d.date === today ? 'text-blush-100' : 'text-ink-3'}>
                      {d.hours ? `${items.length} захиалга` : 'Амарна'}
                    </span>
                  </Link>
                  <div className="relative" style={{ height: (axisEnd - axisStart) * ppm }}>
                    {!d.hours ? <div className="absolute inset-0 bg-sand/70" /> : null}
                    {hours.slice(0, -1).map((h) => (
                      <div
                        key={h}
                        className="absolute inset-x-0 border-t border-line/60"
                        style={{ top: (h - axisStart) * ppm }}
                      />
                    ))}
                    {items.map((a) => (
                      <Block
                        key={a.id}
                        a={a}
                        compact
                        color={colorOf.get(a.staffId) ?? '#8a6a58'}
                        top={(minutesOfDay(a.startsAt) - axisStart) * ppm}
                        height={a.durationMinutes * ppm}
                        left={(lane.get(a.id)! / count) * 100}
                        width={100 / count}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {view === 'month' && (
        <div className="surface overflow-x-auto">
          <div className="grid min-w-[46rem] grid-cols-7 border-b border-line bg-porcelain text-center text-xs text-ink-3">
            {WEEKDAYS_SHORT_MN.map((w) => (
              <span key={w} className="py-2">
                {w}
              </span>
            ))}
          </div>
          <div className="grid min-w-[46rem] grid-cols-7">
            {Array.from({ length: weekdayOf(range.from) - 1 }, (_, i) => (
              <div key={`pad-${i}`} className="min-h-28 border-r border-b border-line bg-ivory/60" />
            ))}
            {data.days.map((d) => {
              const items = data.appointments.filter((a) => dateKeyOf(a.startsAt) === d.date)
              return (
                <div
                  key={d.date}
                  className={cn('min-h-28 border-r border-b border-line p-1.5', !d.hours && 'bg-sand/50')}
                >
                  <Link
                    href={href({ ...nav, view: 'day', date: d.date })}
                    className="flex items-center justify-between text-xs"
                  >
                    <span
                      className={cn(
                        'tabular inline-flex size-6 items-center justify-center rounded-full',
                        d.date === today && 'bg-cocoa-800 text-ivory',
                      )}
                    >
                      {Number(d.date.slice(8))}
                    </span>
                    <span className="text-ink-3">{d.hours ? (items.length ? `${items.length}` : '') : 'Амарна'}</span>
                  </Link>
                  {d.special ? <p className="mt-0.5 truncate text-[0.62rem] text-blush-700">{d.special}</p> : null}
                  <ul className="mt-1 space-y-0.5">
                    {items.slice(0, 3).map((a) => (
                      <li key={a.id}>
                        <Link
                          href={`/admin/appointments/${a.id}`}
                          className={cn(
                            'block truncate rounded-[3px] border-l-2 bg-porcelain px-1 text-[0.66rem] hover:bg-sand',
                            a.status === 'cancelled' && 'line-through opacity-60',
                          )}
                          style={{ borderLeftColor: colorOf.get(a.staffId) }}
                        >
                          {minutesToTime(minutesOfDay(a.startsAt))} {a.customerName}
                        </Link>
                      </li>
                    ))}
                    {items.length > 3 ? (
                      <li className="px-1 text-[0.66rem] text-ink-3">+{items.length - 3} бусад</li>
                    ) : null}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-3">
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-[2px] border border-line bg-porcelain" aria-hidden /> Баталгаажсан
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-[2px] border border-dashed border-sky-600/40 bg-sky-50" aria-hidden /> Хүсэлт
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-[2px] border border-dashed border-amber-600/40 bg-amber-50" aria-hidden />{' '}
          Урьдчилгаа хүлээж буй
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-[2px] bg-cocoa-50" aria-hidden /> Дууссан
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-[2px] bg-rose-50" aria-hidden /> Ирээгүй / чөлөө
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-[2px] bg-sand" aria-hidden /> Ажлын бус цаг
        </li>
      </ul>
      <p className="sr-only">Нийт {diffDays(range.to, range.from) + 1} өдөр.</p>
    </>
  )
}
