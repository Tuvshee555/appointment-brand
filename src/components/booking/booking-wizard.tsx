'use client'

import { ArrowLeft, Check, Clock, Info, Loader2, Plus, Sparkles, UserRound, Users } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { StaffAvatar } from '@/components/catalog/staff-card'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/field'
import { Money } from '@/components/ui/money'
import { Photo } from '@/components/ui/photo'
import type { CalendarDay } from '@/lib/availability/engine'
import {
  buildQuote,
  QuoteError,
  type CatalogAddon,
  type CatalogService,
  type Quote,
  type SelectionItem,
} from '@/lib/booking/pricing'
import {
  addDays,
  addMonths,
  dateKeyOf,
  diffDays,
  formatDateKey,
  formatDuration,
  minutesToTime,
  timeToMinutes,
} from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { normalizePhone } from '@/lib/phone'
import { cn } from '@/lib/cn'
import {
  createBookingAction,
  dayAvailabilityAction,
  monthAvailabilityAction,
  type PublicSlot,
} from '@/server/actions/booking'
import type { PublicCatalog, PublicSalon } from '@/server/queries/public'
import { MonthCalendar } from './month-calendar'

type Step = 'services' | 'staff' | 'date' | 'time' | 'details' | 'review'
const STEPS: { key: Step; label: string }[] = [
  { key: 'services', label: 'Үйлчилгээ' },
  { key: 'staff', label: 'Мастер' },
  { key: 'date', label: 'Өдөр' },
  { key: 'time', label: 'Цаг' },
  { key: 'details', label: 'Мэдээлэл' },
  { key: 'review', label: 'Шалгах' },
]

interface Customer {
  name: string
  phone: string
  email: string
  note: string
  preferences: string
}

interface Alternative {
  date: string
  start: number
  startsAt: string
}

export function BookingWizard({ catalog, rules }: { catalog: PublicCatalog; rules: PublicSalon['rules'] }) {
  const router = useRouter()
  const params = useSearchParams()
  const serviceBySlug = useMemo(() => new Map(catalog.services.map((s) => [s.slug, s])), [catalog])
  const staffBySlug = useMemo(() => new Map(catalog.staff.map((s) => [s.slug, s])), [catalog])
  const staffById = useMemo(() => new Map(catalog.staff.map((s) => [s.id, s])), [catalog])
  const addonById = useMemo(() => new Map(catalog.addons.map((a) => [a.id, a])), [catalog])

  // ---- Prefill from the URL (service, staff, date, time)
  const prefillService = serviceBySlug.get(params.get('service') ?? '')
  const prefillStaff = staffBySlug.get(params.get('staff') ?? '')
  const prefillDate = params.get('date')
  const prefillTime = timeToMinutes(params.get('time') ?? '')

  const [items, setItems] = useState<SelectionItem[]>(() =>
    prefillService ? [{ serviceId: prefillService.id, addonIds: [] }] : [],
  )
  const [staffId, setStaffId] = useState<string | null | undefined>(
    () => prefillStaff?.id ?? (prefillService && prefillDate ? null : undefined),
  )
  const [date, setDate] = useState<string | null>(prefillService && prefillDate ? prefillDate : null)
  const [slot, setSlot] = useState<PublicSlot | null>(null)
  const [pendingTime, setPendingTime] = useState<number | null>(prefillService && prefillDate ? prefillTime : null)
  const [step, setStep] = useState<Step>(() =>
    prefillService && prefillDate ? 'time' : prefillService ? (prefillStaff ? 'date' : 'staff') : 'services',
  )
  const [customer, setCustomer] = useState<Customer>({ name: '', phone: '', email: '', note: '', preferences: '' })
  const [customerErrors, setCustomerErrors] = useState<Partial<Record<keyof Customer, string>>>({})
  const [category, setCategory] = useState<string | null>(prefillService?.categorySlug ?? null)
  const [onlyStaffServices, setOnlyStaffServices] = useState(Boolean(prefillStaff && !prefillService))
  const [today] = useState(() => dateKeyOf(new Date()))
  const [month, setMonth] = useState<string>(() => (prefillDate ?? dateKeyOf(new Date())).slice(0, 7))
  const [days, setDays] = useState<CalendarDay[] | null>(null)
  const [slots, setSlots] = useState<PublicSlot[] | null>(null)
  const [dayInfo, setDayInfo] = useState<{ special: string | null; closed: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [alternatives, setAlternatives] = useState<Alternative[]>([])
  const [submitting, startSubmit] = useTransition()
  const headingRef = useRef<HTMLHeadingElement>(null)

  // ---- Quote (instant feedback; the server recalculates on submit)
  const quoteState = useMemo((): { quote: Quote | null; error: string | null } => {
    if (!items.length) return { quote: null, error: null }
    const services = new Map<string, CatalogService>(
      catalog.services.map((s) => [
        s.id,
        {
          id: s.id,
          name: s.name,
          categoryName: s.categoryName,
          durationMinutes: s.durationMinutes,
          price: s.price,
          priceType: s.priceType,
          bufferMinutes: s.bufferMinutes,
          addonIds: s.addonIds,
        },
      ]),
    )
    const addons = new Map<string, CatalogAddon>(catalog.addons.map((a) => [a.id, a]))
    try {
      return {
        quote: buildQuote(
          items,
          { services, addons },
          {
            defaultBufferMinutes: rules.defaultBufferMinutes,
            deposit: {
              mode: rules.depositMode,
              fixedAmount: rules.depositFixedAmount,
              percentBps: rules.depositPercentBps,
              minTotal: rules.depositMinTotal,
            },
            maxServices: rules.maxServicesPerBooking,
          },
        ),
        error: null,
      }
    } catch (err) {
      return { quote: null, error: err instanceof QuoteError ? err.message : 'Сонголтоо шалгана уу.' }
    }
  }, [items, catalog, rules])
  const quote = quoteState.quote
  // Loading is derived: data is cleared whenever its inputs change.
  const loading = step === 'date' ? days === null : step === 'time' ? slots === null : false

  const eligibleStaff = useMemo(
    () =>
      catalog.staff.filter(
        (s) => s.acceptsOnlineBookings && items.length > 0 && items.every((i) => s.serviceIds.includes(i.serviceId)),
      ),
    [catalog.staff, items],
  )
  const chosenStaff = staffId ? staffById.get(staffId) : null
  const selectionKey = JSON.stringify([items, staffId ?? null])

  // Any change to services or specialist invalidates the chosen time.
  const [lastSelection, setLastSelection] = useState(selectionKey)
  if (lastSelection !== selectionKey) {
    setLastSelection(selectionKey)
    setDays(null)
    setSlots(null)
    setSlot(null)
    setAlternatives([])
  }

  const goto = (next: Step) => {
    setError(null)
    setStep(next)
    requestAnimationFrame(() => {
      headingRef.current?.focus()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }

  // ---- Data loading
  useEffect(() => {
    if (step !== 'date' || !items.length || staffId === undefined) return
    let cancelled = false
    monthAvailabilityAction({ items, staffId, month }).then((res) => {
      if (cancelled) return
      if (res.ok) setDays(res.data.days)
      else {
        setError(res.error)
        setDays([])
      }
    })
    return () => {
      cancelled = true
    }
  }, [step, month, selectionKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (step !== 'time' || !date || !items.length || staffId === undefined) return
    let cancelled = false
    dayAvailabilityAction({ items, staffId, date }).then((res) => {
      if (cancelled) return
      if (!res.ok) {
        setError(res.error)
        setSlots([])
        return
      }
      setSlots(res.data.slots)
      setDayInfo({ special: res.data.special, closed: res.data.closed })
      if (pendingTime !== null) {
        const match = res.data.slots.find((s) => s.start === pendingTime)
        if (match) setSlot(match)
        setPendingTime(null)
      }
    })
    return () => {
      cancelled = true
    }
  }, [step, date, selectionKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Selection helpers
  const toggleService = (id: string) => {
    setItems((prev) => {
      if (prev.some((i) => i.serviceId === id)) return prev.filter((i) => i.serviceId !== id)
      if (prev.length >= rules.maxServicesPerBooking) return prev
      return [...prev, { serviceId: id, addonIds: [] }]
    })
  }
  const toggleAddon = (serviceId: string, addonId: string) =>
    setItems((prev) =>
      prev.map((i) =>
        i.serviceId === serviceId
          ? {
              ...i,
              addonIds: i.addonIds.includes(addonId)
                ? i.addonIds.filter((a) => a !== addonId)
                : [...i.addonIds, addonId],
            }
          : i,
      ),
    )

  const validateCustomer = (): boolean => {
    const errs: Partial<Record<keyof Customer, string>> = {}
    if (customer.name.trim().length < 2) errs.name = 'Нэрээ бүтэн оруулна уу.'
    if (!normalizePhone(customer.phone)) errs.phone = 'Утасны дугаар 8 оронтой байх ёстой. Жишээ: 9911 2233'
    if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim()))
      errs.email = 'И-мэйл хаяг буруу байна.'
    setCustomerErrors(errs)
    return Object.keys(errs).length === 0
  }

  const fillDemoCustomer = () => {
    const n = Math.floor(Math.random() * 900) + 100
    setCustomer((c) => ({ ...c, name: 'Туршилтын Үйлчлүүлэгч', phone: `5000${String(n).padStart(4, '0')}`, email: '' }))
    setCustomerErrors({})
  }

  const submit = () => {
    if (!quote || !date || !slot || staffId === undefined) return
    setError(null)
    setAlternatives([])
    startSubmit(async () => {
      const res = await createBookingAction({
        items,
        staffId,
        date,
        start: slot.start,
        customer: {
          name: customer.name,
          phone: customer.phone,
          email: customer.email || null,
          note: customer.note || null,
          preferences: customer.preferences || null,
        },
      })
      if (res.ok) {
        router.push(`/booking/${res.data.reference}?t=${encodeURIComponent(res.data.token)}&new=1`)
        return
      }
      setError(res.error)
      if (res.fieldErrors) {
        const fe: Partial<Record<keyof Customer, string>> = {}
        for (const [k, v] of Object.entries(res.fieldErrors)) {
          const key = k.replace('customer.', '') as keyof Customer
          fe[key] = v
        }
        setCustomerErrors(fe)
      }
      const alts = (res.details as { alternatives?: Alternative[] } | undefined)?.alternatives
      if (res.code === 'slot_unavailable') {
        setSlot(null)
        setAlternatives(alts ?? [])
      }
    })
  }

  const chooseAlternative = (alt: Alternative) => {
    setSlots(null)
    setDate(alt.date)
    setPendingTime(alt.start)
    setAlternatives([])
    goto('time')
  }

  // ---- Status the customer should expect (mirrors the server policy)
  const expectedStatus = quote
    ? quote.deposit > 0
      ? `Урьдчилгаа ${formatMoney(quote.deposit)} төлбөрийн системээр баталгаажсаны дараа цаг баталгаажна. Төлөхөд ${rules.holdMinutes} минут цаг хадгалагдана.`
      : rules.confirmationMode === 'manual'
        ? 'Захиалгын хүсэлт бүртгэгдэж, салон баталгаажуулах хүртэл цаг тань хадгалагдана.'
        : 'Захиалга шууд баталгаажна.'
    : ''

  const stepIndex = STEPS.findIndex((s) => s.key === step)
  const canContinue: Record<Step, boolean> = {
    services: Boolean(quote),
    staff:
      staffId !== undefined &&
      (staffId === null ? eligibleStaff.length > 0 : eligibleStaff.some((s) => s.id === staffId)),
    date: Boolean(date),
    time: Boolean(slot),
    details: true,
    review: true,
  }
  const next = () => {
    if (step === 'details' && !validateCustomer()) return
    const n = STEPS[stepIndex + 1]
    if (n) goto(n.key)
  }
  const back = () => {
    const p = STEPS[stepIndex - 1]
    if (p) goto(p.key)
  }

  const visibleServices = catalog.services.filter(
    (s) =>
      s.onlineBookable &&
      (!category || s.categorySlug === category) &&
      (!onlyStaffServices || !prefillStaff || prefillStaff.serviceIds.includes(s.id)),
  )

  const firstMonth = today.slice(0, 7)
  const lastMonth = addDays(today, rules.maxAdvanceDays).slice(0, 7)

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
      <div className="min-w-0">
        {/* Progress */}
        <div className="sm:hidden" aria-hidden>
          <p className="text-sm text-ink-3">
            Алхам {stepIndex + 1}/{STEPS.length} · <span className="text-cocoa-900">{STEPS[stepIndex].label}</span>
          </p>
          <div className="mt-2 h-1 rounded-full bg-sand">
            <div
              className="h-1 rounded-full bg-cocoa-700 transition-all"
              style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
            />
          </div>
        </div>
        <nav aria-label="Захиалгын алхам" className="hidden sm:block">
          <ol className="flex min-w-max items-center gap-2 text-sm">
            {STEPS.map((s, i) => (
              <li key={s.key} className="flex items-center gap-2">
                <span
                  aria-current={s.key === step ? 'step' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-full px-3 py-1.5',
                    s.key === step ? 'bg-cocoa-800 text-ivory' : i < stepIndex ? 'text-cocoa-800' : 'text-ink-3',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-5 items-center justify-center rounded-full text-[0.7rem]',
                      s.key === step
                        ? 'bg-ivory text-cocoa-900'
                        : i < stepIndex
                          ? 'bg-cocoa-200 text-cocoa-900'
                          : 'border border-line-strong',
                    )}
                  >
                    {i < stepIndex ? <Check className="size-3" aria-hidden /> : i + 1}
                  </span>
                  {s.label}
                </span>
                {i < STEPS.length - 1 ? <span className="h-px w-4 bg-line-strong" aria-hidden /> : null}
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-8">
          {stepIndex > 0 ? (
            <button
              type="button"
              onClick={back}
              className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-cocoa-900"
            >
              <ArrowLeft className="size-4" aria-hidden /> Буцах
            </button>
          ) : null}
          <h2 ref={headingRef} tabIndex={-1} className="display text-4xl text-cocoa-900 outline-none sm:text-[2.6rem]">
            {step === 'services' && 'Үйлчилгээгээ сонгоно уу'}
            {step === 'staff' && 'Мастер сонгох'}
            {step === 'date' && 'Өдөр сонгох'}
            {step === 'time' && 'Цаг сонгох'}
            {step === 'details' && 'Таны мэдээлэл'}
            {step === 'review' && 'Шалгаад баталгаажуулах'}
          </h2>

          {error ? (
            <p
              role="alert"
              className="mt-5 rounded-xs border border-rose-600/30 bg-rose-50 px-4 py-3 text-sm text-rose-700"
            >
              {error}
            </p>
          ) : null}

          {/* ---- Step 1: services */}
          {step === 'services' && (
            <div className="mt-6">
              <p className="text-sm text-ink-3">
                Хамгийн ихдээ {rules.maxServicesPerBooking} үйлчилгээ хослуулна. Нэмэлт сонголтын үнэ, хугацаа нийлбэрт
                шууд нэмэгдэнэ.
              </p>
              {prefillStaff ? (
                <label className="mt-4 flex items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-cocoa-700"
                    checked={onlyStaffServices}
                    onChange={(e) => setOnlyStaffServices(e.target.checked)}
                  />
                  Зөвхөн {prefillStaff.displayName} мастерын хийдэг үйлчилгээ
                </label>
              ) : null}
              <div className="no-scrollbar -mx-4 mt-5 flex gap-2 overflow-x-auto px-4">
                {[{ slug: null as string | null, name: 'Бүгд' }, ...catalog.categories].map((c) => (
                  <button
                    key={c.slug ?? 'all'}
                    type="button"
                    aria-pressed={category === c.slug}
                    onClick={() => setCategory(c.slug)}
                    className={cn(
                      'shrink-0 rounded-full border px-4 py-2 text-sm',
                      category === c.slug
                        ? 'border-cocoa-800 bg-cocoa-800 text-ivory'
                        : 'border-line-strong text-ink-2 hover:border-cocoa-600',
                    )}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <ul className="mt-5 space-y-3">
                {visibleServices.map((s) => {
                  const selected = items.find((i) => i.serviceId === s.id)
                  const full = !selected && items.length >= rules.maxServicesPerBooking
                  return (
                    <li
                      key={s.id}
                      className={cn(
                        'surface overflow-hidden transition-colors',
                        selected && 'border-cocoa-700 ring-1 ring-cocoa-700',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleService(s.id)}
                        disabled={full}
                        aria-pressed={Boolean(selected)}
                        className="flex w-full items-center gap-4 p-3 text-left disabled:opacity-50 sm:p-4"
                      >
                        <span className="relative size-16 shrink-0 overflow-hidden rounded-xs bg-sand sm:size-20">
                          {s.imageUrl ? (
                            <Photo src={s.imageUrl} alt="" fill sizes="80px" className="object-cover" />
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-cocoa-900">{s.name}</span>
                          <span className="mt-0.5 line-clamp-2 block text-[0.83rem] text-ink-3">
                            {s.shortDescription}
                          </span>
                          <span className="mt-1.5 flex items-center gap-3 text-[0.83rem]">
                            <span className="inline-flex items-center gap-1 text-ink-3">
                              <Clock className="size-3.5" aria-hidden /> {formatDuration(s.durationMinutes)}
                            </span>
                            <Money
                              amount={s.price}
                              from={s.priceType === 'from'}
                              className="font-medium text-cocoa-900"
                            />
                          </span>
                        </span>
                        <span
                          className={cn(
                            'flex size-7 shrink-0 items-center justify-center rounded-full border',
                            selected ? 'border-cocoa-800 bg-cocoa-800 text-ivory' : 'border-line-strong text-ink-3',
                          )}
                          aria-hidden
                        >
                          {selected ? <Check className="size-4" /> : <Plus className="size-4" />}
                        </span>
                      </button>
                      {selected && s.addonIds.length ? (
                        <div className="border-t border-line bg-ivory/60 px-4 py-3">
                          <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">Нэмэлт сонголт</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {s.addonIds.map((id) => {
                              const a = addonById.get(id)!
                              const on = selected.addonIds.includes(id)
                              return (
                                <button
                                  key={id}
                                  type="button"
                                  aria-pressed={on}
                                  onClick={() => toggleAddon(s.id, id)}
                                  className={cn(
                                    'rounded-full border px-3 py-1.5 text-[0.8rem]',
                                    on
                                      ? 'border-cocoa-800 bg-cocoa-50 text-cocoa-900'
                                      : 'border-line-strong text-ink-2 hover:border-cocoa-600',
                                  )}
                                >
                                  {on ? '✓ ' : '+ '}
                                  {a.name} · {formatMoney(a.price)}
                                  {a.priceType === 'from' ? '-өөс' : ''} · +{formatDuration(a.durationMinutes)}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
              {quoteState.error ? <p className="mt-4 text-sm text-rose-700">{quoteState.error}</p> : null}
            </div>
          )}

          {/* ---- Step 2: staff */}
          {step === 'staff' && (
            <div className="mt-6">
              {eligibleStaff.length === 0 ? (
                <div className="rounded-xs border border-amber-600/30 bg-amber-50 p-4 text-sm text-amber-700">
                  Сонгосон үйлчилгээнүүдийг нэг мастер хамт хийдэггүй. Үйлчилгээгээ тусад нь захиалах эсвэл аль нэгийг
                  хасна уу.
                  <button
                    type="button"
                    onClick={() => goto('services')}
                    className="mt-2 block font-medium underline underline-offset-4"
                  >
                    Үйлчилгээ өөрчлөх
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-ink-3">Зөвхөн сонгосон бүх үйлчилгээг хийдэг мастерууд харагдаж байна.</p>
                  {prefillStaff && !eligibleStaff.some((s) => s.id === prefillStaff.id) ? (
                    <p className="mt-3 rounded-xs bg-amber-50 px-3 py-2 text-sm text-amber-700">
                      {prefillStaff.displayName} мастер эдгээр үйлчилгээг бүгдийг нь хийдэггүй тул өөр мастер сонгоно
                      уу.
                    </p>
                  ) : null}
                  <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                    <li>
                      <button
                        type="button"
                        onClick={() => setStaffId(null)}
                        aria-pressed={staffId === null}
                        className={cn(
                          'surface flex h-full w-full items-center gap-4 p-4 text-left transition-colors hover:border-cocoa-600',
                          staffId === null && 'border-cocoa-700 ring-1 ring-cocoa-700',
                        )}
                      >
                        <span className="flex size-14 items-center justify-center rounded-full bg-blush-100 text-blush-700">
                          <Users className="size-6" aria-hidden />
                        </span>
                        <span>
                          <span className="block font-medium text-cocoa-900">Аль ч мастер</span>
                          <span className="block text-[0.83rem] text-ink-3">
                            Хамгийн олон сул цаг. Систем тухайн цагт сул мастерыг оноона.
                          </span>
                        </span>
                      </button>
                    </li>
                    {eligibleStaff.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => setStaffId(s.id)}
                          aria-pressed={staffId === s.id}
                          className={cn(
                            'surface flex h-full w-full items-center gap-4 p-4 text-left transition-colors hover:border-cocoa-600',
                            staffId === s.id && 'border-cocoa-700 ring-1 ring-cocoa-700',
                          )}
                        >
                          <StaffAvatar staff={s} size={56} />
                          <span className="min-w-0">
                            <span className="block font-medium text-cocoa-900">{s.displayName}</span>
                            <span className="block text-[0.83rem] text-ink-3">{s.title}</span>
                            <span className="mt-1 block truncate text-xs text-ink-3">{s.specialties.join(' · ')}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {/* ---- Step 3: date */}
          {step === 'date' && (
            <div className="mt-6">
              <p className="mb-5 text-sm text-ink-3">
                Сул цаг нь {chosenStaff ? `${chosenStaff.displayName} мастерын` : 'мастеруудын'} ажлын хуваарь,
                завсарлага, амралт, одоо байгаа захиалгаас бодогдоно. Ойрын {rules.maxAdvanceDays} хоногийн цаг
                нээлттэй.
              </p>
              <MonthCalendar
                month={month}
                days={days}
                loading={loading}
                selected={date}
                canPrev={month > firstMonth}
                canNext={month < lastMonth}
                onMonth={(m) => {
                  setDays(null)
                  setMonth(m)
                }}
                onSelect={(d) => {
                  setDate(d)
                  setSlot(null)
                  setSlots(null)
                  goto('time')
                }}
              />
              {days && !days.some((d) => d.state === 'available') && !loading ? (
                <p className="mt-4 text-sm text-ink-2">
                  Энэ сард сул цаг алга.{' '}
                  {month < lastMonth ? (
                    <button
                      type="button"
                      className="font-medium underline underline-offset-4"
                      onClick={() => setMonth(addMonths(`${month}-01`, 1).slice(0, 7))}
                    >
                      Дараагийн сарыг харах
                    </button>
                  ) : null}
                </p>
              ) : null}
            </div>
          )}

          {/* ---- Step 4: time */}
          {step === 'time' && date && (
            <div className="mt-6">
              <p className="text-[0.95rem] text-ink-2">
                {formatDateKey(date)}
                {diffDays(date, today) === 0 ? ' · өнөөдөр' : diffDays(date, today) === 1 ? ' · маргааш' : ''}
                {quote ? ` · ${formatDuration(quote.durationMinutes)}` : ''}
              </p>
              {dayInfo?.special ? (
                <p className="mt-2 inline-flex items-center gap-2 rounded-xs bg-blush-50 px-3 py-1.5 text-sm text-blush-700">
                  <Info className="size-4" aria-hidden /> {dayInfo.special}
                </p>
              ) : null}
              {loading || !slots ? (
                <div className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-5" aria-hidden>
                  {Array.from({ length: 10 }, (_, i) => (
                    <span key={i} className="h-12 animate-pulse rounded-xs bg-sand" />
                  ))}
                </div>
              ) : slots.length === 0 ? (
                <div className="mt-6 rounded-xs border border-line bg-porcelain p-5 text-sm text-ink-2">
                  Энэ өдөр сул цаг үлдсэнгүй.
                  <button
                    type="button"
                    onClick={() => goto('date')}
                    className="ml-2 font-medium underline underline-offset-4"
                  >
                    Өөр өдөр сонгох
                  </button>
                </div>
              ) : (
                <div className="mt-6 space-y-6">
                  {[
                    { label: 'Өглөө', list: slots.filter((s) => s.start < 720) },
                    { label: 'Өдөр', list: slots.filter((s) => s.start >= 720 && s.start < 1020) },
                    { label: 'Орой', list: slots.filter((s) => s.start >= 1020) },
                  ]
                    .filter((g) => g.list.length)
                    .map((g) => (
                      <fieldset key={g.label}>
                        <legend className="text-xs font-medium tracking-wide text-ink-3 uppercase">{g.label}</legend>
                        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                          {g.list.map((s) => (
                            <button
                              key={s.start}
                              type="button"
                              aria-pressed={slot?.start === s.start}
                              onClick={() => setSlot(s)}
                              className={cn(
                                'tabular h-12 rounded-xs border text-[0.98rem] transition-colors',
                                slot?.start === s.start
                                  ? 'border-cocoa-800 bg-cocoa-800 text-ivory'
                                  : 'border-line-strong bg-porcelain text-cocoa-900 hover:border-cocoa-700',
                              )}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                      </fieldset>
                    ))}
                  {slot && quote ? (
                    <p className="rounded-xs bg-sage-50 px-4 py-3 text-sm text-sage-700">
                      {minutesToTime(slot.start)}–{minutesToTime(slot.start + quote.durationMinutes)} ·{' '}
                      {staffId === null
                        ? `${slot.staffIds.length} мастер сул — систем оноона`
                        : `${chosenStaff?.displayName} мастер`}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          )}

          {/* ---- Step 5: details */}
          {step === 'details' && (
            <form
              className="mt-6 space-y-5"
              onSubmit={(e) => {
                e.preventDefault()
                next()
              }}
              noValidate
            >
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xs bg-blush-50 px-4 py-3 text-sm text-blush-700">
                <span>Демо: бодит нэр, утасны дугаар оруулах шаардлагагүй.</span>
                <button
                  type="button"
                  onClick={fillDemoCustomer}
                  className="inline-flex items-center gap-1.5 font-medium underline underline-offset-4"
                >
                  <Sparkles className="size-4" aria-hidden /> Жишээ мэдээлэл бөглөх
                </button>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Нэр" htmlFor="c-name" error={customerErrors.name}>
                  <Input
                    id="c-name"
                    autoComplete="name"
                    value={customer.name}
                    onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
                    aria-invalid={Boolean(customerErrors.name)}
                    aria-describedby={customerErrors.name ? 'c-name-error' : undefined}
                  />
                </Field>
                <Field
                  label="Утасны дугаар"
                  htmlFor="c-phone"
                  error={customerErrors.phone}
                  hint="8 оронтой, жишээ: 9911 2233"
                >
                  <Input
                    id="c-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={customer.phone}
                    onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                    aria-invalid={Boolean(customerErrors.phone)}
                    aria-describedby={customerErrors.phone ? 'c-phone-error' : 'c-phone-hint'}
                  />
                </Field>
              </div>
              <Field label="И-мэйл" htmlFor="c-email" optional error={customerErrors.email}>
                <Input
                  id="c-email"
                  type="email"
                  autoComplete="email"
                  value={customer.email}
                  onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
                  aria-invalid={Boolean(customerErrors.email)}
                />
              </Field>
              <Field
                label="Хүсэлт, тэмдэглэл"
                htmlFor="c-note"
                optional
                hint="Жишээ: зургаа авчирна, хуучин гелээ авахуулна"
              >
                <Textarea
                  id="c-note"
                  maxLength={500}
                  value={customer.note}
                  onChange={(e) => setCustomer({ ...customer, note: e.target.value })}
                />
              </Field>
              <Field label="Хэлбэр, өнгөний сонголт" htmlFor="c-pref" optional hint="Жишээ: богино зуйван, нүцгэн өнгө">
                <Input
                  id="c-pref"
                  maxLength={300}
                  value={customer.preferences}
                  onChange={(e) => setCustomer({ ...customer, preferences: e.target.value })}
                />
              </Field>
              <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
            </form>
          )}

          {/* ---- Step 6: review */}
          {step === 'review' && quote && date && slot && (
            <div className="mt-6 space-y-6">
              <div className="surface divide-y divide-line">
                <ReviewRow label="Үйлчилгээ" onEdit={() => goto('services')}>
                  <ul className="space-y-1.5">
                    {quote.lines.map((l) => (
                      <li key={l.serviceId}>
                        <div className="flex justify-between gap-4">
                          <span>
                            {l.name} <span className="text-ink-3">· {formatDuration(l.durationMinutes)}</span>
                          </span>
                          <Money amount={l.price} from={l.priceType === 'from'} />
                        </div>
                        {l.addons.map((a) => (
                          <div key={a.addonId} className="flex justify-between gap-4 pl-4 text-sm text-ink-3">
                            <span>
                              + {a.name} · {formatDuration(a.durationMinutes)}
                            </span>
                            <Money amount={a.price} from={a.priceType === 'from'} />
                          </div>
                        ))}
                      </li>
                    ))}
                  </ul>
                </ReviewRow>
                <ReviewRow label="Мастер" onEdit={() => goto('staff')}>
                  <span className="inline-flex items-center gap-2">
                    <UserRound className="size-4 text-ink-3" aria-hidden />
                    {staffId === null ? 'Аль ч мастер (систем тухайн цагт сул мастерыг оноох)' : chosenStaff?.name}
                  </span>
                </ReviewRow>
                <ReviewRow label="Өдөр, цаг" onEdit={() => goto('date')}>
                  {formatDateKey(date)} · {minutesToTime(slot.start)}–
                  {minutesToTime(slot.start + quote.durationMinutes)} ({formatDuration(quote.durationMinutes)})
                </ReviewRow>
                <ReviewRow label="Холбоо барих" onEdit={() => goto('details')}>
                  {customer.name}, {customer.phone}
                  {customer.email ? `, ${customer.email}` : ''}
                  {customer.note ? <span className="mt-1 block text-sm text-ink-3">«{customer.note}»</span> : null}
                </ReviewRow>
                <div className="space-y-1.5 px-5 py-4">
                  <div className="flex justify-between font-medium text-cocoa-900">
                    <span>Нийт үнэ</span>
                    <Money amount={quote.total} from={quote.hasFromPrice} />
                  </div>
                  {quote.deposit > 0 ? (
                    <div className="flex justify-between text-sm text-ink-2">
                      <span>Урьдчилгаа (одоо)</span>
                      <Money amount={quote.deposit} />
                    </div>
                  ) : null}
                  {quote.hasFromPrice ? (
                    <p className="text-xs text-ink-3">«-өөс» үнэтэй үйлчилгээний эцсийн үнэ салонд тохирно.</p>
                  ) : null}
                </div>
              </div>
              <p className="flex gap-2.5 rounded-xs border border-sky-600/25 bg-sky-50 px-4 py-3 text-sm text-sky-700">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{expectedStatus}</span>
              </p>
              {alternatives.length ? (
                <div className="rounded-xs border border-line bg-porcelain p-4">
                  <p className="text-sm font-medium text-cocoa-900">Ойрын сул цагууд:</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {alternatives.map((a) => (
                      <button
                        key={a.startsAt}
                        type="button"
                        onClick={() => chooseAlternative(a)}
                        className="rounded-xs border border-line-strong px-3 py-2 text-sm hover:border-cocoa-700"
                      >
                        {formatDateKey(a.date)} · {minutesToTime(a.start)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <p className="text-xs text-ink-3">
                «Захиалах» дарснаар сервер сонгосон цаг сул эсэхийг дахин шалгаж, үнийг салоны каталогоос дахин
                тооцоолно. Цуцлалтын нөхцөл: {rules.cancellationNoticeHours} цагаас өмнө цуцалбал урьдчилгаа бүтэн
                буцна.
              </p>
            </div>
          )}

          {/* ---- Navigation */}
          <div className="mt-10 hidden items-center gap-3 lg:flex">
            {step === 'review' ? (
              <Button size="lg" onClick={submit} disabled={submitting || !slot}>
                {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Захиалах
              </Button>
            ) : (
              <Button size="lg" onClick={next} disabled={!canContinue[step]}>
                Үргэлжлүүлэх
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ---- Summary (desktop) */}
      <aside className="hidden lg:block">
        <div className="sticky top-28">
          <Summary
            quote={quote}
            staffLabel={staffId === null ? 'Аль ч мастер' : chosenStaff?.displayName}
            date={date}
            slot={slot}
          />
        </div>
      </aside>

      {/* ---- Sticky bar (mobile) */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ivory/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 text-sm">
            {quote ? (
              <>
                <p className="tabular font-medium text-cocoa-900">
                  {formatMoney(quote.total)}
                  {quote.hasFromPrice ? '-өөс' : ''}
                </p>
                <p className="truncate text-xs text-ink-3">
                  {quote.lines.length} үйлчилгээ · {formatDuration(quote.durationMinutes)}
                  {slot && date ? ` · ${date.slice(5).replace('-', '/')} ${minutesToTime(slot.start)}` : ''}
                </p>
              </>
            ) : (
              <p className="text-xs text-ink-3">Үйлчилгээ сонгоогүй байна</p>
            )}
          </div>
          {step === 'review' ? (
            <Button onClick={submit} disabled={submitting || !slot} className="h-12">
              {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Захиалах
            </Button>
          ) : (
            <Button onClick={next} disabled={!canContinue[step]} className="h-12">
              Үргэлжлүүлэх
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function ReviewRow({ label, onEdit, children }: { label: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">{label}</p>
        <div className="mt-1.5 text-[0.95rem] text-ink">{children}</div>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="self-start text-sm text-cocoa-700 underline underline-offset-4 hover:text-cocoa-900"
      >
        Засах
      </button>
    </div>
  )
}

function Summary({
  quote,
  staffLabel,
  date,
  slot,
}: {
  quote: Quote | null
  staffLabel?: string
  date: string | null
  slot: PublicSlot | null
}) {
  return (
    <div className="surface p-5">
      <p className="eyebrow">Таны сонголт</p>
      {!quote ? (
        <p className="mt-4 text-sm text-ink-3">Үйлчилгээ сонгоход үнэ, хугацаа энд гарна.</p>
      ) : (
        <>
          <ul className="mt-4 space-y-3 text-sm">
            {quote.lines.map((l) => (
              <li key={l.serviceId}>
                <div className="flex justify-between gap-3">
                  <span className="text-ink">{l.name}</span>
                  <Money amount={l.price} from={l.priceType === 'from'} className="text-ink-2" />
                </div>
                {l.addons.map((a) => (
                  <div key={a.addonId} className="mt-0.5 flex justify-between gap-3 pl-3 text-xs text-ink-3">
                    <span>+ {a.name}</span>
                    <Money amount={a.price} from={a.priceType === 'from'} />
                  </div>
                ))}
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-3">Үргэлжлэх хугацаа</dt>
              <dd className="tabular">{formatDuration(quote.durationMinutes)}</dd>
            </div>
            {staffLabel ? (
              <div className="flex justify-between">
                <dt className="text-ink-3">Мастер</dt>
                <dd>{staffLabel}</dd>
              </div>
            ) : null}
            {date ? (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">Өдөр</dt>
                <dd className="text-right">
                  {formatDateKey(date)}
                  {slot ? ` · ${minutesToTime(slot.start)}` : ''}
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between pt-2 text-base font-medium text-cocoa-900">
              <dt>Нийт</dt>
              <dd>
                <Money amount={quote.total} from={quote.hasFromPrice} />
              </dd>
            </div>
            {quote.deposit > 0 ? (
              <div className="flex justify-between text-ink-2">
                <dt>Урьдчилгаа</dt>
                <dd>
                  <Money amount={quote.deposit} />
                </dd>
              </div>
            ) : null}
          </dl>
        </>
      )}
    </div>
  )
}
