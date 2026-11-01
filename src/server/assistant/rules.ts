// Rule-based assistant: answers common Mongolian questions and runs a
// button-driven booking flow without a language model. All facts come from
// the shared tools/database. When unsure, it hands off to staff — it never
// guesses (the same rule the Ursgal Messenger engine follows).
import type { ChatAction, ChatPart, QuickReply } from '@/lib/assistant/types'
import {
  addDays,
  dateKeyOf,
  formatDateKey,
  formatDuration,
  isDateKey,
  minutesToTime,
  relativeDayLabel,
  weekdayOf,
  type DateKey,
} from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { formatPhone, normalizePhone } from '@/lib/phone'
import type { ServiceContext } from '@/server/context'
import { monthAvailability, prepareSelection } from '@/server/services/availability'
import { catalogIndex, checkAvailability, prepareBooking, salonInfo, type ChatState } from './tools'

export interface RuleReply {
  parts: ChatPart[]
  handoff?: boolean
}

const LATIN: [RegExp, string][] = [
  [/\bune\b|\bunee\b/g, 'үнэ'],
  [/\bhed\b|\bhede\b/g, 'хэд'],
  [/\bgel\b/g, 'гель'],
  [/\bmani[ck]?[iy]ur\w*|\bmanicure\b/g, 'маникюр'],
  [/\bpedi[ck]?[iy]ur\w*|\bpedicure\b/g, 'педикюр'],
  [/\bsungalt\w*/g, 'сунгалт'],
  [/\btsag\b/g, 'цаг'],
  [/\bzahial\w*/g, 'захиалах'],
  [/\bmargaash\b/g, 'маргааш'],
  [/\bun[uo]{2}d[uo]r\b|\bonoodor\b/g, 'өнөөдөр'],
  [/\bhayag\b|\bhaana\b/g, 'хаяг'],
  [/\btsuts\w*/g, 'цуцлах'],
  [/\bfrench\b|\bfrants\b/g, 'франц'],
  [/\bbudalt\b/g, 'будалт'],
  [/\bsain baina uu\b|\bsain uu\b|\bhello\b|\bhi\b/g, 'сайн байна уу'],
]

export function normalize(text: string) {
  let s = text
    .toLowerCase()
    .replace(/[!?.,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  for (const [re, to] of LATIN) s = s.replace(re, to)
  return s
}

const has = (s: string, words: string[]) => words.some((w) => s.includes(w))

const SYNONYMS: Record<string, string[]> = {
  'gel-polish': ['гель будалт', 'гель будах', 'гел будалт'],
  'gel-polish-renewal': ['гель авч', 'шинээр будах'],
  'basic-manicure': ['энгийн маникюр'],
  'classic-manicure': ['сонгодог маникюр', 'маникюр'],
  'mens-manicure': ['эрэгтэй'],
  'french-manicure': ['франц маникюр', 'франц'],
  'nail-strengthening': ['бэхжүүл'],
  'nail-extensions': ['хумс сунгалт', 'сунгалт', 'типс', 'сунгуул'],
  'gel-extensions': ['гель сунгалт'],
  'acrylic-extensions': ['акрил'],
  'nail-refill': ['нөхөлт', 'нөхүүл', 'нөхөх'],
  'nail-repair': ['засвар', 'хугарсан', 'хугарчихсан'],
  'simple-nail-art': ['энгийн зураг', 'зураг'],
  'premium-nail-art': ['премиум зураг', 'хром', 'дизайн'],
  'custom-design': ['захиалгат'],
  'decorative-design': ['сувд', 'чулуу', 'чимэглэл'],
  'basic-pedicure': ['педикюр', 'хөлийн'],
  'gel-pedicure': ['гель педикюр'],
  'premium-pedicure': ['премиум педикюр', 'аппарат'],
  'gel-removal': ['гель авалт', 'гель авах', 'гелээ авах'],
  'extension-removal': ['сунгалт авах', 'сунгалт авалт'],
  'hand-care': ['парафин', 'гарын арчилгаа'],
  'nail-care': ['хумсны арчилгаа', 'витамин'],
}

type Index = Awaited<ReturnType<typeof catalogIndex>>

/** The service whose name or synonym matches the longest phrase in the text. */
export function matchService(index: Index, s: string) {
  let best: { id: string; len: number } | null = null
  for (const svc of index.services) {
    const keys = [svc.name.toLowerCase(), ...(SYNONYMS[svc.slug] ?? [])]
    for (const k of keys) if (s.includes(k) && (!best || k.length > best.len)) best = { id: svc.id, len: k.length }
  }
  return best ? index.services.find((x) => x.id === best!.id)! : null
}

function matchStaff(index: Index, s: string) {
  return index.staff.find((x) => s.includes(x.displayName.toLowerCase())) ?? null
}

const WEEKDAY_WORDS = ['даваа', 'мягмар', 'лхагва', 'пүрэв', 'баасан', 'бямба', 'ням']

/** "өнөөдөр", "маргааш", "нөгөөдөр", weekday names, "11/5", "11 сарын 5", "2026-11-05". */
export function parseDateWord(s: string, today: DateKey): DateKey | null {
  if (s.includes('өнөөдөр')) return today
  if (s.includes('нөгөөдөр')) return addDays(today, 2)
  if (s.includes('маргааш')) return addDays(today, 1)
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(s)
  if (iso && isDateKey(iso[1])) return iso[1]
  const [y] = today.split('-').map(Number)
  const md = /(\d{1,2})\s*(?:\/|сарын)\s*(\d{1,2})/.exec(s)
  if (md) {
    const m = Number(md[1])
    const d = Number(md[2])
    let key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (isDateKey(key) && key < today) key = `${y + 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    if (isDateKey(key)) return key
  }
  const wd = WEEKDAY_WORDS.findIndex((w) => s.includes(w))
  if (wd >= 0) {
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, i)
      if (weekdayOf(d) === wd + 1) return d
    }
  }
  return null
}

function quick(options: QuickReply[]): ChatPart {
  return { type: 'quick_replies', options }
}

const MAIN_MENU: QuickReply[] = [
  { label: 'Үйлчилгээ, үнэ', message: 'Ямар үйлчилгээ байдаг вэ?' },
  { label: 'Сул цаг шалгах', message: 'Цаг захиалах' },
  { label: 'Ажлын цаг', message: 'Хэдэн цагаас ажилладаг вэ?' },
  { label: 'Хаяг', message: 'Хаяг хаана вэ?' },
  { label: 'Цаг цуцлах', message: 'Захиалгаа яаж цуцлах вэ?' },
]

export async function greeting(ctx: ServiceContext): Promise<RuleReply> {
  const info = JSON.parse((await salonInfo(ctx)).content) as { name: string }
  return {
    parts: [
      {
        type: 'text',
        text: `Сайн байна уу. Би ${info.name} салоны туслах. Үйлчилгээ, үнэ, сул цагийг салоны системээс шалгаж хэлнэ, цаг захиалахад тусална.`,
      },
      quick(MAIN_MENU),
    ],
  }
}

async function servicePicker(ctx: ServiceContext, text: string): Promise<RuleReply> {
  const index = await catalogIndex(ctx)
  const popular = [
    'gel-polish',
    'classic-manicure',
    'french-manicure',
    'gel-extensions',
    'nail-refill',
    'gel-pedicure',
    'basic-pedicure',
  ]
  const options = popular
    .map((slug) => index.services.find((s) => s.slug === slug))
    .filter((s): s is Index['services'][number] => Boolean(s))
    .map((s) => ({
      label: `${s.name} · ${formatMoney(s.price)}`,
      action: { type: 'pick_service', serviceId: s.id } as ChatAction,
    }))
  return { parts: [{ type: 'text', text }, quick(options)] }
}

async function staffPicker(ctx: ServiceContext, state: ChatState, serviceId: string): Promise<RuleReply> {
  const index = await catalogIndex(ctx)
  const svc = index.services.find((s) => s.id === serviceId)!
  const eligible = index.staff.filter((st) =>
    index.staffServices.some((r) => r.staffId === st.id && r.serviceId === serviceId),
  )
  state.flow = { step: 'staff', serviceIds: [serviceId] }
  return {
    parts: [
      {
        type: 'text',
        text: `${svc.name}: ${formatMoney(svc.price)}${svc.priceType === 'from' ? '-өөс' : ''}, ${formatDuration(svc.durationMinutes)}. Энэ үйлчилгээг ${eligible.map((e) => e.displayName).join(', ')} хийдэг. Мастер сонгох уу?`,
      },
      quick([
        { label: 'Аль ч мастер', action: { type: 'pick_staff', staffId: null } },
        ...eligible.map((e) => ({ label: e.displayName, action: { type: 'pick_staff', staffId: e.id } as ChatAction })),
      ]),
    ],
  }
}

async function datePicker(ctx: ServiceContext, state: ChatState): Promise<RuleReply> {
  const flow = state.flow!
  const today = dateKeyOf(ctx.now)
  const prepared = await prepareSelection(
    ctx.db,
    ctx.salonId,
    flow.serviceIds.map((id) => ({ serviceId: id, addonIds: [] })),
    flow.staffId ?? null,
    { publicOnly: true },
  )
  const months = [today.slice(0, 7), addDays(`${today.slice(0, 7)}-28`, 7).slice(0, 7)]
  const days = (await Promise.all(months.map((m) => monthAvailability(ctx.db, prepared, m, { now: ctx.now })))).flat()
  const open = days.filter((d) => d.state === 'available').slice(0, 6)
  flow.step = 'date'
  if (!open.length)
    return {
      parts: [
        { type: 'text', text: 'Ойрын хугацаанд сул цаг олдсонгүй. Өөр мастер сонгох эсвэл салон руу залгана уу.' },
      ],
    }
  return {
    parts: [
      { type: 'text', text: 'Аль өдөр тохирох вэ? Сул цагтай ойрын өдрүүд:' },
      quick(
        open.map((d) => ({
          label: `${relativeDayLabel(d.date, today)} (${d.slotCount})`,
          action: { type: 'pick_date', date: d.date } as ChatAction,
        })),
      ),
    ],
  }
}

async function slotList(ctx: ServiceContext, state: ChatState, date: DateKey): Promise<RuleReply> {
  const flow = state.flow!
  const result = await checkAvailability(ctx, { service_ids: flow.serviceIds, staff_id: flow.staffId ?? null, date })
  const data = JSON.parse(result.content) as { error?: string; free_start_times?: string[]; salon_closed?: boolean }
  flow.date = date
  flow.step = 'time'
  if (data.error) return { parts: [{ type: 'text', text: data.error }] }
  if (data.salon_closed)
    return { parts: [{ type: 'text', text: `${formatDateKey(date)} салон амарна. Өөр өдөр сонгоно уу.` }] }
  if (!data.free_start_times?.length)
    return { parts: [{ type: 'text', text: `${formatDateKey(date)} сул цаг үлдсэнгүй. Өөр өдөр сонгоно уу.` }] }
  return { parts: [{ type: 'text', text: 'Сул цагаас сонгоно уу:' }, ...(result.parts ?? [])] }
}

export async function handleRuleAction(ctx: ServiceContext, state: ChatState, action: ChatAction): Promise<RuleReply> {
  switch (action.type) {
    case 'hello':
    case 'reset':
      state.flow = undefined
      state.draft = undefined
      return greeting(ctx)
    case 'pick_service':
      return staffPicker(ctx, state, action.serviceId)
    case 'pick_staff':
      if (!state.flow) return servicePicker(ctx, 'Эхлээд үйлчилгээгээ сонгоно уу.')
      state.flow.staffId = action.staffId
      return datePicker(ctx, state)
    case 'pick_date':
      if (!state.flow) return servicePicker(ctx, 'Эхлээд үйлчилгээгээ сонгоно уу.')
      return slotList(ctx, state, action.date)
    case 'choose_slot': {
      if (!state.flow?.serviceIds.length) return servicePicker(ctx, 'Эхлээд үйлчилгээгээ сонгоно уу.')
      state.flow = { ...state.flow, date: action.date, start: action.start, step: 'name' }
      return {
        parts: [
          {
            type: 'text',
            text: `${formatDateKey(action.date)} ${minutesToTime(action.start)}. Захиалгыг хэний нэр дээр хийх вэ? (Демо: жишээ нэр бичиж болно.)`,
          },
        ],
      }
    }
    default:
      return greeting(ctx)
  }
}

export async function handleRuleText(ctx: ServiceContext, state: ChatState, raw: string): Promise<RuleReply> {
  const s = normalize(raw)
  const today = dateKeyOf(ctx.now)
  const index = await catalogIndex(ctx)
  const flow = state.flow

  // ---- Booking flow: collecting name and phone
  if (flow?.step === 'name' && s.length >= 2 && !s.includes('?')) {
    flow.name = raw.trim().slice(0, 80)
    flow.step = 'phone'
    return {
      parts: [
        {
          type: 'text',
          text: `Баярлалаа, ${flow.name}. Утасны дугаараа бичнэ үү (8 орон). Демо: 5000 1234 гэх мэт жишээ дугаар болно.`,
        },
      ],
    }
  }
  if (flow?.step === 'phone') {
    const phone = normalizePhone(raw)
    if (!phone) return { parts: [{ type: 'text', text: 'Утасны дугаар 8 оронтой байх ёстой. Жишээ: 9911 2233' }] }
    const result = await prepareBooking(ctx, state, {
      service_ids: flow.serviceIds,
      addon_ids: [],
      staff_id: flow.staffId ?? null,
      date: flow.date!,
      time: minutesToTime(flow.start!),
      customer_name: flow.name ?? 'Үйлчлүүлэгч',
      customer_phone: phone,
      note: null,
    })
    if (result.isError) {
      const msg = (JSON.parse(result.content) as { error: string }).error
      return { parts: [{ type: 'text', text: `${msg} Өөр цаг сонгоё.` }, ...(await datePicker(ctx, state)).parts] }
    }
    state.flow = undefined
    return {
      parts: [
        {
          type: 'text',
          text: 'Захиалгын хураангуйг шалгаад «Баталгаажуулах» дарна уу. Дарахаас өмнө захиалга үүсэхгүй.',
        },
        ...(result.parts ?? []),
      ],
    }
  }

  const service = matchService(index, s)
  const staffMention = matchStaff(index, s)
  const date = parseDateWord(s, today)

  if (has(s, ['сайн байна уу', 'сайн уу', 'мэнд', 'өглөөний мэнд'])) return greeting(ctx)
  if (has(s, ['баярлалаа', 'гоё', 'thanks', 'thank'])) {
    return { parts: [{ type: 'text', text: 'Таатай байна. Өөр асуух зүйл байвал бичээрэй.' }, quick(MAIN_MENU)] }
  }

  if (has(s, ['цуцла', 'цуцал', 'хойшлуул', 'өөрчлө', 'шилжүүл'])) {
    const info = JSON.parse((await salonInfo(ctx)).content) as { cancellation_policy: string; manage_booking: string }
    return {
      parts: [
        { type: 'text', text: `${info.manage_booking} ${info.cancellation_policy}` },
        quick([{ label: 'Миний захиалга хуудас', message: 'Миний захиалга хаана байдаг вэ?' }]),
      ],
    }
  }
  if (has(s, ['миний захиалга'])) {
    return {
      parts: [
        {
          type: 'text',
          text: 'Цэсний «Миний захиалга» хэсэгт захиалгын дугаар (SV-…), утасны дугаараа оруулаад орно. Би одоо байгаа захиалгыг өөрчлөх эрхгүй.',
        },
      ],
    }
  }
  if (
    has(s, [
      'ажлын цаг',
      'хэдэн цагаас',
      'хэдэн цаг хүртэл',
      'хэзээ нээ',
      'онгойдог',
      'хаадаг',
      'нээлттэй',
      'амралтын өдөр',
      'ажилладаг',
    ])
  ) {
    const info = JSON.parse((await salonInfo(ctx)).content) as {
      opening_hours: { day: string; hours: string }[]
      special_days: { date: string; label: string; hours: string }[]
    }
    const special = info.special_days.slice(0, 2).map((d) => `${formatDateKey(d.date)}: ${d.hours} (${d.label})`)
    return {
      parts: [
        {
          type: 'text',
          text: `Ажлын цаг:\n${info.opening_hours.map((h) => `${h.day}: ${h.hours}`).join('\n')}${special.length ? `\n\nОнцгой өдрүүд:\n${special.join('\n')}` : ''}`,
        },
      ],
    }
  }
  if (has(s, ['хаяг', 'байршил', 'хаана', 'яаж очих'])) {
    const info = JSON.parse((await salonInfo(ctx)).content) as {
      address: string
      address_note: string | null
      phone: string
    }
    return {
      parts: [
        {
          type: 'text',
          text: `${info.address}${info.address_note ? ` (${info.address_note})` : ''}. Утас: ${info.phone}.`,
        },
      ],
    }
  }
  if (has(s, ['урьдчилгаа', 'төлбөр', 'qpay', 'карт', 'бэлэн'])) {
    const info = JSON.parse((await salonInfo(ctx)).content) as { deposit_policy: string }
    return { parts: [{ type: 'text', text: `${info.deposit_policy} Салонд карт, бэлэн мөнгө, QPay авна.` }] }
  }

  const wantsBooking =
    has(s, ['захиал', 'цаг авах', 'сул цаг', 'цаг байна', 'боломжтой', 'чөлөөтэй']) ||
    Boolean(date && (service || flow))
  if (wantsBooking) {
    const serviceId = service?.id ?? flow?.serviceIds[0]
    if (!serviceId) return servicePicker(ctx, 'Ямар үйлчилгээ авах вэ? Сонгоно уу эсвэл нэрийг нь бичээрэй.')
    if (staffMention && !index.staffServices.some((r) => r.staffId === staffMention.id && r.serviceId === serviceId)) {
      return {
        parts: [
          { type: 'text', text: `${staffMention.displayName} мастер энэ үйлчилгээг хийдэггүй.` },
          ...(await staffPicker(ctx, state, serviceId)).parts,
        ],
      }
    }
    if (staffMention || date) {
      state.flow = { step: 'date', serviceIds: [serviceId], staffId: staffMention?.id ?? state.flow?.staffId ?? null }
      return date ? slotList(ctx, state, date) : datePicker(ctx, state)
    }
    return staffPicker(ctx, state, serviceId)
  }

  if (has(s, ['мастер', 'хэн хийдэг', 'хэн хийх', 'ажилтан'])) {
    const list = index.staff.filter(
      (st) => !service || index.staffServices.some((r) => r.staffId === st.id && r.serviceId === service.id),
    )
    return {
      parts: [
        {
          type: 'text',
          text: `${service ? `«${service.name}» үйлчилгээг хийдэг мастерууд` : 'Манай мастерууд'}: ${list.map((x) => `${x.displayName} (${x.title})`).join(', ')}.`,
        },
        ...(service
          ? [quick([{ label: 'Цаг захиалах', action: { type: 'pick_service', serviceId: service.id } }])]
          : []),
      ],
    }
  }

  if (service) {
    const wantsDuration = has(s, ['удаан', 'хугацаа', 'минут', 'хэдэн цаг', 'үргэлж'])
    const text = wantsDuration
      ? `${service.name} ${formatDuration(service.durationMinutes)} үргэлжилнэ. Үнэ ${formatMoney(service.price)}${service.priceType === 'from' ? '-өөс' : ''}.`
      : `${service.name}: ${formatMoney(service.price)}${service.priceType === 'from' ? '-өөс (эцсийн үнэ дизайнаас хамаарна)' : ''}, ${formatDuration(service.durationMinutes)}. ${service.shortDescription}`
    return {
      parts: [
        { type: 'text', text },
        quick([
          { label: 'Сул цаг харах', action: { type: 'pick_service', serviceId: service.id } },
          { label: 'Бусад үйлчилгээ', message: 'Ямар үйлчилгээ байдаг вэ?' },
        ]),
      ],
    }
  }

  if (has(s, ['үнэ', 'хэд вэ', 'хэдээр', 'төгрөг', 'үйлчилгээ', 'юу хийдэг', 'жагсаалт'])) {
    const lines = index.services
      .slice(0, 10)
      .map(
        (x) =>
          `• ${x.name} — ${formatMoney(x.price)}${x.priceType === 'from' ? '-өөс' : ''}, ${formatDuration(x.durationMinutes)}`,
      )
    return {
      parts: [
        {
          type: 'text',
          text: `Түгээмэл үйлчилгээ:\n${lines.join('\n')}\n\nБүтэн жагсаалт «Үйлчилгээ, үнэ» хуудсанд бий. Аль үйлчилгээг сонирхож байна?`,
        },
        quick([{ label: 'Цаг захиалах', message: 'Цаг захиалах' }]),
      ],
    }
  }

  return {
    handoff: true,
    parts: [
      {
        type: 'handoff',
        text: `Энэ асуултад баттай хариулт надад алга. Ажилтан тантай холбогдоно — шууд асуух бол ${formatPhone((JSON.parse((await salonInfo(ctx)).content) as { phone: string }).phone.replace(/\s/g, ''))} руу залгаарай.`,
      },
      quick(MAIN_MENU),
    ],
  }
}
