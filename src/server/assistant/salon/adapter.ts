// Сувд's implementation of the SalonPort over the existing application services: the same
// availability engine as the booking page, createBooking() (day lock, re-validation, Postgres
// no-overlap constraint), and the customer cancel/reschedule rules of «Миний захиалга».
// With `simulate` (the admin «Try it» chat) every write runs and is then rolled back.
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import { preliminaryDayState, salonHoursFor, type SpecialDay } from '@/lib/availability/engine'
import { STATUS_EXPLANATIONS, STATUS_LABELS, type AppointmentStatus } from '@/lib/booking/status'
import { addDays, dateKeyOf, minutesOfDay, monthOf, addMonths, firstOfMonth, type DateKey } from '@/lib/datetime'
import { normalizePhone } from '@/lib/phone'
import { parallel, type Database } from '@/server/db/client'
import * as t from '@/server/db/schema'
import type { ServiceContext } from '@/server/context'
import { enforceRateLimit, LIMITS } from '@/server/security/rate-limit'
import { dayAvailability, monthAvailability, prepareSelection } from '@/server/services/availability'
import { createBooking, rescheduleAppointment, transitionAppointment } from '@/server/services/booking'
import {
  assertCustomerCancellable,
  customerRescheduleSelection,
  loadSalonAppointment,
} from '@/server/services/customer-changes'
import { loadSalonConfig, loadSpecialDays } from '@/server/services/salon'
import { compileVocabulary } from '../engine/vocab'
import type { BookingView, ChangeOutcome, GenericTerm, PortSalon, SalonPort, Snapshot } from './port'
import { ANY_STAFF_PHRASES, GENERIC_TERMS, OUTSIDE_PHRASES, serviceVocabulary } from './vocabulary'

class DryRun extends Error {
  constructor(public readonly value: unknown) {
    super('dry-run')
  }
}

/** Runs a write and rolls it back, returning what it would have produced. */
async function rolledBack<T>(db: Database, fn: (tx: Database) => Promise<T>): Promise<T> {
  try {
    await db.transaction(async (tx) => {
      throw new DryRun(await fn(tx))
    })
  } catch (err) {
    if (err instanceof DryRun) return err.value as T
    throw err
  }
  throw new Error('unreachable')
}

export interface PortOptions {
  simulate: boolean
  demoVisitorHash: string | null
  source: 'assistant' | 'messenger'
}

export function createSalonPort(ctx: ServiceContext, opts: PortOptions): SalonPort {
  const { db, salonId, now } = ctx
  let cached: Promise<Snapshot> | null = null
  const items = (serviceIds: string[]) => serviceIds.map((serviceId) => ({ serviceId, addonIds: [] as string[] }))
  const write = <T>(fn: (c: ServiceContext) => Promise<T>) =>
    opts.simulate ? rolledBack(db, (tx) => fn({ ...ctx, db: tx })) : fn(ctx)

  async function loadSnapshot(): Promise<Snapshot> {
    const config = await loadSalonConfig(db, salonId)
    const s = config.settings
    const today = dateKeyOf(now)
    const [specials, categories, services, staff, links, schedules, knowledge] = await parallel(db, [
      () => loadSpecialDays(db, salonId, today, addDays(today, s.maxAdvanceDays + 1)),
      () =>
        db
          .select()
          .from(t.serviceCategories)
          .where(and(eq(t.serviceCategories.salonId, salonId), eq(t.serviceCategories.isActive, true)))
          .orderBy(asc(t.serviceCategories.sortOrder)),
      () =>
        db
          .select()
          .from(t.services)
          .where(and(eq(t.services.salonId, salonId), eq(t.services.isActive, true)))
          .orderBy(asc(t.services.sortOrder)),
      () =>
        db
          .select()
          .from(t.staff)
          .where(and(eq(t.staff.salonId, salonId), eq(t.staff.isActive, true), eq(t.staff.acceptsOnlineBookings, true)))
          .orderBy(asc(t.staff.sortOrder)),
      () =>
        db
          .select({ staffId: t.staffServices.staffId, serviceId: t.staffServices.serviceId })
          .from(t.staffServices)
          .innerJoin(t.staff, eq(t.staff.id, t.staffServices.staffId))
          .where(eq(t.staff.salonId, salonId)),
      () =>
        db
          .select({ staffId: t.staffSchedules.staffId, weekday: t.staffSchedules.weekday })
          .from(t.staffSchedules)
          .innerJoin(t.staff, eq(t.staff.id, t.staffSchedules.staffId))
          .where(and(eq(t.staff.salonId, salonId), eq(t.staffSchedules.isWorking, true))),
      () =>
        db
          .select()
          .from(t.assistantKnowledge)
          .where(
            and(
              eq(t.assistantKnowledge.salonId, salonId),
              eq(t.assistantKnowledge.isActive, true),
              isNotNull(t.assistantKnowledge.verifiedAt),
            ),
          )
          .orderBy(asc(t.assistantKnowledge.sortOrder)),
    ])
    const categoryById = new Map(categories.map((c) => [c.id, c]))
    const staffIds = new Set(staff.map((x) => x.id))
    const live = services.filter((x) => categoryById.has(x.categoryId))
    const portServices = live.map((x) => ({
      id: x.id,
      slug: x.slug,
      name: x.name,
      categoryId: x.categoryId,
      categoryName: categoryById.get(x.categoryId)!.name,
      price: x.price,
      priceType: x.priceType,
      durationMinutes: x.durationMinutes,
      description: x.shortDescription || x.description,
      onlineBookable: x.onlineBookable,
      staffIds: links.filter((l) => l.serviceId === x.id && staffIds.has(l.staffId)).map((l) => l.staffId),
    }))
    const bySlug = new Map(portServices.map((x) => [x.slug, x.id]))
    const generics = new Map<string, GenericTerm>()
    for (const g of GENERIC_TERMS) {
      const candidates = g.slugs.map((slug) => bySlug.get(slug)).filter((id): id is string => Boolean(id))
      if (!candidates.length) continue
      generics.set(g.key, {
        label: g.label,
        candidates,
        canonical: g.canonical ? (bySlug.get(g.canonical) ?? null) : null,
      })
    }
    const vocabulary = compileVocabulary([
      ...serviceVocabulary(portServices),
      ...GENERIC_TERMS.filter((g) => generics.has(g.key)).map((g) => ({ id: g.key, kind: 'generic', phrases: g.phrases })),
      ...staff.map((x) => ({ id: x.id, kind: 'staff', phrases: [x.displayName] })),
      { id: 'any', kind: 'any_staff', phrases: ANY_STAFF_PHRASES },
      ...OUTSIDE_PHRASES.map((p) => ({ id: p, kind: 'outside', phrases: [p] })),
    ])
    const specialDays: SpecialDay[] = specials
    const salon: PortSalon = {
      name: config.salon.name,
      isDemo: config.salon.isDemo,
      phone: s.phone,
      email: s.email,
      address: s.addressLine,
      addressNote: s.addressNote,
      weekly: config.weekly,
      specials: specials.map((d) => ({
        date: d.date,
        label: d.label,
        closed: d.kind === 'closed',
        opensAt: d.opensAt,
        closesAt: d.closesAt,
      })),
      minAdvanceMinutes: s.minAdvanceMinutes,
      maxAdvanceDays: s.maxAdvanceDays,
      cancellationNoticeHours: s.cancellationNoticeHours,
      rescheduleNoticeHours: s.rescheduleNoticeHours,
      lateArrivalMinutes: s.lateArrivalMinutes,
      holdMinutes: s.holdMinutes,
      confirmationMode: s.confirmationMode,
      cancellationPolicy: s.cancellationPolicy,
      depositPolicy: s.depositPolicy,
      maxServicesPerBooking: s.maxServicesPerBooking,
    }
    return {
      salon,
      services: portServices,
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        serviceIds: portServices.filter((x) => x.categoryId === c.id).map((x) => x.id),
      })),
      staff: staff.map((x) => ({
        id: x.id,
        name: x.displayName,
        title: x.title,
        experienceYears: x.experienceYears || null,
        specialties: x.specialties,
        serviceIds: links.filter((l) => l.staffId === x.id).map((l) => l.serviceId),
        workdays: [...new Set(schedules.filter((r) => r.staffId === x.id).map((r) => r.weekday))].sort(),
      })),
      knowledge: knowledge.map((k) => ({
        id: k.id,
        topic: k.topic,
        question: k.question,
        answer: k.answer,
        keywords: k.keywords
          .split(',')
          .map((w) => w.trim())
          .filter(Boolean),
      })),
      vocabulary,
      generics,
      hoursFor: (date) => {
        const h = salonHoursFor(date, config.weekly, specialDays)
        return h ? { opensAt: h.startsAt, closesAt: h.endsAt } : null
      },
    }
  }

  async function view(id: string): Promise<BookingView | null> {
    const [row] = await db
      .select({ a: t.appointments, staffName: t.staff.displayName })
      .from(t.appointments)
      .innerJoin(t.staff, eq(t.staff.id, t.appointments.staffId))
      .where(and(eq(t.appointments.id, id), eq(t.appointments.salonId, salonId)))
    if (!row) return null
    const [lines, paid] = await parallel(db, [
      () =>
        db
          .select({ name: t.appointmentServices.serviceName })
          .from(t.appointmentServices)
          .where(eq(t.appointmentServices.appointmentId, id))
          .orderBy(asc(t.appointmentServices.sortOrder)),
      () =>
        db.$count(
          t.payments,
          and(eq(t.payments.appointmentId, id), eq(t.payments.kind, 'deposit'), eq(t.payments.status, 'paid')),
        ),
    ])
    const a = row.a
    return {
      id: a.id,
      reference: a.reference,
      status: a.status,
      statusLabel: STATUS_LABELS[a.status],
      date: dateKeyOf(a.startsAt),
      start: minutesOfDay(a.startsAt),
      durationMinutes: a.durationMinutes,
      startsAt: a.startsAt,
      services: lines.map((l) => l.name),
      staffId: a.staffId,
      staffName: row.staffName,
      total: a.totalPrice,
      hasFromPrice: a.hasFromPrice,
      depositAmount: a.depositAmount,
      depositPaid: paid > 0,
    }
  }

  const port: SalonPort = {
    snapshot: () => (cached ??= loadSnapshot()),

    async quote(serviceIds, staffId) {
      const prepared = await prepareSelection(db, salonId, items(serviceIds), staffId, { publicOnly: true })
      const q = prepared.quote
      return {
        total: q.total,
        hasFromPrice: q.hasFromPrice,
        deposit: q.deposit,
        durationMinutes: q.durationMinutes,
        lines: q.lines.map((l) => ({
          name: l.name,
          price: l.price,
          from: l.priceType === 'from',
          durationMinutes: l.durationMinutes,
        })),
        candidates: prepared.candidates.map((c) => ({ id: c.id, name: c.displayName })),
      }
    },

    async day(serviceIds, staffId, date, excludeAppointmentId) {
      const prepared = await prepareSelection(db, salonId, items(serviceIds), staffId, { publicOnly: true })
      const day = await dayAvailability(db, prepared, date, { now, publicRules: true, excludeAppointmentId })
      const pre = preliminaryDayState(date, now, prepared.config.settings.maxAdvanceDays, day.hours)
      return {
        date,
        hours: day.hours ? { opensAt: day.hours.startsAt, closesAt: day.hours.endsAt } : null,
        special: day.special?.label ?? null,
        state: pre === 'closed' ? 'closed' : pre === 'past' ? 'past' : pre === 'beyond' ? 'beyond' : 'open',
        slots: day.slots.map((x) => ({ start: x.start, staffIds: x.staffIds })),
      }
    },

    async openDays(serviceIds, staffId, from, limit, excludeAppointmentId) {
      const prepared = await prepareSelection(db, salonId, items(serviceIds), staffId, { publicOnly: true })
      const out: { date: DateKey; slotCount: number }[] = []
      let month = monthOf(from)
      const last = addDays(dateKeyOf(now), prepared.config.settings.maxAdvanceDays)
      for (let i = 0; i < 3 && out.length < limit && `${month}-01` <= last; i++) {
        const days = await monthAvailability(db, prepared, month, { now, excludeAppointmentId })
        for (const d of days) if (d.state === 'available' && d.date >= from && out.length < limit) out.push(d)
        month = monthOf(addMonths(firstOfMonth(`${month}-01`), 1))
      }
      return out.map((d) => ({ date: d.date, slotCount: d.slotCount }))
    },

    async book(req) {
      const phone = normalizePhone(req.phone)
      if (!phone) throw new Error('invalid phone')
      if (!opts.simulate) await enforceRateLimit(db, LIMITS.booking, ctx.ipHash)
      const snapshot = await port.snapshot()
      const result = await write((c) =>
        createBooking(
          c,
          {
            items: items(req.serviceIds),
            staffId: req.staffId,
            date: req.date,
            start: req.start,
            customer: { name: req.name, phone, email: null, note: null, preferences: null },
          },
          {
            source: opts.source,
            actor: 'assistant',
            publicRules: true,
            isDemo: snapshot.salon.isDemo,
            demoVisitorHash: opts.demoVisitorHash,
            preventCustomerOverlap: true,
            deliver: !opts.simulate,
          },
        ),
      )
      const status = result.status as AppointmentStatus
      return {
        appointmentId: result.appointmentId,
        reference: result.reference,
        status,
        statusLabel: STATUS_LABELS[status],
        explanation: STATUS_EXPLANATIONS[status],
        staffName: result.staffName,
        date: req.date,
        start: req.start,
        deposit: result.depositAmount,
        manageLink: opts.simulate
          ? null
          : `/booking/${result.reference}?t=${encodeURIComponent(result.manageToken)}&new=1`,
        simulated: opts.simulate,
      }
    },

    async findBooking(reference, phone) {
      await enforceRateLimit(db, LIMITS.lookup, ctx.ipHash ?? 'assistant')
      const wanted = normalizePhone(phone)
      const [row] = await db
        .select({ id: t.appointments.id, phone: t.customers.phone })
        .from(t.appointments)
        .innerJoin(t.customers, eq(t.customers.id, t.appointments.customerId))
        .where(and(eq(t.appointments.salonId, salonId), eq(t.appointments.reference, reference.toUpperCase())))
      // Same answer for "no such booking" and "wrong phone": nothing to enumerate.
      if (!row || !wanted || row.phone !== wanted) return null
      return view(row.id)
    },

    getBooking: view,

    async cancel(id, note) {
      if (!opts.simulate) await enforceRateLimit(db, LIMITS.customerChange, ctx.ipHash)
      assertCustomerCancellable(await loadSalonAppointment(ctx, id), now)
      const result = await write((c) =>
        transitionAppointment(c, id, 'cancelled', {
          actor: 'customer',
          reason: 'customer_request',
          note,
          deliver: !opts.simulate,
        }),
      )
      const appt = await loadSalonAppointment(ctx, id)
      const status = result.status
      return {
        appointmentId: id,
        reference: appt.reference,
        status,
        statusLabel: STATUS_LABELS[status],
        depositOutcome: result.depositOutcome,
        simulated: opts.simulate,
      } satisfies ChangeOutcome
    },

    async rescheduleOptions(id) {
      try {
        const { items: lines, staffId } = await customerRescheduleSelection(ctx, id)
        return { ok: true, serviceIds: lines.map((l) => l.serviceId), staffId }
      } catch (err) {
        if (err instanceof Error && 'code' in err) return { ok: false, message: err.message }
        throw err
      }
    },

    async reschedule(id, date, start) {
      if (!opts.simulate) await enforceRateLimit(db, LIMITS.customerChange, ctx.ipHash)
      const { staffId } = await customerRescheduleSelection(ctx, id)
      const result = await write((c) =>
        rescheduleAppointment(
          c,
          id,
          { date, start, staffId },
          { actor: 'customer', publicRules: true, deliver: !opts.simulate },
        ),
      )
      return {
        appointmentId: result.appointmentId,
        reference: result.reference,
        status: result.status,
        statusLabel: STATUS_LABELS[result.status],
        staffName: result.staffName,
        date,
        start,
        simulated: opts.simulate,
      }
    },
  }
  return port
}

/** The salon's active bookings for references a chat session has verified (used by the handler). */
export async function activeIds(db: Database, ids: string[]): Promise<string[]> {
  if (!ids.length) return []
  const rows = await db
    .select({ id: t.appointments.id })
    .from(t.appointments)
    .where(and(inArray(t.appointments.id, ids), inArray(t.appointments.status, ['awaiting_deposit', 'pending', 'confirmed'])))
  return rows.map((r) => r.id)
}
