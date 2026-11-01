// Demo data: customers, ~80–100 appointments across the last five weeks and
// the next three, payments, history, cancellations, notifications, staff time
// off, assistant conversations and audit entries. Every row is is_demo.
//
// Appointments are placed with the same availability engine the live site
// uses, so they respect opening hours, holidays, shifts, breaks and time off,
// and slot-holding appointments never overlap (the database exclusion
// constraint would reject them anyway). Generation is deterministic and the
// dates are relative to "now", so a reset always produces a living calendar.
import { randomUUID } from 'node:crypto'
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { computeDaySlots, salonHoursFor, type StaffDay } from '@/lib/availability/engine'
import { buildQuote, type Quote, type SelectionItem } from '@/lib/booking/pricing'
import { STATUS_LABELS, type AppointmentStatus } from '@/lib/booking/status'
import { addDays, dateKeyOf, dayBounds, formatDateTime, ubToUtc, weekdayOf, type DateKey } from '@/lib/datetime'
import { maskPhone } from '@/lib/phone'
import { parallel, type Database } from '@/server/db/client'
import * as t from '@/server/db/schema'
import { randomToken, sha256Hex } from '@/server/security/crypto'
import { loadBookingCatalog } from '@/server/services/catalog'
import { depositPolicy, loadSalonConfig, loadSpecialDays } from '@/server/services/salon'
import { CANCEL_TEXTS, CUSTOMER_NOTES, DEMO_CHATS, DEMO_CUSTOMERS, demoPhone } from './demo-data'
import { createRng } from './rng'

const OLD_GEL_PRICE = 60_000
const PRICE_CHANGE_DAYS_AGO = 20
const MINUTE = 60_000
const HOUR = 60 * MINUTE

type Source = (typeof t.appointmentSource.enumValues)[number]

const COMBOS: [{ services: string[]; addons?: Record<string, string[]> }, number][] = [
  [{ services: ['gel-polish'] }, 18],
  [{ services: ['gel-polish'], addons: { 'gel-polish': ['gel-removal-addon'] } }, 6],
  [{ services: ['gel-polish'], addons: { 'gel-polish': ['simple-art-addon'] } }, 5],
  [{ services: ['gel-polish-renewal'] }, 8],
  [{ services: ['classic-manicure'] }, 6],
  [{ services: ['basic-manicure'] }, 4],
  [{ services: ['mens-manicure'] }, 3],
  [{ services: ['french-manicure'] }, 6],
  [{ services: ['nail-strengthening'] }, 3],
  [{ services: ['gel-extensions'] }, 7],
  [{ services: ['nail-extensions'] }, 4],
  [{ services: ['acrylic-extensions'] }, 2],
  [{ services: ['nail-refill'] }, 7],
  [{ services: ['nail-refill'], addons: { 'nail-refill': ['premium-art-addon'] } }, 2],
  [{ services: ['basic-pedicure'] }, 5],
  [{ services: ['gel-pedicure'] }, 7],
  [{ services: ['premium-pedicure'] }, 4],
  [{ services: ['gel-polish', 'gel-pedicure'] }, 3],
  [{ services: ['gel-extensions', 'premium-nail-art'] }, 2],
  [{ services: ['gel-polish', 'custom-design'] }, 2],
  [{ services: ['hand-care'] }, 2],
  [{ services: ['gel-removal'] }, 2],
  [{ services: ['nail-repair'] }, 1],
  [{ services: ['classic-manicure', 'basic-pedicure'] }, 2],
]

interface GenAppointment {
  id: string
  reference: string
  staffId: string
  customerIdx: number
  date: DateKey
  startsAt: Date
  endsAt: Date
  occupiedUntil: Date
  quote: Quote
  serviceIds: string[]
  status: AppointmentStatus
  source: Source
  createdAt: Date
  confirmedAt: Date | null
  cancelledAt: Date | null
  completedAt: Date | null
  deposit: number
  staffRequested: boolean
  customerNote: string | null
  rescheduledFromId: string | null
  rescheduledAt: Date | null
  replacementRef: string | null
}

function chunk<T>(rows: T[], size = 150): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

export async function hasDemoData(db: Database, salonId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t.appointments)
    .where(and(eq(t.appointments.salonId, salonId), eq(t.appointments.isDemo, true)))
  return row?.n ?? 0
}

export async function seedDemo(
  db: Database,
  { salonId, now = new Date(), force = false }: { salonId: string; now?: Date; force?: boolean },
) {
  const existing = await hasDemoData(db, salonId)
  if (existing > 0 && !force)
    return `Demo data already present (${existing} appointments) — skipped. Run npm run db:reset-demo to refresh it.`

  const rng = createRng(20261101)
  const today = dateKeyOf(now)
  const config = await loadSalonConfig(db, salonId)
  const catalog = await loadBookingCatalog(db, salonId)
  const serviceBySlug = new Map([...catalog.services.values()].map((s) => [s.slug, s]))
  const addonRows = await db
    .select({ id: t.serviceAddons.id, slug: t.serviceAddons.slug })
    .from(t.serviceAddons)
    .where(eq(t.serviceAddons.salonId, salonId))
  const addonBySlug = new Map(addonRows.map((a) => [a.slug, a.id]))
  const staffList = catalog.staff.filter((s) => s.isActive)
  const staffIds = staffList.map((s) => s.id)
  const staffBySlug = new Map(staffList.map((s) => [s.slug, s]))
  const [schedules, breaks] = await parallel(db, [
    () => db.select().from(t.staffSchedules).where(inArray(t.staffSchedules.staffId, staffIds)),
    () => db.select().from(t.staffBreaks).where(inArray(t.staffBreaks.staffId, staffIds)),
  ])
  const [owner] = await db
    .select({ id: t.adminUsers.id })
    .from(t.adminUsers)
    .where(and(eq(t.adminUsers.salonId, salonId), eq(t.adminUsers.roleKey, 'owner')))
    .limit(1)

  // ---- Customers
  await db
    .insert(t.customers)
    .values(
      DEMO_CUSTOMERS.map((c, i) => ({
        salonId,
        name: c.name,
        phone: demoPhone(i),
        email: c.email ?? null,
        preferences: c.preferences ?? null,
        notes: c.notes ?? null,
        marketingOptIn: i % 3 === 0,
        isDemo: true,
      })),
    )
    .onConflictDoNothing()
  const customerRows = await db
    .select({ id: t.customers.id, phone: t.customers.phone, name: t.customers.name })
    .from(t.customers)
    .where(
      and(
        eq(t.customers.salonId, salonId),
        inArray(
          t.customers.phone,
          DEMO_CUSTOMERS.map((_, i) => demoPhone(i)),
        ),
      ),
    )
  const customers = DEMO_CUSTOMERS.map((_, i) => customerRows.find((c) => c.phone === demoPhone(i))!)

  // ---- A special-hours day inside the booking window and some staff time off
  const workingOn = (staffId: string, date: DateKey) =>
    schedules.find((s) => s.staffId === staffId && s.weekday === weekdayOf(date) && s.isWorking)
  const existingSpecials = await loadSpecialDays(db, salonId, addDays(today, -60), addDays(today, 90))
  let trainingDay = addDays(today, 9)
  while (weekdayOf(trainingDay) === 1 || existingSpecials.some((s) => s.date === trainingDay))
    trainingDay = addDays(trainingDay, 1)
  await db
    .insert(t.specialDays)
    .values({
      salonId,
      date: trainingDay,
      kind: 'special_hours',
      opensAt: 13 * 60,
      closesAt: 20 * 60,
      label: 'Мастеруудын сургалт — 13:00 цагаас нээнэ',
      isDemo: true,
    })
    .onConflictDoNothing()

  const timeOffPlan: {
    slug: string
    offset: number
    from?: number
    to?: number
    kind: 'vacation' | 'training' | 'sick'
    note: string
  }[] = [
    { slug: 'nomin', offset: 5, kind: 'vacation', note: 'Ээлжийн амралт' },
    { slug: 'khulan', offset: 3, from: 14 * 60 + 30, to: 19 * 60, kind: 'training', note: 'Аппарат педикюрын сургалт' },
    { slug: 'anu', offset: -12, kind: 'sick', note: 'Өвчтэй' },
  ]
  for (const plan of timeOffPlan) {
    const staff = staffBySlug.get(plan.slug)
    if (!staff) continue
    let date = addDays(today, plan.offset)
    for (let i = 0; i < 7 && !workingOn(staff.id, date); i++) date = addDays(date, plan.offset >= 0 ? 1 : -1)
    const start = plan.from !== undefined ? ubToUtc(date, plan.from) : dayBounds(date).start
    const end = plan.to !== undefined ? ubToUtc(date, plan.to) : dayBounds(date).end
    await db
      .insert(t.staffTimeOff)
      .values({ staffId: staff.id, startsAt: start, endsAt: end, kind: plan.kind, note: plan.note, isDemo: true })
  }

  const rangeFrom = addDays(today, -40)
  const rangeTo = addDays(today, 30)
  const specials = await loadSpecialDays(db, salonId, rangeFrom, rangeTo)
  const timeOff = await db
    .select()
    .from(t.staffTimeOff)
    .where(
      and(
        inArray(t.staffTimeOff.staffId, staffIds),
        gte(t.staffTimeOff.endsAt, dayBounds(rangeFrom).start),
        lte(t.staffTimeOff.startsAt, dayBounds(rangeTo).end),
      ),
    )

  // ---- Appointment generation
  const busy = new Map<string, { start: number; end: number }[]>()
  const gens: GenAppointment[] = []
  let refCounter = 1
  const nextRef = () => `SV-D${String(refCounter++).padStart(5, '0')}`
  const priceChangeAt = ubToUtc(addDays(today, -PRICE_CHANGE_DAYS_AGO), 10 * 60 + 12)
  const policy = depositPolicy(config.settings)

  const staffDay = (staffId: string, date: DateKey): StaffDay => {
    const weekday = weekdayOf(date)
    const shift = schedules.find((s) => s.staffId === staffId && s.weekday === weekday)
    const { start, end } = dayBounds(date)
    const inDay = (r: { start: number; end: number }) => r.start < end.getTime() && r.end > start.getTime()
    return {
      staffId,
      shift: shift?.isWorking ? { startsAt: shift.startsAt, endsAt: shift.endsAt } : null,
      breaks: breaks
        .filter((b) => b.staffId === staffId && (b.weekday === null || b.weekday === weekday))
        .map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt })),
      busy: (busy.get(staffId) ?? []).filter(inDay),
      timeOff: timeOff
        .filter((r) => r.staffId === staffId)
        .map((r) => ({ start: r.startsAt.getTime(), end: r.endsAt.getTime() }))
        .filter(inDay),
    }
  }

  const findSlot = (candidates: string[], date: DateKey, quote: Quote) => {
    const hours = salonHoursFor(date, config.weekly, specials)
    if (!hours) return null
    for (const staffId of rng.shuffle(candidates)) {
      const slots = computeDaySlots({
        date,
        now: new Date(0),
        hours,
        durationMinutes: quote.durationMinutes,
        bufferMinutes: quote.bufferMinutes,
        slotIntervalMinutes: 15,
        minAdvanceMinutes: 0,
        staff: [staffDay(staffId, date)],
      })
      if (slots.length) return { staffId, start: rng.pick(slots).start }
    }
    return null
  }

  const quoteFor = (
    combo: (typeof COMBOS)[number][0],
    startsAt: Date,
  ): { quote: Quote; serviceIds: string[] } | null => {
    const items: SelectionItem[] = []
    for (const slug of combo.services) {
      const svc = serviceBySlug.get(slug)
      if (!svc) return null
      items.push({
        serviceId: svc.id,
        addonIds: (combo.addons?.[slug] ?? []).map((a) => addonBySlug.get(a)).filter((a): a is string => Boolean(a)),
      })
    }
    const quote = buildQuote(items, catalog, {
      defaultBufferMinutes: config.settings.defaultBufferMinutes,
      deposit: policy,
    })
    if (startsAt < priceChangeAt) {
      // History: gel polish cost 60,000₮ before the price change.
      let delta = 0
      for (const line of quote.lines) {
        if (serviceBySlug.get('gel-polish')?.id === line.serviceId) {
          delta += line.price - OLD_GEL_PRICE
          line.price = OLD_GEL_PRICE
        }
      }
      quote.servicesTotal -= delta
      quote.total -= delta
    }
    return { quote, serviceIds: items.map((i) => i.serviceId) }
  }

  const eligibleFor = (serviceIds: string[]) =>
    staffList.filter((s) => serviceIds.every((id) => s.serviceIds.includes(id))).map((s) => s.id)
  const pickCustomer = () => rng.weighted(customers.map((_, i) => [i, i < 8 ? 5 : 1] as const))

  const addBusy = (g: GenAppointment) => {
    const list = busy.get(g.staffId) ?? []
    list.push({ start: g.startsAt.getTime(), end: g.occupiedUntil.getTime() })
    busy.set(g.staffId, list)
  }

  const createdBefore = (startsAt: Date, minLeadHours: number, maxLeadDays: number) => {
    const lead = Math.max(minLeadHours * HOUR, rng.int(minLeadHours, maxLeadDays * 24) * HOUR + rng.int(0, 59) * MINUTE)
    const at = new Date(startsAt.getTime() - lead)
    return at > now ? new Date(now.getTime() - rng.int(20, 600) * MINUTE) : at
  }

  for (let offset = -35; offset <= 20; offset++) {
    const date = addDays(today, offset)
    if (!salonHoursFor(date, config.weekly, specials)) continue
    const target =
      offset < -7
        ? rng.int(1, 2)
        : offset < 0
          ? rng.int(2, 3)
          : offset === 0
            ? rng.int(3, 5)
            : offset <= 7
              ? rng.int(2, 3)
              : rng.int(0, 1)
    for (let k = 0; k < target; k++) {
      const combo = rng.weighted(COMBOS)
      const probe = quoteFor(combo, ubToUtc(date, 12 * 60))
      if (!probe) continue
      const candidates = eligibleFor(probe.serviceIds).filter((id) => staffDay(id, date).shift)
      if (!candidates.length) continue
      const slot = findSlot(candidates, date, probe.quote)
      if (!slot) continue
      const startsAt = ubToUtc(date, slot.start)
      const { quote, serviceIds } = quoteFor(combo, startsAt)!
      const endsAt = new Date(startsAt.getTime() + quote.durationMinutes * MINUTE)
      const occupiedUntil = new Date(endsAt.getTime() + quote.bufferMinutes * MINUTE)
      const finished = endsAt <= now
      const inProgress = startsAt <= now && !finished
      let status: AppointmentStatus = finished
        ? rng.weighted([
            ['completed', 78],
            ['no_show', 5],
            ['cancelled', 8],
            ['rescheduled', 5],
            ['expired', 4],
          ] as const)
        : inProgress
          ? 'confirmed'
          : rng.weighted([
              ['confirmed', 48],
              ['pending', 34],
              ['cancelled', 9],
              ['rescheduled', 9],
            ] as const)
      let source: Source = rng.weighted([
        ['website', 50],
        ['assistant', 15],
        ['phone', 20],
        ['walk_in', finished ? 8 : 0],
        ['messenger', 7],
      ] as const)
      const online = source === 'website' || source === 'assistant' || source === 'messenger'
      if (status === 'pending' && !online) source = 'website'
      const deposit =
        (source === 'website' || source === 'assistant') && quote.total >= policy.minTotal ? quote.deposit : 0
      if (status === 'expired' && deposit === 0) status = 'completed'
      const createdAt =
        source === 'walk_in'
          ? new Date(startsAt.getTime() - 10 * MINUTE)
          : status === 'pending'
            ? createdBefore(new Date(Math.min(startsAt.getTime(), now.getTime())), 2, 3)
            : createdBefore(startsAt, 3, 12)
      const instantConfirm = source === 'phone' || source === 'walk_in'
      const confirmedAt =
        status === 'pending' || status === 'expired'
          ? null
          : deposit > 0
            ? new Date(createdAt.getTime() + 4 * MINUTE)
            : instantConfirm
              ? createdAt
              : new Date(
                  Math.min(
                    createdAt.getTime() + rng.int(15, 240) * MINUTE,
                    startsAt.getTime() - 30 * MINUTE,
                    now.getTime(),
                  ),
                )
      const g: GenAppointment = {
        id: randomUUID(),
        reference: nextRef(),
        staffId: slot.staffId,
        customerIdx: pickCustomer(),
        date,
        startsAt,
        endsAt,
        occupiedUntil,
        quote: { ...quote, deposit },
        serviceIds,
        status,
        source,
        createdAt,
        confirmedAt: confirmedAt && confirmedAt < createdAt ? createdAt : confirmedAt,
        cancelledAt: null,
        completedAt: status === 'completed' ? endsAt : null,
        deposit,
        staffRequested: rng.chance(0.7),
        customerNote: rng.chance(0.25) ? rng.pick(CUSTOMER_NOTES) : null,
        rescheduledFromId: null,
        rescheduledAt: null,
        replacementRef: null,
      }
      if (status === 'cancelled') {
        const latest = Math.min(startsAt.getTime() - 2 * HOUR, now.getTime())
        const earliest = createdAt.getTime() + HOUR
        g.cancelledAt = new Date(earliest >= latest ? latest : rng.int(earliest, latest))
        if (g.cancelledAt < createdAt) g.cancelledAt = new Date(createdAt.getTime() + 5 * MINUTE)
      }
      if (status === 'expired') g.confirmedAt = null
      gens.push(g)
      if (status === 'completed' || status === 'no_show' || status === 'confirmed' || status === 'pending') {
        addBusy(g)
        continue
      }
      if (status !== 'rescheduled') continue

      // The customer moved this appointment: find the new time 1–4 days later.
      const shiftDays = rng.int(1, 4)
      const newDate = addDays(date, shiftDays)
      const candidatesNew = eligibleFor(serviceIds).filter((id) => staffDay(id, newDate).shift)
      const moved = candidatesNew.length
        ? findSlot(candidatesNew.includes(slot.staffId) ? [slot.staffId] : candidatesNew, newDate, quote)
        : null
      if (!moved) {
        g.status = finished ? 'completed' : 'confirmed'
        g.completedAt = g.status === 'completed' ? endsAt : null
        g.confirmedAt ??= createdAt
        addBusy(g)
        continue
      }
      const newStart = ubToUtc(newDate, moved.start)
      const newEnd = new Date(newStart.getTime() + quote.durationMinutes * MINUTE)
      const rescheduledAt = new Date(
        Math.min(
          startsAt.getTime() - 6 * HOUR,
          now.getTime() - 30 * MINUTE,
          createdAt.getTime() + rng.int(6, 48) * HOUR,
        ),
      )
      g.rescheduledAt = rescheduledAt < createdAt ? new Date(createdAt.getTime() + 10 * MINUTE) : rescheduledAt
      g.confirmedAt ??= g.createdAt
      const replacement: GenAppointment = {
        ...g,
        id: randomUUID(),
        reference: nextRef(),
        staffId: moved.staffId,
        date: newDate,
        startsAt: newStart,
        endsAt: newEnd,
        occupiedUntil: new Date(newEnd.getTime() + quote.bufferMinutes * MINUTE),
        status: newEnd <= now ? 'completed' : 'confirmed',
        createdAt: g.rescheduledAt,
        confirmedAt: g.rescheduledAt,
        completedAt: newEnd <= now ? newEnd : null,
        rescheduledFromId: g.id,
        rescheduledAt: null,
        replacementRef: null,
      }
      g.replacementRef = replacement.reference
      gens.push(replacement)
      addBusy(replacement)
    }
  }

  // Keep a realistic queue of recent online requests waiting for approval.
  const isOnline = (g: GenAppointment) => g.source === 'website' || g.source === 'assistant' || g.source === 'messenger'
  for (const g of gens) {
    if (gens.filter((x) => x.status === 'pending').length >= 7) break
    if (g.status !== 'confirmed' || g.startsAt <= now || g.deposit > 0 || g.rescheduledFromId || !isOnline(g)) continue
    g.status = 'pending'
    g.confirmedAt = null
    g.createdAt = new Date(now.getTime() - rng.int(1, 40) * HOUR)
  }

  // A salon decline on record.
  const declinable = gens.find((g) => g.status === 'pending' && g.startsAt > now)
  if (declinable) {
    declinable.status = 'rejected'
    declinable.cancelledAt = new Date(Math.min(declinable.createdAt.getTime() + 2 * HOUR, now.getTime()))
    const list = busy.get(declinable.staffId) ?? []
    busy.set(
      declinable.staffId,
      list.filter((b) => b.start !== declinable.startsAt.getTime()),
    )
  }

  // Every status appears in the demo regardless of the random draws above.
  const dropBusy = (g: GenAppointment) =>
    busy.set(
      g.staffId,
      (busy.get(g.staffId) ?? []).filter((b) => b.start !== g.startsAt.getTime()),
    )
  // Deposit holds that were never paid, so the slot was released.
  const lapsable = [
    ...gens.filter((g) => g.status === 'confirmed' && g.startsAt > now),
    ...gens.filter((g) => g.status === 'completed'),
  ].filter((g) => g.deposit > 0 && !g.rescheduledFromId && !g.replacementRef)
  for (const g of lapsable.slice(0, Math.max(0, 2 - gens.filter((x) => x.status === 'expired').length))) {
    g.status = 'expired'
    g.confirmedAt = null
    g.completedAt = null
    dropBusy(g)
  }
  // One deposit hold still open at seeding time. Like a real one it lapses after
  // the hold time (the next booking or the maintenance job expires it).
  if (!gens.some((g) => g.status === 'awaiting_deposit')) {
    const combo = { services: ['nail-extensions'] }
    for (let offset = 3; offset <= 10; offset++) {
      const date = addDays(today, offset)
      const probe = quoteFor(combo, ubToUtc(date, 12 * 60))
      if (!probe || probe.quote.deposit === 0) break
      const candidates = eligibleFor(probe.serviceIds).filter((id) => staffDay(id, date).shift)
      const slot = candidates.length ? findSlot(candidates, date, probe.quote) : null
      if (!slot) continue
      const startsAt = ubToUtc(date, slot.start)
      const { quote, serviceIds } = quoteFor(combo, startsAt)!
      const endsAt = new Date(startsAt.getTime() + quote.durationMinutes * MINUTE)
      const hold: GenAppointment = {
        id: randomUUID(),
        reference: nextRef(),
        staffId: slot.staffId,
        customerIdx: pickCustomer(),
        date,
        startsAt,
        endsAt,
        occupiedUntil: new Date(endsAt.getTime() + quote.bufferMinutes * MINUTE),
        quote,
        serviceIds,
        status: 'awaiting_deposit',
        source: 'website',
        createdAt: new Date(now.getTime() - 3 * MINUTE),
        confirmedAt: null,
        cancelledAt: null,
        completedAt: null,
        deposit: quote.deposit,
        staffRequested: false,
        customerNote: null,
        rescheduledFromId: null,
        rescheduledAt: null,
        replacementRef: null,
      }
      gens.push(hold)
      addBusy(hold)
      break
    }
  }

  // ---- Rows
  const appointmentRows: (typeof t.appointments.$inferInsert)[] = []
  const lineRows: (typeof t.appointmentServices.$inferInsert)[] = []
  const addonLineRows: (typeof t.appointmentAddons.$inferInsert)[] = []
  const eventRows: (typeof t.appointmentEvents.$inferInsert)[] = []
  const paymentRows: (typeof t.payments.$inferInsert)[] = []
  const recordRows: (typeof t.paymentRecords.$inferInsert)[] = []
  const cancellationRows: (typeof t.cancellationRecords.$inferInsert)[] = []
  const notificationRows: (typeof t.notifications.$inferInsert)[] = []
  const staffName = new Map(staffList.map((s) => [s.id, s.displayName]))

  for (const g of gens) {
    const customer = customers[g.customerIdx]
    appointmentRows.push({
      id: g.id,
      salonId,
      reference: g.reference,
      customerId: customer.id,
      staffId: g.staffId,
      status: g.status,
      source: g.source,
      startsAt: g.startsAt,
      endsAt: g.endsAt,
      occupiedUntil: g.occupiedUntil,
      bufferMinutes: g.quote.bufferMinutes,
      durationMinutes: g.quote.durationMinutes,
      servicesTotal: g.quote.servicesTotal,
      addonsTotal: g.quote.addonsTotal,
      totalPrice: g.quote.total,
      hasFromPrice: g.quote.hasFromPrice,
      depositAmount: g.deposit,
      staffRequested: g.staffRequested,
      customerNote: g.customerNote,
      holdExpiresAt:
        g.status === 'awaiting_deposit' || g.status === 'expired'
          ? new Date(g.createdAt.getTime() + config.settings.holdMinutes * MINUTE)
          : null,
      confirmedAt: g.confirmedAt,
      cancelledAt: g.cancelledAt,
      completedAt: g.completedAt,
      rescheduledFromId: g.rescheduledFromId,
      manageTokenHash: sha256Hex(randomToken(16)),
      isDemo: true,
      createdAt: g.createdAt,
      updatedAt: g.completedAt ?? g.cancelledAt ?? g.rescheduledAt ?? g.confirmedAt ?? g.createdAt,
    })
    for (const [i, line] of g.quote.lines.entries()) {
      const lineId = randomUUID()
      lineRows.push({
        id: lineId,
        appointmentId: g.id,
        serviceId: line.serviceId,
        serviceName: line.name,
        categoryName: line.categoryName,
        durationMinutes: line.durationMinutes,
        price: line.price,
        priceType: line.priceType,
        sortOrder: i,
      })
      for (const a of line.addons) {
        addonLineRows.push({
          appointmentId: g.id,
          appointmentServiceId: lineId,
          addonId: a.addonId,
          addonName: a.name,
          durationMinutes: a.durationMinutes,
          price: a.price,
          priceType: a.priceType,
        })
      }
    }

    const services = g.quote.lines.map((l) => l.name).join(', ')
    const actorType =
      g.source === 'phone' || g.source === 'walk_in' || g.source === 'admin'
        ? 'staff'
        : g.source === 'assistant'
          ? 'assistant'
          : 'customer'
    const initialStatus: AppointmentStatus =
      g.deposit > 0
        ? 'awaiting_deposit'
        : g.confirmedAt && g.confirmedAt.getTime() === g.createdAt.getTime()
          ? 'confirmed'
          : 'pending'
    eventRows.push({
      appointmentId: g.id,
      kind: 'created',
      toStatus: initialStatus,
      actorType,
      actorAdminId: actorType === 'staff' ? (owner?.id ?? null) : null,
      note: g.rescheduledFromId
        ? `Өмнөх захиалгын цагийг өөрчилж үүсгэв · ${formatDateTime(g.startsAt)}`
        : `${services} · ${formatDateTime(g.startsAt)}`,
      meta: { source: g.source, total: g.quote.total, deposit: g.deposit },
      createdAt: g.createdAt,
    })
    const notify = (kind: string, at: Date, audience: 'customer' | 'staff', body: string, variant = '') =>
      notificationRows.push({
        salonId,
        appointmentId: g.id,
        kind,
        channel: audience === 'staff' ? 'telegram' : 'sms',
        audience,
        recipient: audience === 'staff' ? 'Ажилтны Telegram групп' : maskPhone(customer.phone),
        subject: kind,
        body,
        status: 'logged',
        error: 'Демо горим: гадагш илгээгээгүй, зөвхөн бүртгэлд хадгалсан.',
        dedupeKey: `${g.id}:${kind}:${audience}:${variant}`,
        isDemo: true,
        createdAt: at,
      })
    const when = formatDateTime(g.startsAt)
    notify(
      'booking_created',
      g.createdAt,
      'customer',
      `Сувд: Таны ${when}-ийн захиалга (${g.reference}) бүртгэгдлээ. Төлөв: ${STATUS_LABELS[initialStatus]}.`,
    )
    notify(
      'staff_new_booking',
      g.createdAt,
      'staff',
      `Шинэ захиалга ${g.reference}: ${customer.name}, ${services}, ${when}, мастер ${staffName.get(g.staffId)}.`,
    )

    if (g.deposit > 0) {
      const paymentId = randomUUID()
      const open = g.status === 'awaiting_deposit'
      const paid = g.status !== 'expired' && !open
      const refunded =
        g.status === 'cancelled' &&
        g.cancelledAt &&
        (g.startsAt.getTime() - g.cancelledAt.getTime()) / HOUR >= config.settings.cancellationNoticeHours
      paymentRows.push({
        id: paymentId,
        salonId,
        appointmentId: g.id,
        kind: 'deposit',
        method: 'qpay',
        status: open ? 'pending' : !paid ? 'expired' : refunded ? 'refunded' : 'paid',
        amount: g.deposit,
        provider: 'simulated',
        providerInvoiceId: `SIM-DEMO-${g.reference}`,
        providerPaymentId: paid ? `SIMPAY-${g.reference}` : null,
        expiresAt: new Date(g.createdAt.getTime() + config.settings.holdMinutes * MINUTE),
        paidAt: paid ? new Date(g.createdAt.getTime() + 4 * MINUTE) : null,
        verifiedBy: paid ? 'provider_check' : null,
        isDemo: true,
        createdAt: g.createdAt,
      })
      recordRows.push({ paymentId, event: 'invoice_created', detail: { mode: 'mock' }, createdAt: g.createdAt })
      if (paid) {
        recordRows.push({
          paymentId,
          event: 'check_paid',
          detail: { source: 'callback', mode: 'mock' },
          createdAt: new Date(g.createdAt.getTime() + 4 * MINUTE),
        })
        eventRows.push({
          appointmentId: g.id,
          kind: 'deposit_paid',
          fromStatus: 'awaiting_deposit',
          toStatus: 'confirmed',
          actorType: 'system',
          note: `Урьдчилгаа ${g.deposit.toLocaleString('en-US')}₮ төлбөрийн системээр баталгаажсан (туршилтын).`,
          createdAt: new Date(g.createdAt.getTime() + 4 * MINUTE),
        })
        notify(
          'deposit_paid',
          new Date(g.createdAt.getTime() + 4 * MINUTE),
          'customer',
          `Сувд: ${g.deposit.toLocaleString('en-US')}₮ урьдчилгаа баталгаажлаа. ${g.reference} баталгаажсан.`,
        )
      } else if (!open) {
        eventRows.push({
          appointmentId: g.id,
          kind: 'hold_expired',
          fromStatus: 'awaiting_deposit',
          toStatus: 'expired',
          actorType: 'system',
          note: 'Урьдчилгаа хугацаандаа төлөгдөөгүй тул цаг чөлөөлөгдсөн.',
          createdAt: new Date(g.createdAt.getTime() + config.settings.holdMinutes * MINUTE),
        })
      }
      if (refunded)
        recordRows.push({
          paymentId,
          event: 'refunded',
          detail: { note: 'Цуцлалтын бодлогын дагуу' },
          createdAt: g.cancelledAt!,
        })
    } else if (g.confirmedAt && initialStatus === 'pending') {
      eventRows.push({
        appointmentId: g.id,
        kind: 'confirmed',
        fromStatus: 'pending',
        toStatus: 'confirmed',
        actorType: 'staff',
        actorAdminId: owner?.id ?? null,
        createdAt: g.confirmedAt,
      })
    }
    if (g.confirmedAt && g.status !== 'expired') {
      notify(
        'booking_confirmed',
        g.confirmedAt,
        'customer',
        `Сувд: ${when}-д ${staffName.get(g.staffId)} мастерт захиалсан цаг тань баталгаажлаа (${g.reference}).`,
      )
    }
    if (
      g.startsAt.getTime() - config.settings.reminderHoursBefore * HOUR < now.getTime() &&
      (g.status === 'completed' || g.status === 'no_show' || g.status === 'confirmed')
    ) {
      notify(
        'reminder',
        new Date(Math.max(g.startsAt.getTime() - config.settings.reminderHoursBefore * HOUR, g.createdAt.getTime())),
        'customer',
        `Сувд: ${when}-д ${staffName.get(g.staffId)} мастер таныг хүлээж байна.`,
      )
    }

    if (g.status === 'completed') {
      eventRows.push({
        appointmentId: g.id,
        kind: 'completed',
        fromStatus: 'confirmed',
        toStatus: 'completed',
        actorType: 'staff',
        actorAdminId: owner?.id ?? null,
        createdAt: g.endsAt,
      })
      const balance = g.quote.total - g.deposit
      if (balance > 0) {
        const paymentId = randomUUID()
        const method = rng.weighted([
          ['card', 45],
          ['cash', 25],
          ['qpay', 30],
        ] as const)
        paymentRows.push({
          id: paymentId,
          salonId,
          appointmentId: g.id,
          kind: g.deposit > 0 ? 'balance' : 'full',
          method,
          status: 'paid',
          amount: balance,
          provider: 'manual',
          paidAt: g.endsAt,
          verifiedBy: 'staff_record',
          recordedByAdminId: owner?.id ?? null,
          isDemo: true,
          createdAt: g.endsAt,
        })
        recordRows.push({
          paymentId,
          event: 'staff_recorded',
          detail: { method, amount: balance },
          createdAt: g.endsAt,
        })
      }
    }
    if (g.status === 'no_show') {
      eventRows.push({
        appointmentId: g.id,
        kind: 'no_show',
        fromStatus: 'confirmed',
        toStatus: 'no_show',
        actorType: 'staff',
        actorAdminId: owner?.id ?? null,
        note: g.deposit > 0 ? 'Урьдчилгаа буцаагдахгүй (бодлогын дагуу).' : null,
        createdAt: new Date(g.startsAt.getTime() + 25 * MINUTE),
      })
    }
    if (g.status === 'cancelled' || g.status === 'rejected') {
      const noticeHours = Math.floor((g.startsAt.getTime() - g.cancelledAt!.getTime()) / HOUR)
      const byCustomer = g.status === 'cancelled' && rng.chance(0.85)
      const withinPolicy = !byCustomer || noticeHours >= config.settings.cancellationNoticeHours
      cancellationRows.push({
        appointmentId: g.id,
        cancelledBy: byCustomer ? 'customer' : 'staff',
        actorAdminId: byCustomer ? null : (owner?.id ?? null),
        reasonCode: g.status === 'rejected' ? 'rejected' : byCustomer ? 'customer_request' : 'staff_unavailable',
        reasonText:
          g.status === 'rejected'
            ? 'Тухайн цагт мастер өөр захиалгатай давхцсан.'
            : byCustomer
              ? rng.pick(CANCEL_TEXTS)
              : 'Мастер өвчтэй болсон.',
        noticeHours,
        withinPolicy,
        depositOutcome: g.deposit > 0 ? (withinPolicy ? 'refund' : 'forfeit') : 'none',
        createdAt: g.cancelledAt!,
      })
      eventRows.push({
        appointmentId: g.id,
        kind: g.status,
        fromStatus: g.confirmedAt ? 'confirmed' : 'pending',
        toStatus: g.status,
        actorType: byCustomer ? 'customer' : 'staff',
        actorAdminId: byCustomer ? null : (owner?.id ?? null),
        createdAt: g.cancelledAt!,
      })
      notify(
        g.status === 'rejected' ? 'booking_rejected' : 'booking_cancelled',
        g.cancelledAt!,
        'customer',
        g.status === 'rejected'
          ? `Сувд: Уучлаарай, ${when}-ийн хүсэлтийг (${g.reference}) баталгаажуулах боломжгүй боллоо.`
          : `Сувд: ${when}-ийн захиалга (${g.reference}) цуцлагдлаа.`,
      )
    }
    if (g.status === 'rescheduled' && g.rescheduledAt) {
      eventRows.push({
        appointmentId: g.id,
        kind: 'rescheduled',
        fromStatus: 'confirmed',
        toStatus: 'rescheduled',
        actorType: 'customer',
        note: `Шинэ захиалга: ${g.replacementRef}`,
        meta: { newReference: g.replacementRef },
        createdAt: g.rescheduledAt,
      })
    }
  }

  await db.transaction(async (tx) => {
    for (const rows of chunk(appointmentRows.filter((a) => !a.rescheduledFromId)))
      await tx.insert(t.appointments).values(rows)
    for (const rows of chunk(appointmentRows.filter((a) => a.rescheduledFromId)))
      await tx.insert(t.appointments).values(rows)
    for (const rows of chunk(lineRows)) await tx.insert(t.appointmentServices).values(rows)
    for (const rows of chunk(addonLineRows)) await tx.insert(t.appointmentAddons).values(rows)
    for (const rows of chunk(eventRows)) await tx.insert(t.appointmentEvents).values(rows)
    for (const rows of chunk(paymentRows)) await tx.insert(t.payments).values(rows)
    for (const rows of chunk(recordRows)) await tx.insert(t.paymentRecords).values(rows)
    for (const rows of chunk(cancellationRows)) await tx.insert(t.cancellationRecords).values(rows)
    for (const rows of chunk(notificationRows)) await tx.insert(t.notifications).values(rows).onConflictDoNothing()
  })

  // Customers "joined" at their first booking.
  await db.execute(sql`
    update salon.customers c set created_at = sub.first
    from (select customer_id, min(created_at) as first from salon.appointments where salon_id = ${salonId} and is_demo group by customer_id) sub
    where c.id = sub.customer_id and c.is_demo
  `)

  // ---- Assistant conversations and audit history
  for (const [i, chat] of DEMO_CHATS.entries()) {
    const startedAt = new Date(now.getTime() - (i + 1) * 26 * HOUR)
    const [session] = await db
      .insert(t.chatSessions)
      .values({
        salonId,
        channel: chat.channel,
        visitorHash: sha256Hex(`demo-chat-${i}`),
        messageCount: chat.messages.length,
        handedOff: i === 2,
        isDemo: true,
        createdAt: startedAt,
        lastMessageAt: new Date(startedAt.getTime() + chat.messages.length * MINUTE),
      })
      .returning({ id: t.chatSessions.id })
    await db.insert(t.chatMessages).values(
      chat.messages.map((m, j) => ({
        sessionId: session.id,
        role: m.role,
        content: m.content,
        createdAt: new Date(startedAt.getTime() + j * MINUTE),
      })),
    )
  }
  const gel = serviceBySlug.get('gel-polish')
  await db.insert(t.auditLog).values([
    {
      salonId,
      adminUserId: owner?.id ?? null,
      action: 'service.price',
      entity: 'service',
      entityId: gel?.id ?? null,
      summary: `Гель будалтын үнийг ${OLD_GEL_PRICE.toLocaleString('en-US')}₮ → ${(gel?.price ?? 65_000).toLocaleString('en-US')}₮ болгосон. Өмнөх захиалгууд хуучин үнээрээ хадгалагдсан.`,
      detail: { before: OLD_GEL_PRICE, after: gel?.price ?? 65_000, demo: true },
      createdAt: priceChangeAt,
    },
    {
      salonId,
      adminUserId: owner?.id ?? null,
      action: 'settings.deposit',
      entity: 'settings',
      summary: 'Урьдчилгааны бодлого: 100,000₮-өөс дээш захиалгад 20,000₮.',
      detail: { demo: true },
      createdAt: ubToUtc(addDays(today, -30), 9 * 60 + 40),
    },
    {
      salonId,
      adminUserId: owner?.id ?? null,
      action: 'staff.schedule',
      entity: 'staff',
      entityId: staffBySlug.get('anu')?.id ?? null,
      summary: 'Ану мастерын амралтын өдрийг Даваа, Мягмар болгож хуваарь шинэчилсэн.',
      detail: { demo: true },
      createdAt: ubToUtc(addDays(today, -8), 18 * 60 + 5),
    },
  ])

  const counts = gens.reduce<Record<string, number>>((acc, g) => ({ ...acc, [g.status]: (acc[g.status] ?? 0) + 1 }), {})
  return `Demo data: ${customers.length} customers, ${gens.length} appointments (${Object.entries(counts)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')}), ${paymentRows.length} payments, ${notificationRows.length} notifications.`
}

/** Removes demo rows only (is_demo = true) for one salon. Real data is never touched. */
export async function deleteDemoData(db: Database, salonId: string) {
  await db.transaction(async (tx) => {
    const demoAppointments = tx
      .select({ id: t.appointments.id })
      .from(t.appointments)
      .where(and(eq(t.appointments.salonId, salonId), eq(t.appointments.isDemo, true)))
    await tx.delete(t.notifications).where(and(eq(t.notifications.salonId, salonId), eq(t.notifications.isDemo, true)))
    await tx.delete(t.payments).where(and(eq(t.payments.salonId, salonId), eq(t.payments.isDemo, true)))
    await tx
      .update(t.chatSessions)
      .set({ appointmentId: null })
      .where(inArray(t.chatSessions.appointmentId, demoAppointments))
    // Replacements reference originals; clear the link before deleting.
    await tx
      .update(t.appointments)
      .set({ rescheduledFromId: null })
      .where(and(eq(t.appointments.salonId, salonId), eq(t.appointments.isDemo, true)))
    await tx.delete(t.appointments).where(and(eq(t.appointments.salonId, salonId), eq(t.appointments.isDemo, true)))
    await tx.delete(t.customers).where(and(eq(t.customers.salonId, salonId), eq(t.customers.isDemo, true)))
    await tx.delete(t.chatSessions).where(and(eq(t.chatSessions.salonId, salonId), eq(t.chatSessions.isDemo, true)))
    await tx.delete(t.specialDays).where(and(eq(t.specialDays.salonId, salonId), eq(t.specialDays.isDemo, true)))
    const staffIds = tx.select({ id: t.staff.id }).from(t.staff).where(eq(t.staff.salonId, salonId))
    await tx
      .delete(t.staffTimeOff)
      .where(and(inArray(t.staffTimeOff.staffId, staffIds), eq(t.staffTimeOff.isDemo, true)))
    await tx
      .delete(t.auditLog)
      .where(and(eq(t.auditLog.salonId, salonId), sql`${t.auditLog.detail} ->> 'demo' = 'true'`))
    await tx.delete(t.adminSessions).where(eq(t.adminSessions.isDemo, true))
  })
}
