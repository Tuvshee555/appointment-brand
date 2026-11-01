// The assistant's tools: every fact it states comes from these functions,
// which read the same database the website and admin use. Used by both the
// language-model path and the rule-based path. Tool outputs are compact JSON
// for the model plus optional structured UI parts (slot buttons, booking
// summary) that the widget renders from server data — never from model text.
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { isStaffFree, salonHoursFor } from '@/lib/availability/engine'
import type { ChatPart, DraftSummary } from '@/lib/assistant/types'
import { STATUS_LABELS } from '@/lib/booking/status'
import { addDays, dateKeyOf, formatDateKey, formatDuration, isDateKey, minutesToTime, timeToMinutes, weekdayOf, WEEKDAYS_MN, type DateKey } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { formatPhone, normalizePhone } from '@/lib/phone'
import * as t from '@/server/db/schema'
import { ServiceError, type ServiceContext } from '@/server/context'
import { dayAvailability, loadStaffScheduleData, nextAvailableSlots, prepareSelection, staffDayFor } from '@/server/services/availability'
import { loadSalonConfig, loadSpecialDays } from '@/server/services/salon'

export interface ToolOutcome {
  /** JSON text returned to the model as the tool result. */
  content: string
  /** UI parts to show under the assistant's reply. */
  parts?: ChatPart[]
  isError?: boolean
}

export interface BookingDraft {
  id: string
  items: { serviceId: string; addonIds: string[] }[]
  staffId: string | null
  date: DateKey
  start: number
  name: string
  phone: string
  note: string | null
  expiresAt: string
}

export interface ChatState {
  draft?: BookingDraft
  flow?: {
    step: 'service' | 'staff' | 'date' | 'time' | 'name' | 'phone'
    serviceIds: string[]
    staffId?: string | null
    date?: DateKey
    start?: number
    name?: string
  }
  turns?: number
}

const json = (value: unknown) => JSON.stringify(value)

export async function searchServices(ctx: ServiceContext, input: { query: string | null; category: string | null }): Promise<ToolOutcome> {
  const [services, categories, addons, links, staff, staffServices] = await Promise.all([
    ctx.db.select().from(t.services).where(and(eq(t.services.salonId, ctx.salonId), eq(t.services.isActive, true))).orderBy(asc(t.services.sortOrder)),
    ctx.db.select().from(t.serviceCategories).where(and(eq(t.serviceCategories.salonId, ctx.salonId), eq(t.serviceCategories.isActive, true))),
    ctx.db.select().from(t.serviceAddons).where(and(eq(t.serviceAddons.salonId, ctx.salonId), eq(t.serviceAddons.isActive, true))),
    ctx.db.select().from(t.serviceAddonLinks),
    ctx.db.select({ id: t.staff.id, name: t.staff.displayName, active: t.staff.isActive, online: t.staff.acceptsOnlineBookings }).from(t.staff).where(eq(t.staff.salonId, ctx.salonId)),
    ctx.db.select().from(t.staffServices),
  ])
  const cat = new Map(categories.map((c) => [c.id, c]))
  const q = input.query?.trim().toLowerCase() ?? ''
  const c = input.category?.trim().toLowerCase() ?? ''
  const rows = services
    .filter((s) => cat.has(s.categoryId))
    .filter((s) => !c || cat.get(s.categoryId)!.name.toLowerCase().includes(c) || cat.get(s.categoryId)!.slug === c)
    .filter((s) => !q || `${s.name} ${s.shortDescription} ${cat.get(s.categoryId)!.name}`.toLowerCase().includes(q) || q.split(/\s+/).some((w) => w.length > 3 && s.name.toLowerCase().includes(w)))
  const list = (rows.length ? rows : services.filter((s) => cat.has(s.categoryId))).map((s) => ({
    id: s.id,
    name: s.name,
    category: cat.get(s.categoryId)!.name,
    price: formatMoney(s.price) + (s.priceType === 'from' ? '-өөс' : ''),
    duration: formatDuration(s.durationMinutes),
    description: s.shortDescription,
    online_booking: s.onlineBookable,
    addons: links
      .filter((l) => l.serviceId === s.id)
      .map((l) => addons.find((a) => a.id === l.addonId))
      .filter((a): a is (typeof addons)[number] => Boolean(a))
      .map((a) => ({ id: a.id, name: a.name, price: `+${formatMoney(a.price)}${a.priceType === 'from' ? '-өөс' : ''}`, duration: `+${formatDuration(a.durationMinutes)}` })),
    staff: staffServices
      .filter((r) => r.serviceId === s.id)
      .map((r) => staff.find((x) => x.id === r.staffId))
      .filter((x) => x?.active && x.online)
      .map((x) => ({ id: x!.id, name: x!.name })),
  }))
  return { content: json({ matched: rows.length > 0, services: list.slice(0, 12), note: rows.length ? undefined : 'Тохирох үйлчилгээ олдсонгүй — бүх үйлчилгээг харуулав.' }) }
}

export async function salonInfo(ctx: ServiceContext): Promise<ToolOutcome> {
  const config = await loadSalonConfig(ctx.db, ctx.salonId)
  const today = dateKeyOf(ctx.now)
  const specials = await loadSpecialDays(ctx.db, ctx.salonId, today, addDays(today, 45))
  const s = config.settings
  return {
    content: json({
      name: config.salon.name,
      fictional_demo: config.salon.isDemo,
      address: s.addressLine,
      address_note: s.addressNote,
      phone: formatPhone(s.phone),
      email: s.email,
      opening_hours: config.weekly.map((w) => ({ day: WEEKDAYS_MN[w.weekday - 1], hours: w.isClosed ? 'амарна' : `${minutesToTime(w.opensAt)}–${minutesToTime(w.closesAt)}` })),
      special_days: specials.map((d) => ({ date: d.date, label: d.label, hours: d.kind === 'closed' ? 'амарна' : `${minutesToTime(d.opensAt!)}–${minutesToTime(d.closesAt!)}` })),
      booking_rules: {
        minimum_notice: `${s.minAdvanceMinutes / 60} цаг`,
        book_up_to_days_ahead: s.maxAdvanceDays,
        confirmation: s.confirmationMode === 'auto' ? 'шууд баталгаажна' : 'салон баталгаажуулна',
        late_arrival_minutes: s.lateArrivalMinutes,
      },
      cancellation_policy: s.cancellationPolicy,
      deposit_policy: s.depositPolicy,
      manage_booking: 'Захиалгаа «Миний захиалга» хэсгээс захиалгын дугаар, утсаараа орж цуцлах эсвэл цагаа өөрчилнө.',
    }),
  }
}

export async function listStaff(ctx: ServiceContext, input: { service_id: string | null }): Promise<ToolOutcome> {
  const [staff, staffServices, services, schedules] = await Promise.all([
    ctx.db.select().from(t.staff).where(and(eq(t.staff.salonId, ctx.salonId), eq(t.staff.isActive, true), eq(t.staff.acceptsOnlineBookings, true))).orderBy(asc(t.staff.sortOrder)),
    ctx.db.select().from(t.staffServices),
    ctx.db.select({ id: t.services.id, name: t.services.name }).from(t.services).where(and(eq(t.services.salonId, ctx.salonId), eq(t.services.isActive, true))),
    ctx.db.select().from(t.staffSchedules),
  ])
  const svcName = new Map(services.map((s) => [s.id, s.name]))
  const rows = staff
    .filter((s) => !input.service_id || staffServices.some((r) => r.staffId === s.id && r.serviceId === input.service_id))
    .map((s) => ({
      id: s.id,
      name: s.displayName,
      title: s.title,
      experience_years: s.experienceYears,
      specialties: s.specialties,
      works_on: schedules.filter((x) => x.staffId === s.id && x.isWorking).map((x) => WEEKDAYS_MN[x.weekday - 1]),
      services: staffServices.filter((r) => r.staffId === s.id && svcName.has(r.serviceId)).map((r) => svcName.get(r.serviceId)),
    }))
  return { content: json({ staff: rows }) }
}

export async function checkAvailability(
  ctx: ServiceContext,
  input: { service_ids: string[]; staff_id: string | null; date: string },
): Promise<ToolOutcome> {
  const date = isDateKey(input.date) ? input.date : null
  if (!date) return { content: json({ error: 'Огноог YYYY-MM-DD хэлбэрээр өгнө үү.' }), isError: true }
  try {
    const prepared = await prepareSelection(ctx.db, ctx.salonId, input.service_ids.map((id) => ({ serviceId: id, addonIds: [] })), input.staff_id, { publicOnly: true })
    const day = await dayAvailability(ctx.db, prepared, date, { now: ctx.now, publicRules: true })
    const names = prepared.candidates.map((c) => c.displayName)
    const slots = day.slots.slice(0, 24)
    const serviceLabel = prepared.quote.lines.map((l) => l.name).join(' + ')
    return {
      content: json({
        date,
        weekday: WEEKDAYS_MN[weekdayOf(date) - 1],
        salon_closed: !day.hours,
        special_day: day.special?.label ?? null,
        duration: formatDuration(prepared.quote.durationMinutes),
        total_price: formatMoney(prepared.quote.total) + (prepared.quote.hasFromPrice ? '-өөс' : ''),
        specialists_considered: names,
        free_start_times: slots.map((s) => minutesToTime(s.start)),
        more_available: day.slots.length > slots.length,
      }),
      parts: slots.length
        ? [{ type: 'slots', date, dateLabel: formatDateKey(date), serviceLabel, slots: slots.map((s) => ({ start: s.start, label: minutesToTime(s.start) })) }]
        : undefined,
    }
  } catch (err) {
    if (err instanceof ServiceError) return { content: json({ error: err.message }), isError: true }
    throw err
  }
}

export async function findNextAvailable(ctx: ServiceContext, input: { service_ids: string[]; staff_id: string | null }): Promise<ToolOutcome> {
  try {
    const prepared = await prepareSelection(ctx.db, ctx.salonId, input.service_ids.map((id) => ({ serviceId: id, addonIds: [] })), input.staff_id, { publicOnly: true })
    const slots = await nextAvailableSlots(ctx.db, prepared, dateKeyOf(ctx.now), { now: ctx.now, limit: 6, days: 14 })
    return {
      content: json({
        next_free: slots.map((s) => ({ date: s.date, weekday: WEEKDAYS_MN[weekdayOf(s.date) - 1], time: minutesToTime(s.start) })),
        duration: formatDuration(prepared.quote.durationMinutes),
      }),
    }
  } catch (err) {
    if (err instanceof ServiceError) return { content: json({ error: err.message }), isError: true }
    throw err
  }
}

export interface PrepareInput {
  service_ids: string[]
  addon_ids: string[]
  staff_id: string | null
  date: string
  time: string
  customer_name: string
  customer_phone: string
  note: string | null
}

/**
 * Validates a booking request against live availability and stores it as a
 * draft. Nothing is booked here: the customer must press «Баталгаажуулах».
 */
export async function prepareBooking(ctx: ServiceContext, state: ChatState, input: PrepareInput): Promise<ToolOutcome> {
  const fail = (message: string): ToolOutcome => ({ content: json({ ok: false, error: message }), isError: true })
  if (!isDateKey(input.date)) return fail('Огноо буруу (YYYY-MM-DD).')
  const start = timeToMinutes(input.time)
  if (start === null) return fail('Цаг буруу (HH:MM).')
  const phone = normalizePhone(input.customer_phone)
  if (!phone) return fail('Утасны дугаар 8 оронтой байх ёстой.')
  const name = input.customer_name.trim()
  if (name.length < 2) return fail('Нэрээ асууна уу.')
  try {
    const items = input.service_ids.map((id) => ({ serviceId: id, addonIds: [] as string[] }))
    // Add-ons attach to the first selected service that offers them.
    const prepared0 = await prepareSelection(ctx.db, ctx.salonId, items, input.staff_id, { publicOnly: true })
    for (const addonId of input.addon_ids) {
      const target = items.find((i) => prepared0.catalog.services.get(i.serviceId)?.addonIds.includes(addonId))
      if (!target) return fail('Энэ нэмэлт сонгосон үйлчилгээнд тохирохгүй.')
      target.addonIds.push(addonId)
    }
    const prepared = await prepareSelection(ctx.db, ctx.salonId, items, input.staff_id, { publicOnly: true })
    const config = prepared.config
    const specials = await loadSpecialDays(ctx.db, ctx.salonId, input.date, input.date)
    const hours = salonHoursFor(input.date, config.weekly, specials)
    const data = await loadStaffScheduleData(ctx.db, { staffIds: prepared.candidates.map((c) => c.id), from: input.date, to: input.date, now: ctx.now })
    const request = {
      date: input.date,
      now: ctx.now,
      hours,
      durationMinutes: prepared.quote.durationMinutes,
      bufferMinutes: prepared.quote.bufferMinutes,
      slotIntervalMinutes: config.settings.slotIntervalMinutes,
      minAdvanceMinutes: config.settings.minAdvanceMinutes,
    }
    if (start % config.settings.slotIntervalMinutes !== 0) return fail('Энэ цаг сул цагийн жагсаалтад алга. check_availability-аар шалгана уу.')
    const free = prepared.candidates.filter((c) => isStaffFree(request, staffDayFor(data, c.id, input.date), start))
    if (!free.length) return fail('Энэ цаг сул биш байна. Өөр цаг сонгоно уу.')
    const staffName = input.staff_id ? free[0].displayName : free.length === 1 ? free[0].displayName : `Аль ч мастер (${free.map((f) => f.displayName).join(', ')}-аас систем оноох)`
    const draft: BookingDraft = {
      id: randomUUID(),
      items,
      staffId: input.staff_id,
      date: input.date,
      start,
      name,
      phone,
      note: input.note?.trim() || null,
      expiresAt: new Date(ctx.now.getTime() + 15 * 60_000).toISOString(),
    }
    state.draft = draft
    const q = prepared.quote
    const statusAfter =
      q.deposit > 0
        ? `${STATUS_LABELS.awaiting_deposit} (${formatMoney(q.deposit)})`
        : config.settings.confirmationMode === 'auto'
          ? STATUS_LABELS.confirmed
          : STATUS_LABELS.pending
    const summary: DraftSummary = {
      services: q.lines.map((l) => ({ name: l.name, price: l.price, from: l.priceType === 'from', durationMinutes: l.durationMinutes, addons: l.addons.map((a) => ({ name: a.name, price: a.price })) })),
      staffName,
      dateLabel: formatDateKey(input.date),
      timeRange: `${minutesToTime(start)}–${minutesToTime(start + q.durationMinutes)}`,
      durationMinutes: q.durationMinutes,
      total: q.total,
      hasFromPrice: q.hasFromPrice,
      deposit: q.deposit,
      customerName: name,
      customerPhone: formatPhone(phone),
      statusAfter,
    }
    return {
      content: json({
        ok: true,
        draft_ready: true,
        summary: { ...summary, total: formatMoney(q.total), deposit: q.deposit ? formatMoney(q.deposit) : null },
        instruction: 'Захиалга ХАРААХАН үүсээгүй. Үйлчлүүлэгч доорх хураангуйг шалгаад «Баталгаажуулах» товчийг дарах ёстой.',
      }),
      parts: [{ type: 'draft', draftId: draft.id, summary }],
    }
  } catch (err) {
    if (err instanceof ServiceError) return fail(err.message)
    throw err
  }
}

/** Ids of services/staff mentioned by name — used by the rule-based engine. */
export async function catalogIndex(ctx: ServiceContext) {
  const [services, staff, staffServices] = await Promise.all([
    ctx.db.select().from(t.services).where(and(eq(t.services.salonId, ctx.salonId), eq(t.services.isActive, true), eq(t.services.onlineBookable, true))).orderBy(asc(t.services.sortOrder)),
    ctx.db.select().from(t.staff).where(and(eq(t.staff.salonId, ctx.salonId), eq(t.staff.isActive, true), eq(t.staff.acceptsOnlineBookings, true))).orderBy(asc(t.staff.sortOrder)),
    ctx.db.select().from(t.staffServices),
  ])
  return { services, staff, staffServices }
}

export async function staffNamesFor(ctx: ServiceContext, ids: string[]) {
  if (!ids.length) return []
  return ctx.db.select({ id: t.staff.id, name: t.staff.displayName }).from(t.staff).where(inArray(t.staff.id, ids))
}
