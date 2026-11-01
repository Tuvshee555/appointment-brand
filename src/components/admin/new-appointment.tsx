'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { FeedbackLine, feedbackFrom, type Feedback } from '@/components/admin/action-button'
import { Card } from '@/components/admin/ui'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { formatDateKey, formatDuration, minutesToTime } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/cn'
import { adminCreateBookingAction, adminSlotsAction } from '@/server/actions/admin-appointments'
import type { PublicSlot } from '@/server/actions/booking'
import type { PublicCatalog } from '@/server/queries/public'

export function NewAppointmentForm({ catalog, initialDate, initialStaff }: { catalog: PublicCatalog; initialDate: string; initialStaff: string | null }) {
  const router = useRouter()
  const [items, setItems] = useState<{ serviceId: string; addonIds: string[] }[]>([])
  const [staffId, setStaffId] = useState<string>(initialStaff ?? 'any')
  const [date, setDate] = useState(initialDate)
  const [slots, setSlots] = useState<PublicSlot[] | null>(null)
  const [slot, setSlot] = useState<PublicSlot | null>(null)
  const [customer, setCustomer] = useState({ name: '', phone: '', email: '' })
  const [source, setSource] = useState<'phone' | 'walk_in' | 'admin' | 'messenger'>('phone')
  const [status, setStatus] = useState<'confirmed' | 'pending'>('confirmed')
  const [note, setNote] = useState('')
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [pending, start] = useTransition()
  const addonById = new Map(catalog.addons.map((a) => [a.id, a]))
  const serviceById = new Map(catalog.services.map((s) => [s.id, s]))
  const eligible = useMemo(() => catalog.staff.filter((s) => items.length && items.every((i) => s.serviceIds.includes(i.serviceId))), [catalog.staff, items])
  const total = items.reduce((sum, i) => sum + (serviceById.get(i.serviceId)?.price ?? 0) + i.addonIds.reduce((x, a) => x + (addonById.get(a)?.price ?? 0), 0), 0)
  const minutes = items.reduce((sum, i) => sum + (serviceById.get(i.serviceId)?.durationMinutes ?? 0) + i.addonIds.reduce((x, a) => x + (addonById.get(a)?.durationMinutes ?? 0), 0), 0)

  const toggle = (id: string) => {
    setSlots(null)
    setSlot(null)
    setItems((prev) => (prev.some((i) => i.serviceId === id) ? prev.filter((i) => i.serviceId !== id) : [...prev, { serviceId: id, addonIds: [] }]))
  }
  const toggleAddon = (sid: string, aid: string) => {
    setSlots(null)
    setSlot(null)
    setItems((prev) => prev.map((i) => (i.serviceId === sid ? { ...i, addonIds: i.addonIds.includes(aid) ? i.addonIds.filter((x) => x !== aid) : [...i.addonIds, aid] } : i)))
  }
  const loadSlots = () =>
    start(async () => {
      setFeedback(null)
      setSlot(null)
      const res = await adminSlotsAction({ items, staffId: staffId === 'any' ? null : staffId, date })
      if (res.ok) setSlots(res.data.slots)
      else {
        setSlots([])
        setFeedback({ kind: 'error', text: res.error })
      }
    })

  return (
    <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        <Card title="1. Үйлчилгээ">
          <div className="space-y-5">
            {catalog.categories.map((c) => (
              <fieldset key={c.id}>
                <legend className="text-xs font-medium tracking-wide text-ink-3 uppercase">{c.name}</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {catalog.services
                    .filter((s) => s.categoryId === c.id)
                    .map((s) => {
                      const sel = items.find((i) => i.serviceId === s.id)
                      return (
                        <div key={s.id} className={cn('rounded-xs border p-2.5 text-sm', sel ? 'border-cocoa-700 bg-cocoa-50' : 'border-line')}>
                          <label className="flex cursor-pointer items-start gap-2">
                            <input type="checkbox" checked={Boolean(sel)} onChange={() => toggle(s.id)} className="mt-0.5 size-4 accent-cocoa-700" />
                            <span className="flex-1">
                              {s.name}
                              <span className="block text-xs text-ink-3">
                                {formatDuration(s.durationMinutes)} · {formatMoney(s.price)}
                                {s.priceType === 'from' ? '-өөс' : ''}
                              </span>
                            </span>
                          </label>
                          {sel && s.addonIds.length ? (
                            <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
                              {s.addonIds.map((aid) => (
                                <button
                                  key={aid}
                                  type="button"
                                  onClick={() => toggleAddon(s.id, aid)}
                                  aria-pressed={sel.addonIds.includes(aid)}
                                  className={cn('rounded-full border px-2 py-0.5 text-xs', sel.addonIds.includes(aid) ? 'border-cocoa-800 bg-cocoa-800 text-ivory' : 'border-line-strong')}
                                >
                                  + {addonById.get(aid)?.name}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                </div>
              </fieldset>
            ))}
          </div>
        </Card>

        <Card title="2. Мастер, өдөр, цаг">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Мастер" htmlFor="na-staff">
              <Select
                id="na-staff"
                value={staffId}
                onChange={(e) => {
                  setStaffId(e.target.value)
                  setSlots(null)
                }}
              >
                <option value="any">Аль ч чөлөөтэй мастер</option>
                {(items.length ? eligible : catalog.staff).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Өдөр" htmlFor="na-date">
              <Input
                id="na-date"
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value)
                  setSlots(null)
                }}
              />
            </Field>
            <Button variant="secondary" onClick={loadSlots} disabled={!items.length || pending}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Сул цаг харах
            </Button>
          </div>
          {items.length && !eligible.length ? <p className="mt-3 text-sm text-amber-700">Сонгосон үйлчилгээг бүгдийг нь хийдэг мастер алга.</p> : null}
          {slots ? (
            slots.length ? (
              <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-8">
                {slots.map((s) => (
                  <button
                    key={s.start}
                    type="button"
                    aria-pressed={slot?.start === s.start}
                    onClick={() => setSlot(s)}
                    className={cn('h-10 rounded-xs border text-sm tabular', slot?.start === s.start ? 'border-cocoa-800 bg-cocoa-800 text-ivory' : 'border-line-strong bg-porcelain hover:border-cocoa-700')}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-ink-3">{formatDateKey(date)} — сул цаг алга (ажлын хуваарь, завсарлага, бусад захиалгыг тооцсон).</p>
            )
          ) : null}
        </Card>
      </div>

      <div className="space-y-6">
        <Card title="3. Үйлчлүүлэгч">
          <div className="space-y-4">
            <Field label="Нэр" htmlFor="na-name">
              <Input id="na-name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
            </Field>
            <Field label="Утас" htmlFor="na-phone" hint="Ижил дугаартай харилцагч байвал түүн дээр нэмэгдэнэ">
              <Input id="na-phone" type="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
            </Field>
            <Field label="И-мэйл" htmlFor="na-email" optional>
              <Input id="na-email" type="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Эх сурвалж" htmlFor="na-source">
                <Select id="na-source" value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
                  <option value="phone">Утсаар</option>
                  <option value="walk_in">Шууд ирсэн</option>
                  <option value="messenger">Messenger</option>
                  <option value="admin">Бусад</option>
                </Select>
              </Field>
              <Field label="Төлөв" htmlFor="na-status">
                <Select id="na-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                  <option value="confirmed">Баталгаажсан</option>
                  <option value="pending">Хүсэлт</option>
                </Select>
              </Field>
            </div>
            <Field label="Дотоод тэмдэглэл" htmlFor="na-note" optional>
              <Textarea id="na-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            </Field>
          </div>
        </Card>
        <Card title="Хураангуй">
          <p className="text-sm text-ink-2">
            {items.length} үйлчилгээ · {formatDuration(minutes || 0)} · <span className="font-medium">{formatMoney(total)}</span>
          </p>
          <p className="mt-1 text-sm text-ink-2">{slot ? `${formatDateKey(date)} · ${minutesToTime(slot.start)}` : 'Цаг сонгоогүй'}</p>
          <Button
            className="mt-4 w-full"
            disabled={!slot || pending}
            onClick={() =>
              start(async () => {
                const res = await adminCreateBookingAction({
                  items,
                  staffId: staffId === 'any' ? null : staffId,
                  date,
                  start: slot!.start,
                  source,
                  status,
                  customer: { name: customer.name, phone: customer.phone, email: customer.email || null, note: null, preferences: null },
                  internalNote: note || null,
                })
                setFeedback(feedbackFrom(res, 'Захиалга үүслээ.'))
                if (res.ok && !res.simulated) router.push(`/admin/appointments/${res.data.appointmentId}`)
              })
            }
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Захиалга үүсгэх
          </Button>
          <div className="mt-3">
            <FeedbackLine feedback={feedback} />
          </div>
          <p className="mt-3 text-xs text-ink-3">Сервер цагийг дахин шалгаж, давхцал байвал татгалзана. Үнийг каталогоос тооцно.</p>
        </Card>
      </div>
    </div>
  )
}
