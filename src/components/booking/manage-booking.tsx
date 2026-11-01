'use client'

import { CalendarClock, Loader2, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/field'
import type { CalendarDay } from '@/lib/availability/engine'
import { addDays, dateKeyOf, formatDateKey, minutesToTime } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/cn'
import type { PublicSlot } from '@/server/actions/booking'
import { cancelBookingAction, rescheduleBookingAction, rescheduleDayAction, rescheduleMonthAction } from '@/server/actions/customer-booking'
import { MonthCalendar } from './month-calendar'

export function ManageBooking({
  reference,
  token,
  canCancel,
  canReschedule,
  rescheduleBlockedReason,
  cancelWithinPolicy,
  paidDeposit,
  noticeHours,
  maxAdvanceDays,
}: {
  reference: string
  token: string | null
  canCancel: boolean
  canReschedule: boolean
  rescheduleBlockedReason: string | null
  cancelWithinPolicy: boolean
  paidDeposit: number
  noticeHours: number
  maxAdvanceDays: number
}) {
  const router = useRouter()
  const [mode, setMode] = useState<'none' | 'cancel' | 'reschedule'>('none')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [today] = useState(() => dateKeyOf(new Date()))
  const [month, setMonth] = useState(() => today.slice(0, 7))
  const [days, setDays] = useState<CalendarDay[] | null>(null)
  const [date, setDate] = useState<string | null>(null)
  const [slots, setSlots] = useState<PublicSlot[] | null>(null)
  const [slot, setSlot] = useState<PublicSlot | null>(null)
  const lastMonth = addDays(today, maxAdvanceDays).slice(0, 7)

  useEffect(() => {
    if (mode !== 'reschedule') return
    let cancelled = false
    rescheduleMonthAction({ reference, token, month }).then((res) => {
      if (cancelled) return
      if (res.ok) setDays(res.data.days)
      else setError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [mode, month, reference, token])

  useEffect(() => {
    if (!date) return
    let cancelled = false
    rescheduleDayAction({ reference, token, date }).then((res) => {
      if (cancelled) return
      if (res.ok) setSlots(res.data.slots)
      else setError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [date, reference, token])

  const cancel = () =>
    start(async () => {
      setError(null)
      const res = await cancelBookingAction({ reference, token, reason: reason || null })
      if (!res.ok) return setError(res.error)
      setMode('none')
      router.refresh()
    })

  const reschedule = () =>
    start(async () => {
      if (!date || !slot) return
      setError(null)
      const res = await rescheduleBookingAction({ reference, token, date, start: slot.start })
      if (!res.ok) return setError(res.error)
      router.push(`/booking/${res.data.reference}${token ? `?t=${encodeURIComponent(token)}` : ''}`)
    })

  if (!canCancel && !canReschedule) return null

  return (
    <section aria-labelledby="manage-title" className="surface p-5 sm:p-6">
      <h2 id="manage-title" className="font-display text-2xl text-cocoa-900">
        Захиалгаа өөрчлөх
      </h2>
      <div className="mt-4 flex flex-wrap gap-3">
        {canReschedule ? (
          <Button variant={mode === 'reschedule' ? 'primary' : 'secondary'} onClick={() => setMode(mode === 'reschedule' ? 'none' : 'reschedule')}>
            <CalendarClock className="size-4" aria-hidden /> Цаг өөрчлөх
          </Button>
        ) : null}
        {canCancel ? (
          <Button variant="danger" onClick={() => setMode(mode === 'cancel' ? 'none' : 'cancel')}>
            <XCircle className="size-4" aria-hidden /> Цуцлах
          </Button>
        ) : null}
      </div>
      {!canReschedule && rescheduleBlockedReason ? <p className="mt-3 text-sm text-ink-3">{rescheduleBlockedReason}</p> : null}
      {error ? (
        <p role="alert" className="mt-4 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {mode === 'cancel' && (
        <div className="mt-6 space-y-4 border-t border-line pt-5">
          <p className="text-sm text-ink-2">
            {paidDeposit > 0
              ? cancelWithinPolicy
                ? `Цаг эхлэхээс ${noticeHours}+ цагийн өмнө цуцалж байгаа тул ${formatMoney(paidDeposit)} урьдчилгаа бүтэн буцаагдана.`
                : `Цаг эхлэхэд ${noticeHours} цаг хүрэхгүй үлдсэн тул бодлогын дагуу ${formatMoney(paidDeposit)} урьдчилгаа буцаагдахгүй.`
              : 'Цуцалсны дараа энэ цаг бусдад нээлттэй болно.'}
          </p>
          <Field label="Шалтгаан" htmlFor="cancel-reason" optional>
            <Textarea id="cancel-reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button variant="danger" onClick={cancel} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Тийм, цуцлах
          </Button>
        </div>
      )}

      {mode === 'reschedule' && (
        <div className="mt-6 space-y-6 border-t border-line pt-5">
          <MonthCalendar
            month={month}
            days={days}
            loading={!days}
            selected={date}
            canPrev={month > today.slice(0, 7)}
            canNext={month < lastMonth}
            onMonth={(m) => {
              setDays(null)
              setMonth(m)
            }}
            onSelect={(d) => {
              setDate(d)
              setSlot(null)
              setSlots(null)
            }}
          />
          {date ? (
            <div>
              <p className="text-sm font-medium text-cocoa-900">{formatDateKey(date)}</p>
              {!slots ? (
                <Loader2 className="mt-3 size-5 animate-spin text-ink-3" aria-label="Ачаалж байна" />
              ) : slots.length === 0 ? (
                <p className="mt-2 text-sm text-ink-3">Энэ өдөр сул цаг алга.</p>
              ) : (
                <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {slots.map((s) => (
                    <button
                      key={s.start}
                      type="button"
                      aria-pressed={slot?.start === s.start}
                      onClick={() => setSlot(s)}
                      className={cn(
                        'h-11 rounded-xs border text-sm tabular',
                        slot?.start === s.start ? 'border-cocoa-800 bg-cocoa-800 text-ivory' : 'border-line-strong bg-porcelain hover:border-cocoa-700',
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
          {slot && date ? (
            <Button onClick={reschedule} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {formatDateKey(date)} {minutesToTime(slot.start)} руу шилжүүлэх
            </Button>
          ) : null}
        </div>
      )}
    </section>
  )
}
