'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { CalendarDay, DayState } from '@/lib/availability/engine'
import { addMonths, formatDateKey, formatMonthYear, weekdayOf, WEEKDAYS_SHORT_MN } from '@/lib/datetime'
import { cn } from '@/lib/cn'

const STATE_LABEL: Record<DayState, string> = {
  available: 'сул цагтай',
  full: 'сул цаггүй',
  closed: 'салон амарна',
  past: 'өнгөрсөн',
  beyond: 'захиалга нээгдээгүй',
}

export function MonthCalendar({
  month,
  days,
  loading,
  selected,
  canPrev,
  canNext,
  onMonth,
  onSelect,
}: {
  month: string
  days: CalendarDay[] | null
  loading: boolean
  selected: string | null
  canPrev: boolean
  canNext: boolean
  onMonth: (month: string) => void
  onSelect: (date: string) => void
}) {
  const first = `${month}-01`
  const lead = weekdayOf(first) - 1
  const cells: (CalendarDay | null)[] = [...Array(lead).fill(null), ...(days ?? [])]

  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onMonth(addMonths(first, -1).slice(0, 7))}
          disabled={!canPrev || loading}
          className="inline-flex size-11 items-center justify-center rounded-xs border border-line hover:bg-sand disabled:opacity-30"
          aria-label="Өмнөх сар"
        >
          <ChevronLeft className="size-5" />
        </button>
        <h3 className="font-display text-2xl text-cocoa-900" aria-live="polite">
          {formatMonthYear(first)}
        </h3>
        <button
          type="button"
          onClick={() => onMonth(addMonths(first, 1).slice(0, 7))}
          disabled={!canNext || loading}
          className="inline-flex size-11 items-center justify-center rounded-xs border border-line hover:bg-sand disabled:opacity-30"
          aria-label="Дараагийн сар"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      <div className="mt-5 grid grid-cols-7 gap-1 text-center text-xs font-medium text-ink-3" aria-hidden>
        {WEEKDAYS_SHORT_MN.map((d) => (
          <span key={d} className="py-1">
            {d}
          </span>
        ))}
      </div>
      <div role="grid" aria-label={`${formatMonthYear(first)} — өдөр сонгох`} aria-busy={loading} className="mt-1 grid grid-cols-7 gap-1">
        {loading && !days
          ? Array.from({ length: 35 }, (_, i) => <span key={i} className="aspect-square animate-pulse rounded-xs bg-sand sm:aspect-[1.15]" />)
          : cells.map((d, i) => {
              if (!d) return <span key={`lead-${i}`} />
              const dayNum = Number(d.date.slice(8))
              const isSelected = selected === d.date
              const enabled = d.state === 'available'
              return (
                <button
                  key={d.date}
                  type="button"
                  role="gridcell"
                  disabled={!enabled || loading}
                  aria-selected={isSelected}
                  aria-label={`${formatDateKey(d.date)}, ${STATE_LABEL[d.state]}${d.label ? `, ${d.label}` : ''}`}
                  title={d.label ?? undefined}
                  onClick={() => onSelect(d.date)}
                  className={cn(
                    'relative flex aspect-square min-h-11 flex-col items-center justify-center rounded-xs text-[0.95rem] tabular transition-colors sm:aspect-[1.15]',
                    enabled && !isSelected && 'border border-line-strong bg-porcelain text-cocoa-900 hover:border-cocoa-700',
                    isSelected && 'bg-cocoa-800 text-ivory',
                    d.state === 'full' && 'bg-sand/70 text-ink-3 line-through decoration-ink-3/40',
                    d.state === 'closed' && 'text-ink-3/50',
                    (d.state === 'past' || d.state === 'beyond') && 'text-ink-3/35',
                  )}
                >
                  {dayNum}
                  {d.label ? <span className={cn('absolute top-1 right-1 size-1.5 rounded-full', isSelected ? 'bg-blush-200' : 'bg-blush-500')} aria-hidden /> : null}
                  {enabled ? (
                    <span className={cn('mt-0.5 hidden text-[0.62rem] sm:block', isSelected ? 'text-blush-100' : 'text-sage-600')}>{d.slotCount} цаг</span>
                  ) : d.state === 'full' ? (
                    <span className="mt-0.5 hidden text-[0.62rem] no-underline sm:block">дүүрсэн</span>
                  ) : d.state === 'closed' ? (
                    <span className="mt-0.5 hidden text-[0.62rem] sm:block">амарна</span>
                  ) : null}
                </button>
              )
            })}
      </div>
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-3">
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded-xs border border-line-strong bg-porcelain" aria-hidden /> Сул цагтай
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded-xs bg-sand" aria-hidden /> Дүүрсэн
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-3 rounded-xs border border-dashed border-line" aria-hidden /> Амарна / нээгдээгүй
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-blush-500" aria-hidden /> Баяр, онцгой цагийн хуваарь
        </li>
      </ul>
    </div>
  )
}
