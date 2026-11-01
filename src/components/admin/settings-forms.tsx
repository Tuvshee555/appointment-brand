'use client'

import { Loader2, Trash2 } from 'lucide-react'
import { useState, useTransition } from 'react'
import { ActionButton, FeedbackLine, feedbackFrom, type Feedback } from '@/components/admin/action-button'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Select, Textarea, TimeSelect } from '@/components/ui/field'
import { formatDateKey, minutesToTime, timeToMinutes, WEEKDAYS_MN } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import {
  addSpecialDayAction,
  removeSpecialDayAction,
  saveHoursAction,
  saveRulesAction,
  saveSalonInfoAction,
} from '@/server/actions/admin-settings'

const num = (v: string) => Number(v.replace(/[\s,₮]/g, '')) || 0

function Submit({ pending, label = 'Хадгалах' }: { pending: boolean; label?: string }) {
  return (
    <Button type="submit" variant="secondary" disabled={pending} className="shrink-0">
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {label}
    </Button>
  )
}

export interface SettingsData {
  name: string
  tagline: string
  about: string
  announcement: string | null
  phone: string
  email: string | null
  addressLine: string
  addressNote: string | null
  mapUrl: string | null
  instagram: string | null
  facebook: string | null
  hours: { weekday: number; isClosed: boolean; opensAt: number; closesAt: number }[]
  specialDays: {
    id: string
    date: string
    kind: 'closed' | 'special_hours'
    opensAt: number | null
    closesAt: number | null
    label: string
  }[]
  rules: {
    slotIntervalMinutes: number
    minAdvanceMinutes: number
    maxAdvanceDays: number
    defaultBufferMinutes: number
    maxServicesPerBooking: number
    cancellationNoticeHours: number
    rescheduleNoticeHours: number
    confirmationMode: 'auto' | 'manual'
    depositMode: 'none' | 'fixed' | 'percent'
    depositFixedAmount: number
    depositPercentBps: number
    depositMinTotal: number
    holdMinutes: number
    lateArrivalMinutes: number
    reminderHoursBefore: number
    cancellationPolicy: string
    depositPolicy: string
  }
}

export function SalonInfoForm({ data }: { data: SettingsData }) {
  const [v, setV] = useState({
    ...data,
    announcement: data.announcement ?? '',
    email: data.email ?? '',
    addressNote: data.addressNote ?? '',
    mapUrl: data.mapUrl ?? '',
    instagram: data.instagram ?? '',
    facebook: data.facebook ?? '',
  })
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [pending, start] = useTransition()
  const f = (key: keyof typeof v) => ({
    value: String(v[key] ?? ''),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [key]: e.target.value }),
  })
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () =>
          setFeedback(
            feedbackFrom(
              await saveSalonInfoAction({
                name: v.name,
                tagline: v.tagline,
                about: v.about,
                announcement: v.announcement || null,
                phone: v.phone,
                email: v.email || null,
                addressLine: v.addressLine,
                addressNote: v.addressNote || null,
                mapUrl: v.mapUrl || null,
                instagram: v.instagram || null,
                facebook: v.facebook || null,
              }),
              'Хадгалагдлаа. Вэбсайт шинэчлэгдлээ.',
            ),
          ),
        )
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Салоны нэр" htmlFor="s-name">
          <Input id="s-name" {...f('name')} />
        </Field>
        <Field label="Утас" htmlFor="s-phone">
          <Input id="s-phone" {...f('phone')} />
        </Field>
        <Field label="И-мэйл" htmlFor="s-email" optional>
          <Input id="s-email" {...f('email')} />
        </Field>
        <Field label="Хаяг" htmlFor="s-addr">
          <Input id="s-addr" {...f('addressLine')} />
        </Field>
        <Field label="Хаягийн тайлбар" htmlFor="s-addrnote" optional>
          <Input id="s-addrnote" {...f('addressNote')} />
        </Field>
        <Field label="Газрын зургийн холбоос" htmlFor="s-map" optional>
          <Input id="s-map" {...f('mapUrl')} />
        </Field>
        <Field label="Instagram" htmlFor="s-ig" optional>
          <Input id="s-ig" {...f('instagram')} />
        </Field>
        <Field label="Facebook" htmlFor="s-fb" optional>
          <Input id="s-fb" {...f('facebook')} />
        </Field>
      </div>
      <Field label="Уриа" htmlFor="s-tag">
        <Input id="s-tag" {...f('tagline')} />
      </Field>
      <Field label="Мэдэгдлийн мөр" htmlFor="s-ann" optional hint="Вэбсайтын дээд хэсэгт харагдана">
        <Input id="s-ann" {...f('announcement')} />
      </Field>
      <Field label="Салоны танилцуулга" htmlFor="s-about">
        <Textarea id="s-about" rows={4} {...f('about')} />
      </Field>
      <Submit pending={pending} />
      <FeedbackLine feedback={feedback} />
    </form>
  )
}

export function HoursForm({ data }: { data: SettingsData }) {
  const [days, setDays] = useState(
    data.hours.map((h) => ({ ...h, opens: minutesToTime(h.opensAt), closes: minutesToTime(h.closesAt) })),
  )
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
              await saveHoursAction({
                days: days.map((d) => ({
                  weekday: d.weekday,
                  isClosed: d.isClosed,
                  opensAt: timeToMinutes(d.opens) ?? 600,
                  closesAt: timeToMinutes(d.closes) ?? 1200,
                })),
              }),
              'Ажлын цаг хадгалагдлаа.',
            ),
          ),
        )
      }}
    >
      {days.map((d, i) => (
        <div key={d.weekday} className="grid grid-cols-2 items-center gap-2 text-sm sm:grid-cols-[6.5rem_auto_1fr_1fr]">
          <span>{WEEKDAYS_MN[d.weekday - 1]}</span>
          <Checkbox
            label="Амарна"
            checked={d.isClosed}
            onChange={(e) => setDays(days.map((x, j) => (j === i ? { ...x, isClosed: e.target.checked } : x)))}
          />
          <TimeSelect
            aria-label="Нээх"
            value={d.opens}
            disabled={d.isClosed}
            onChange={(e) => setDays(days.map((x, j) => (j === i ? { ...x, opens: e.target.value } : x)))}
          />
          <TimeSelect
            aria-label="Хаах"
            value={d.closes}
            disabled={d.isClosed}
            onChange={(e) => setDays(days.map((x, j) => (j === i ? { ...x, closes: e.target.value } : x)))}
          />
        </div>
      ))}
      <Submit pending={pending} />
      <FeedbackLine feedback={feedback} />
    </form>
  )
}

export function SpecialDaysForm({ data, today }: { data: SettingsData; today: string }) {
  const [v, setV] = useState({
    date: today,
    kind: 'closed' as 'closed' | 'special_hours',
    opens: '12:00',
    closes: '18:00',
    label: '',
  })
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [pending, start] = useTransition()
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line text-sm">
        {data.specialDays.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 py-2">
            <span>
              <span className="font-medium">
                {d.date.slice(0, 4) !== today.slice(0, 4) ? `${d.date.slice(0, 4)} оны ` : ''}
                {formatDateKey(d.date)}
              </span>{' '}
              · {d.kind === 'closed' ? 'Амарна' : `${minutesToTime(d.opensAt!)}–${minutesToTime(d.closesAt!)}`} ·{' '}
              {d.label}
            </span>
            <ActionButton action={removeSpecialDayAction.bind(null, { id: d.id })} variant="ghost" okText="Устгалаа.">
              <Trash2 className="size-3.5" aria-hidden /> <span className="sr-only">Устгах</span>
            </ActionButton>
          </li>
        ))}
      </ul>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          start(async () =>
            setFeedback(
              feedbackFrom(
                await addSpecialDayAction({
                  date: v.date,
                  kind: v.kind,
                  opensAt: v.kind === 'closed' ? null : timeToMinutes(v.opens),
                  closesAt: v.kind === 'closed' ? null : timeToMinutes(v.closes),
                  label: v.label,
                }),
                'Нэмэгдлээ. Онлайн хуанли шинэчлэгдлээ.',
              ),
            ),
          )
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <Input aria-label="Огноо" type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} />
          <Select
            aria-label="Төрөл"
            value={v.kind}
            onChange={(e) => setV({ ...v, kind: e.target.value as 'closed' | 'special_hours' })}
          >
            <option value="closed">Амарна</option>
            <option value="special_hours">Онцгой цаг</option>
          </Select>
          {v.kind === 'special_hours' ? (
            <>
              <TimeSelect aria-label="Нээх" value={v.opens} onChange={(e) => setV({ ...v, opens: e.target.value })} />
              <TimeSelect aria-label="Хаах" value={v.closes} onChange={(e) => setV({ ...v, closes: e.target.value })} />
            </>
          ) : null}
        </div>
        <div className="flex items-start gap-2">
          <Input
            aria-label="Тайлбар"
            placeholder="Жишээ: Цагаан сар"
            value={v.label}
            onChange={(e) => setV({ ...v, label: e.target.value })}
          />
          <Submit pending={pending} label="Нэмэх" />
        </div>
      </form>
      <FeedbackLine feedback={feedback} />
    </div>
  )
}

export function RulesForm({ data }: { data: SettingsData }) {
  const r = data.rules
  const [v, setV] = useState({
    slotIntervalMinutes: String(r.slotIntervalMinutes),
    minAdvanceHours: String(r.minAdvanceMinutes / 60),
    maxAdvanceDays: String(r.maxAdvanceDays),
    defaultBufferMinutes: String(r.defaultBufferMinutes),
    maxServicesPerBooking: String(r.maxServicesPerBooking),
    cancellationNoticeHours: String(r.cancellationNoticeHours),
    rescheduleNoticeHours: String(r.rescheduleNoticeHours),
    confirmationMode: r.confirmationMode,
    depositMode: r.depositMode,
    depositFixedAmount: String(r.depositFixedAmount),
    depositPercent: String(r.depositPercentBps / 100),
    depositMinTotal: String(r.depositMinTotal),
    holdMinutes: String(r.holdMinutes),
    lateArrivalMinutes: String(r.lateArrivalMinutes),
    reminderHoursBefore: String(r.reminderHoursBefore),
    cancellationPolicy: r.cancellationPolicy,
    depositPolicy: r.depositPolicy,
  })
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [pending, start] = useTransition()
  const set =
    (key: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setV({ ...v, [key]: e.target.value })
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () =>
          setFeedback(
            feedbackFrom(
              await saveRulesAction({
                slotIntervalMinutes: num(v.slotIntervalMinutes),
                minAdvanceMinutes: Math.round(Number(v.minAdvanceHours) * 60) || 0,
                maxAdvanceDays: num(v.maxAdvanceDays),
                defaultBufferMinutes: num(v.defaultBufferMinutes),
                maxServicesPerBooking: num(v.maxServicesPerBooking),
                cancellationNoticeHours: num(v.cancellationNoticeHours),
                rescheduleNoticeHours: num(v.rescheduleNoticeHours),
                confirmationMode: v.confirmationMode,
                depositMode: v.depositMode,
                depositFixedAmount: num(v.depositFixedAmount),
                depositPercentBps: Math.round(Number(v.depositPercent) * 100) || 0,
                depositMinTotal: num(v.depositMinTotal),
                holdMinutes: num(v.holdMinutes),
                lateArrivalMinutes: num(v.lateArrivalMinutes),
                reminderHoursBefore: num(v.reminderHoursBefore),
                cancellationPolicy: v.cancellationPolicy,
                depositPolicy: v.depositPolicy,
              }),
              'Захиалгын дүрэм хадгалагдлаа. Сул цаг шинэ дүрмээр тооцогдоно.',
            ),
          ),
        )
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Цагийн алхам (мин)" htmlFor="r-step">
          <Select id="r-step" value={v.slotIntervalMinutes} onChange={set('slotIntervalMinutes')}>
            {[5, 10, 15, 20, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n} минут
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Хамгийн бага урьдчилах хугацаа (цаг)" htmlFor="r-min">
          <Input id="r-min" inputMode="decimal" value={v.minAdvanceHours} onChange={set('minAdvanceHours')} />
        </Field>
        <Field label="Хэдэн хоногийн өмнөөс захиална" htmlFor="r-max">
          <Input id="r-max" inputMode="numeric" value={v.maxAdvanceDays} onChange={set('maxAdvanceDays')} />
        </Field>
        <Field label="Захиалга хоорондын бэлтгэл (мин)" htmlFor="r-buf">
          <Input id="r-buf" inputMode="numeric" value={v.defaultBufferMinutes} onChange={set('defaultBufferMinutes')} />
        </Field>
        <Field label="Нэг захиалгад хамгийн ихдээ" htmlFor="r-maxs">
          <Input
            id="r-maxs"
            inputMode="numeric"
            value={v.maxServicesPerBooking}
            onChange={set('maxServicesPerBooking')}
          />
        </Field>
        <Field label="Баталгаажуулалт" htmlFor="r-conf">
          <Select id="r-conf" value={v.confirmationMode} onChange={set('confirmationMode')}>
            <option value="manual">Салон баталгаажуулна</option>
            <option value="auto">Шууд баталгаажна</option>
          </Select>
        </Field>
        <Field label="Цуцлах мэдэгдлийн хугацаа (цаг)" htmlFor="r-cn">
          <Input
            id="r-cn"
            inputMode="numeric"
            value={v.cancellationNoticeHours}
            onChange={set('cancellationNoticeHours')}
          />
        </Field>
        <Field label="Онлайнаар цаг өөрчлөх хугацаа (цаг)" htmlFor="r-rn">
          <Input
            id="r-rn"
            inputMode="numeric"
            value={v.rescheduleNoticeHours}
            onChange={set('rescheduleNoticeHours')}
          />
        </Field>
        <Field label="Хоцролтын хүлцэл (мин)" htmlFor="r-late">
          <Input id="r-late" inputMode="numeric" value={v.lateArrivalMinutes} onChange={set('lateArrivalMinutes')} />
        </Field>
      </div>
      <fieldset className="rounded-xs border border-line p-4">
        <legend className="px-1 text-sm font-medium text-cocoa-900">Урьдчилгаа</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Төрөл" htmlFor="r-dm">
            <Select id="r-dm" value={v.depositMode} onChange={set('depositMode')}>
              <option value="none">Авахгүй</option>
              <option value="fixed">Тогтмол дүн</option>
              <option value="percent">Хувиар</option>
            </Select>
          </Field>
          {v.depositMode === 'fixed' ? (
            <Field label="Дүн (₮)" htmlFor="r-dfix" hint={formatMoney(num(v.depositFixedAmount))}>
              <Input
                id="r-dfix"
                inputMode="numeric"
                value={v.depositFixedAmount}
                onChange={set('depositFixedAmount')}
              />
            </Field>
          ) : v.depositMode === 'percent' ? (
            <Field label="Хувь (%)" htmlFor="r-dpct">
              <Input id="r-dpct" inputMode="decimal" value={v.depositPercent} onChange={set('depositPercent')} />
            </Field>
          ) : (
            <div />
          )}
          <Field label="Хэдэн төгрөгөөс дээш захиалгад" htmlFor="r-dmin" hint={formatMoney(num(v.depositMinTotal))}>
            <Input id="r-dmin" inputMode="numeric" value={v.depositMinTotal} onChange={set('depositMinTotal')} />
          </Field>
          <Field label="Төлбөр хүлээх хугацаа (мин)" htmlFor="r-hold" hint="Төлөгдөөгүй бол цаг чөлөөлөгдөнө">
            <Input id="r-hold" inputMode="numeric" value={v.holdMinutes} onChange={set('holdMinutes')} />
          </Field>
          <Field label="Сануулга (цагийн өмнө)" htmlFor="r-rem">
            <Input id="r-rem" inputMode="numeric" value={v.reminderHoursBefore} onChange={set('reminderHoursBefore')} />
          </Field>
        </div>
      </fieldset>
      <Field label="Цуцлалтын бодлого" htmlFor="r-cp">
        <Textarea id="r-cp" rows={3} value={v.cancellationPolicy} onChange={set('cancellationPolicy')} />
      </Field>
      <Field label="Урьдчилгааны бодлого" htmlFor="r-dp">
        <Textarea id="r-dp" rows={3} value={v.depositPolicy} onChange={set('depositPolicy')} />
      </Field>
      <Submit pending={pending} />
      <FeedbackLine feedback={feedback} />
    </form>
  )
}
