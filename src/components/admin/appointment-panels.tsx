'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ActionButton, FeedbackLine, feedbackFrom, type Feedback } from '@/components/admin/action-button'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import {
  allowedTransitions,
  CANCELLATION_REASONS,
  STATUS_ACTION_LABELS,
  type AppointmentStatus,
  type CancellationReason,
} from '@/lib/booking/status'
import { formatDateKey, minutesToTime } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/cn'
import {
  adminRescheduleAction,
  adminSlotsAction,
  recordPaymentAction,
  transitionAction,
  updateInternalNoteAction,
} from '@/server/actions/admin-appointments'
import type { PublicSlot } from '@/server/actions/booking'

export function StatusActions({
  appointmentId,
  status,
  started,
}: {
  appointmentId: string
  status: AppointmentStatus
  started: boolean
}) {
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState<CancellationReason>('customer_request')
  const [note, setNote] = useState('')
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [pending, start] = useTransition()
  const options = allowedTransitions(status, 'staff').filter(
    (s) => s !== 'rescheduled' && (started || (s !== 'completed' && s !== 'no_show')),
  )
  if (!options.length) return <p className="text-sm text-ink-3">Энэ төлөвөөс өөрчлөх үйлдэл алга.</p>
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {options
          .filter((s) => s !== 'cancelled')
          .map((s) => (
            <ActionButton
              key={s}
              action={() => transitionAction({ appointmentId, to: s })}
              variant={
                s === 'confirmed' || s === 'completed'
                  ? 'primary'
                  : s === 'no_show' || s === 'rejected'
                    ? 'danger'
                    : 'secondary'
              }
              size="md"
              confirm={
                s === 'rejected' || s === 'no_show' ? `«${STATUS_ACTION_LABELS[s]}» — итгэлтэй байна уу?` : undefined
              }
            >
              {STATUS_ACTION_LABELS[s]}
            </ActionButton>
          ))}
        {options.includes('cancelled') ? (
          <Button variant="danger" onClick={() => setCancelling((v) => !v)}>
            Цуцлах
          </Button>
        ) : null}
      </div>
      {!started && allowedTransitions(status, 'staff').includes('completed') ? (
        <p className="text-xs text-ink-3">«Дууссан», «Ирээгүй» товч цаг эхэлсний дараа гарна.</p>
      ) : null}
      {cancelling ? (
        <div className="space-y-3 rounded-xs border border-rose-600/25 bg-rose-50/50 p-4">
          <Field label="Шалтгаан" htmlFor="cancel-reason">
            <Select id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value as CancellationReason)}>
              {Object.entries(CANCELLATION_REASONS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Тайлбар" htmlFor="cancel-note" optional>
            <Textarea id="cancel-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </Field>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await transitionAction({ appointmentId, to: 'cancelled', reason, note: note || null })
                setFeedback(feedbackFrom(res, 'Захиалга цуцлагдлаа. Цаг бусдад нээлттэй боллоо.'))
                if (res.ok) setCancelling(false)
              })
            }
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Цуцлалтыг батлах
          </Button>
        </div>
      ) : null}
      <FeedbackLine feedback={feedback} />
    </div>
  )
}

export function ReschedulePanel({
  appointmentId,
  items,
  staffId,
  staff,
  today,
}: {
  appointmentId: string
  items: { serviceId: string; addonIds: string[] }[]
  staffId: string
  staff: { id: string; name: string }[]
  today: string
}) {
  const router = useRouter()
  const [date, setDate] = useState(today)
  const [who, setWho] = useState<string>(staffId)
  const [slots, setSlots] = useState<PublicSlot[] | null>(null)
  const [slot, setSlot] = useState<PublicSlot | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [pending, start] = useTransition()

  const load = (d: string, s: string) =>
    start(async () => {
      setSlot(null)
      setFeedback(null)
      const res = await adminSlotsAction({
        items,
        staffId: s === 'any' ? null : s,
        date: d,
        excludeAppointmentId: appointmentId,
      })
      if (res.ok) setSlots(res.data.slots)
      else {
        setSlots([])
        setFeedback({ kind: 'error', text: res.error })
      }
    })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Шинэ өдөр" htmlFor="rs-date">
          <Input
            id="rs-date"
            type="date"
            min={today}
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              load(e.target.value, who)
            }}
          />
        </Field>
        <Field label="Мастер" htmlFor="rs-staff">
          <Select
            id="rs-staff"
            value={who}
            onChange={(e) => {
              setWho(e.target.value)
              load(date, e.target.value)
            }}
          >
            <option value="any">Аль ч чөлөөтэй мастер</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="secondary" onClick={() => load(date, who)} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Сул цаг харах
        </Button>
      </div>
      {slots ? (
        slots.length === 0 ? (
          <p className="text-sm text-ink-3">{formatDateKey(date)} — сул цаг алга.</p>
        ) : (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
            {slots.map((s) => (
              <button
                key={s.start}
                type="button"
                aria-pressed={slot?.start === s.start}
                onClick={() => setSlot(s)}
                className={cn(
                  'tabular h-10 rounded-xs border text-sm',
                  slot?.start === s.start
                    ? 'border-cocoa-800 bg-cocoa-800 text-ivory'
                    : 'border-line-strong bg-porcelain hover:border-cocoa-700',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        )
      ) : null}
      {slot ? (
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await adminRescheduleAction({
                appointmentId,
                date,
                start: slot.start,
                staffId: who === 'any' ? null : who,
              })
              setFeedback(feedbackFrom(res, 'Цаг шилжлээ.'))
              if (res.ok && !res.simulated) router.push(`/admin/appointments/${res.data.appointmentId}`)
            })
          }
        >
          {formatDateKey(date)} {minutesToTime(slot.start)} руу шилжүүлэх
        </Button>
      ) : null}
      <FeedbackLine feedback={feedback} />
    </div>
  )
}

export function PaymentForm({ appointmentId, outstanding }: { appointmentId: string; outstanding: number }) {
  const [amount, setAmount] = useState(String(Math.max(outstanding, 0) || ''))
  const [method, setMethod] = useState<'cash' | 'card' | 'bank_transfer' | 'qpay'>('card')
  const [note, setNote] = useState('')
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [pending, start] = useTransition()
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const res = await recordPaymentAction({
            appointmentId,
            amount: Number(amount.replace(/[\s,₮]/g, '')),
            method,
            kind: 'balance',
            note: note || null,
          })
          setFeedback(feedbackFrom(res, 'Төлбөр бүртгэгдлээ.'))
        })
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Дүн (₮)"
          htmlFor="pay-amount"
          hint={outstanding > 0 ? `Үлдэгдэл ${formatMoney(outstanding)}` : undefined}
        >
          <Input
            id="pay-amount"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>
        <Field label="Төлбөрийн хэлбэр" htmlFor="pay-method">
          <Select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="card">Карт</option>
            <option value="cash">Бэлэн</option>
            <option value="qpay">QPay (салонд)</option>
            <option value="bank_transfer">Дансаар</option>
          </Select>
        </Field>
      </div>
      <Field label="Тэмдэглэл" htmlFor="pay-note" optional>
        <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </Field>
      <p className="text-xs text-ink-3">
        Салонд хүлээн авсан төлбөрийг ажилтан бүртгэнэ. Онлайн QPay төлбөрийг зөвхөн төлбөрийн системийн шалгалт
        баталгаажуулна.
      </p>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Төлбөр бүртгэх
      </Button>
      <FeedbackLine feedback={feedback} />
    </form>
  )
}

export function NoteForm({ appointmentId, note }: { appointmentId: string; note: string | null }) {
  const [value, setValue] = useState(note ?? '')
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [pending, start] = useTransition()
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () =>
          setFeedback(
            feedbackFrom(
              await updateInternalNoteAction({ appointmentId, note: value || null }),
              'Тэмдэглэл хадгалагдлаа.',
            ),
          ),
        )
      }}
    >
      <label htmlFor="internal-note" className="sr-only">
        Дотоод тэмдэглэл
      </label>
      <Textarea
        id="internal-note"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={1000}
        placeholder="Зөвхөн ажилтанд харагдана"
      />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        Хадгалах
      </Button>
      <FeedbackLine feedback={feedback} />
    </form>
  )
}
