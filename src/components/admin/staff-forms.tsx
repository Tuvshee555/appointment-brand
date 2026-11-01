'use client'

import { Loader2, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ActionButton, FeedbackLine, feedbackFrom, type Feedback } from '@/components/admin/action-button'
import { Card } from '@/components/admin/ui'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Select, Textarea, TimeSelect } from '@/components/ui/field'
import { formatDateTime, minutesToTime, timeToMinutes, WEEKDAYS_MN } from '@/lib/datetime'
import {
  addBreakAction,
  addTimeOffAction,
  removeBreakAction,
  removeTimeOffAction,
  saveScheduleAction,
  saveStaffProfileAction,
  saveStaffSkillsAction,
} from '@/server/actions/admin-staff'
import type { StaffAdmin } from '@/server/queries/admin-staff'

function SaveButton({ pending, children = 'Хадгалах' }: { pending: boolean; children?: React.ReactNode }) {
  return (
    <Button type="submit" variant="secondary" disabled={pending} className="shrink-0">
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </Button>
  )
}

export function StaffProfileForm({ staff }: { staff: StaffAdmin['staff'] | null }) {
  const router = useRouter()
  const [v, setV] = useState({
    name: staff?.name ?? '',
    displayName: staff?.displayName ?? '',
    title: staff?.title ?? '',
    bio: staff?.bio ?? '',
    experienceYears: String(staff?.experienceYears ?? 0),
    experienceText: staff?.experienceText ?? '',
    specialties: (staff?.specialties ?? []).join(', '),
    calendarColor: staff?.calendarColor ?? '#8a6a58',
    isActive: staff?.isActive ?? true,
    acceptsOnlineBookings: staff?.acceptsOnlineBookings ?? true,
  })
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [pending, start] = useTransition()
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const res = await saveStaffProfileAction({
            id: staff?.id ?? null,
            ...v,
            experienceYears: Number(v.experienceYears) || 0,
            specialties: v.specialties
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          })
          setFeedback(feedbackFrom(res, 'Хадгалагдлаа.'))
          if (res.ok && !res.simulated && !staff) router.push(`/admin/staff/${res.data.id}`)
        })
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Бүтэн нэр" htmlFor="st-name">
          <Input id="st-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </Field>
        <Field label="Харагдах нэр" htmlFor="st-display">
          <Input id="st-display" value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} />
        </Field>
        <Field label="Албан тушаал" htmlFor="st-title">
          <Input id="st-title" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
        </Field>
        <Field label="Туршлага (жил)" htmlFor="st-exp">
          <Input
            id="st-exp"
            inputMode="numeric"
            value={v.experienceYears}
            onChange={(e) => setV({ ...v, experienceYears: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Танилцуулга" htmlFor="st-bio">
        <Textarea id="st-bio" rows={3} value={v.bio} onChange={(e) => setV({ ...v, bio: e.target.value })} />
      </Field>
      <Field label="Туршлагын тайлбар" htmlFor="st-exptext">
        <Input
          id="st-exptext"
          value={v.experienceText}
          onChange={(e) => setV({ ...v, experienceText: e.target.value })}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <Field label="Мэргэшил (таслалаар)" htmlFor="st-spec">
          <Input id="st-spec" value={v.specialties} onChange={(e) => setV({ ...v, specialties: e.target.value })} />
        </Field>
        <Field label="Хуанлийн өнгө" htmlFor="st-color">
          <Input
            id="st-color"
            type="color"
            value={v.calendarColor}
            onChange={(e) => setV({ ...v, calendarColor: e.target.value })}
            className="h-11 w-20 p-1"
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-5">
        <Checkbox label="Идэвхтэй" checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />
        <Checkbox
          label="Онлайн захиалга авна"
          checked={v.acceptsOnlineBookings}
          onChange={(e) => setV({ ...v, acceptsOnlineBookings: e.target.checked })}
        />
      </div>
      <SaveButton pending={pending} />
      <FeedbackLine feedback={feedback} />
    </form>
  )
}

export function SkillsForm({ data }: { data: StaffAdmin }) {
  const [skills, setSkills] = useState(
    new Map(data.staffSkills.map((s) => [s.skillId, s.level as 'standard' | 'senior'])),
  )
  const [serviceIds, setServiceIds] = useState(new Set(data.serviceIds))
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [pending, start] = useTransition()
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () =>
          setFeedback(
            feedbackFrom(
              await saveStaffSkillsAction({
                staffId: data.staff.id,
                skills: [...skills.entries()].map(([skillId, level]) => ({ skillId, level })),
                serviceIds: [...serviceIds],
              }),
              'Ур чадвар, үйлчилгээ хадгалагдлаа.',
            ),
          ),
        )
      }}
    >
      <fieldset>
        <legend className="text-sm font-medium text-cocoa-900">Ур чадвар</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {data.skills.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 rounded-xs border border-line px-3 py-2">
              <Checkbox
                label={s.name}
                checked={skills.has(s.id)}
                onChange={(e) => {
                  const next = new Map(skills)
                  if (e.target.checked) next.set(s.id, 'standard')
                  else next.delete(s.id)
                  setSkills(next)
                }}
              />
              {skills.has(s.id) ? (
                <select
                  aria-label={`${s.name} түвшин`}
                  value={skills.get(s.id)}
                  onChange={(e) => setSkills(new Map(skills).set(s.id, e.target.value as 'standard' | 'senior'))}
                  className="rounded-xs border border-line bg-porcelain px-1.5 py-1 text-xs"
                >
                  <option value="standard">Энгийн</option>
                  <option value="senior">Ахлах</option>
                </select>
              ) : null}
            </div>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-medium text-cocoa-900">Хийдэг үйлчилгээ</legend>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {data.services.map((s) => {
            const ok = s.requiredSkillIds.every((r) => skills.has(r))
            return (
              <Checkbox
                key={s.id}
                label={
                  <span className={ok ? '' : 'text-ink-3'}>
                    {s.name}
                    {!ok ? ' — ур чадвар дутуу' : ''}
                    {!s.isActive ? ' (идэвхгүй)' : ''}
                  </span>
                }
                checked={serviceIds.has(s.id)}
                disabled={!ok && !serviceIds.has(s.id)}
                onChange={(e) => {
                  const next = new Set(serviceIds)
                  if (e.target.checked) next.add(s.id)
                  else next.delete(s.id)
                  setServiceIds(next)
                }}
              />
            )
          })}
        </div>
      </fieldset>
      <SaveButton pending={pending} />
      <FeedbackLine feedback={feedback} />
    </form>
  )
}

export function ScheduleForm({ data }: { data: StaffAdmin }) {
  const [days, setDays] = useState(
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
      const s = data.schedules.find((x) => x.weekday === weekday)
      return {
        weekday,
        isWorking: s?.isWorking ?? false,
        startsAt: minutesToTime(s?.startsAt ?? 600),
        endsAt: minutesToTime(s?.endsAt ?? 1140),
      }
    }),
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
              await saveScheduleAction({
                staffId: data.staff.id,
                days: days.map((d) => ({
                  weekday: d.weekday,
                  isWorking: d.isWorking,
                  startsAt: timeToMinutes(d.startsAt) ?? 600,
                  endsAt: timeToMinutes(d.endsAt) ?? 1140,
                })),
              }),
              'Хуваарь хадгалагдлаа. Сул цаг шинэ хуваариар тооцогдоно.',
            ),
          ),
        )
      }}
    >
      {days.map((d, i) => (
        <div key={d.weekday} className="grid grid-cols-2 items-center gap-2 text-sm sm:grid-cols-[6.5rem_auto_1fr_1fr]">
          <span>{WEEKDAYS_MN[d.weekday - 1]}</span>
          <Checkbox
            label="Ажиллана"
            checked={d.isWorking}
            onChange={(e) => setDays(days.map((x, j) => (j === i ? { ...x, isWorking: e.target.checked } : x)))}
          />
          <TimeSelect
            aria-label={`${WEEKDAYS_MN[d.weekday - 1]} эхлэх`}
            value={d.startsAt}
            disabled={!d.isWorking}
            onChange={(e) => setDays(days.map((x, j) => (j === i ? { ...x, startsAt: e.target.value } : x)))}
          />
          <TimeSelect
            aria-label={`${WEEKDAYS_MN[d.weekday - 1]} дуусах`}
            value={d.endsAt}
            disabled={!d.isWorking}
            onChange={(e) => setDays(days.map((x, j) => (j === i ? { ...x, endsAt: e.target.value } : x)))}
          />
        </div>
      ))}
      <SaveButton pending={pending} />
      <FeedbackLine feedback={feedback} />
    </form>
  )
}

export function BreaksForm({ data }: { data: StaffAdmin }) {
  const [v, setV] = useState({ weekday: 'all', startsAt: '13:00', endsAt: '13:30', label: 'Үдийн завсарлага' })
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [pending, start] = useTransition()
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line text-sm">
        {data.breaks.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-3 py-2">
            <span>
              {b.weekday ? WEEKDAYS_MN[b.weekday - 1] : 'Өдөр бүр'} · {minutesToTime(b.startsAt)}–
              {minutesToTime(b.endsAt)} · {b.label}
            </span>
            <ActionButton action={removeBreakAction.bind(null, { breakId: b.id })} variant="ghost" okText="Устгалаа.">
              <Trash2 className="size-3.5" aria-hidden /> <span className="sr-only">Устгах</span>
            </ActionButton>
          </li>
        ))}
        {!data.breaks.length ? <li className="py-2 text-ink-3">Завсарлага тохируулаагүй.</li> : null}
      </ul>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          start(async () =>
            setFeedback(
              feedbackFrom(
                await addBreakAction({
                  staffId: data.staff.id,
                  weekday: v.weekday === 'all' ? null : Number(v.weekday),
                  startsAt: timeToMinutes(v.startsAt) ?? 0,
                  endsAt: timeToMinutes(v.endsAt) ?? 0,
                  label: v.label,
                }),
                'Завсарлага нэмэгдлээ.',
              ),
            ),
          )
        }}
      >
        <div className="grid grid-cols-3 gap-2">
          <Select aria-label="Өдөр" value={v.weekday} onChange={(e) => setV({ ...v, weekday: e.target.value })}>
            <option value="all">Өдөр бүр</option>
            {WEEKDAYS_MN.map((w, i) => (
              <option key={w} value={i + 1}>
                {w}
              </option>
            ))}
          </Select>
          <TimeSelect
            aria-label="Эхлэх"
            value={v.startsAt}
            onChange={(e) => setV({ ...v, startsAt: e.target.value })}
          />
          <TimeSelect aria-label="Дуусах" value={v.endsAt} onChange={(e) => setV({ ...v, endsAt: e.target.value })} />
        </div>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Input aria-label="Нэр" value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} />
          </div>
          <SaveButton pending={pending}>Нэмэх</SaveButton>
        </div>
      </form>
      <FeedbackLine feedback={feedback} />
    </div>
  )
}

const KIND_LABELS = {
  day_off: 'Чөлөө',
  vacation: 'Ээлжийн амралт',
  sick: 'Өвчтэй',
  training: 'Сургалт',
  other: 'Бусад',
} as const

export function TimeOffForm({ data, today }: { data: StaffAdmin; today: string }) {
  const [v, setV] = useState({
    from: today,
    to: today,
    partial: false,
    startTime: '14:00',
    endTime: '19:00',
    kind: 'day_off' as keyof typeof KIND_LABELS,
    note: '',
  })
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [pending, start] = useTransition()
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line text-sm">
        {data.timeOff.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-3 py-2">
            <span>
              {KIND_LABELS[o.kind]} · {formatDateTime(o.startsAt)} – {formatDateTime(o.endsAt)}
              {o.note ? ` · ${o.note}` : ''}
            </span>
            <ActionButton
              action={removeTimeOffAction.bind(null, { timeOffId: o.id })}
              variant="ghost"
              okText="Устгалаа."
            >
              <Trash2 className="size-3.5" aria-hidden /> <span className="sr-only">Устгах</span>
            </ActionButton>
          </li>
        ))}
        {!data.timeOff.length ? <li className="py-2 text-ink-3">Чөлөө бүртгэгдээгүй.</li> : null}
      </ul>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          start(async () => {
            const res = await addTimeOffAction({
              staffId: data.staff.id,
              from: v.from,
              to: v.to,
              startTime: v.partial ? timeToMinutes(v.startTime) : null,
              endTime: v.partial ? timeToMinutes(v.endTime) : null,
              kind: v.kind,
              note: v.note || null,
            })
            const fb = feedbackFrom(res, 'Чөлөө бүртгэгдлээ. Энэ хугацаанд онлайн захиалга авахгүй.')
            if (res.ok && res.data.clashes.length && fb)
              fb.text += ` Анхаар: ${res.data.clashes.length} захиалга давхцаж байна — ${res.data.clashes.join(', ')}. Шилжүүлнэ үү.`
            setFeedback(fb)
          })
        }}
      >
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <Field label="Эхлэх өдөр" htmlFor="to-from">
            <Input id="to-from" type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} />
          </Field>
          <Field label="Дуусах өдөр" htmlFor="to-to">
            <Input id="to-to" type="date" value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} />
          </Field>
          <Field label="Төрөл" htmlFor="to-kind">
            <Select
              id="to-kind"
              value={v.kind}
              onChange={(e) => setV({ ...v, kind: e.target.value as keyof typeof KIND_LABELS })}
            >
              {Object.entries(KIND_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Тайлбар" htmlFor="to-note" optional>
            <Input id="to-note" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Checkbox
            label="Өдрийн зөвхөн хэсэг"
            checked={v.partial}
            onChange={(e) => setV({ ...v, partial: e.target.checked })}
          />
          {v.partial ? (
            <>
              <TimeSelect
                aria-label="Эхлэх цаг"
                value={v.startTime}
                onChange={(e) => setV({ ...v, startTime: e.target.value })}
                className="w-32"
              />
              <TimeSelect
                aria-label="Дуусах цаг"
                value={v.endTime}
                onChange={(e) => setV({ ...v, endTime: e.target.value })}
                className="w-32"
              />
            </>
          ) : null}
        </div>
        <SaveButton pending={pending}>Чөлөө нэмэх</SaveButton>
      </form>
      <FeedbackLine feedback={feedback} />
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card title={title}>{children}</Card>
}
