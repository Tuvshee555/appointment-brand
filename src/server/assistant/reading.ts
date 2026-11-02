// One customer message → one structured reading: intents and topics, the services and specialists
// it names, a date or time, contact details and yes/no. The rules read every message; when they
// find nothing, the language model may propose a reading in the same shape, which is then
// grounded here (catalogue ids, real dates, valid times) before the dialogue uses it.
import type { DateKey } from '@/lib/datetime'
import { isDateKey, timeToMinutes } from '@/lib/datetime'
import { normalizePhone } from '@/lib/phone'
import { detect, type Detection, type Intent, type Topic } from './engine/intents'
import { findDigits8, findName, findPhone, findReference, isNo, isYes, numberChoice } from './engine/signals'
import { normText, probeOf } from './engine/text'
import { findVocabulary } from './engine/vocab'
import { parseWhen, type TimeRange } from './engine/when'
import type { GenericTerm, Snapshot } from './salon/port'

export interface Reading {
  text: string
  norm: string
  det: Detection
  /** Specific services named. */
  services: string[]
  /** A generic word without a specific service ("маникюр"). */
  generic?: GenericTerm & { key: string }
  /** A specialist named (null = "any specialist"). */
  staffId?: string | null
  staffNamed: string[]
  /** A beauty service the business does not offer ("eyelash", "сормос"). */
  outside?: string
  date?: DateKey
  fromWeekday?: boolean
  time?: number
  range?: TimeRange
  durationQuestion?: boolean
  phone?: string
  /** Any 8-digit number in the message, valid phone or not. */
  digits?: string
  name?: string
  reference?: string
  yes: boolean
  no: boolean
  /** The whole message is a pick from a numbered list (zero-based). */
  choice?: number
  source: 'rules' | 'model'
}

export function readMessage(
  text: string,
  snap: Snapshot,
  opts: { today: DateKey; expectName: boolean; fallbackDate?: DateKey },
): Reading {
  const norm = normText(text)
  const probe = probeOf(text)
  const det = detect(probe)
  const matches = findVocabulary(text, snap.vocabulary)
  const services = matches.filter((m) => m.kind === 'service').map((m) => m.id)
  const genericMatch = matches.find((m) => m.kind === 'generic')
  const outsideTerm = matches.some((m) => m.kind === 'outside')
  const generic =
    genericMatch && !services.length && !outsideTerm ? { key: genericMatch.id, ...snap.generics.get(genericMatch.id)! } : undefined
  const staffNamed = matches.filter((m) => m.kind === 'staff').map((m) => m.id)
  const outside = matches.find((m) => m.kind === 'outside')?.id
  const anyStaff = matches.some((m) => m.kind === 'any_staff')
  const when = parseWhen(norm, text.toLowerCase(), opts.today, snap.hoursFor, opts.fallbackDate)
  const reference = findReference(text) ?? undefined
  const phone = findPhone(text) ?? undefined
  const yes = isYes(norm, text)
  const no = !yes && isNo(norm, text)
  return {
    text,
    norm,
    det,
    services,
    generic,
    staffId: staffNamed[0] ?? (anyStaff ? null : undefined),
    staffNamed,
    outside,
    date: when.date,
    fromWeekday: when.fromWeekday,
    time: when.time,
    range: when.range,
    durationQuestion: when.durationQuestion,
    phone,
    digits: findDigits8(text) ?? undefined,
    name: yes || no ? undefined : (findName(text, opts.expectName) ?? undefined),
    reference,
    yes,
    no,
    choice: numberChoice(norm),
    source: 'rules',
  }
}

/** Nothing the dialogue could act on: the model may be asked for a reading. */
export function isEmptyReading(r: Reading): boolean {
  return (
    !r.det.intents.length &&
    !r.det.topics.length &&
    !r.services.length &&
    !r.generic &&
    !r.outside &&
    r.staffId === undefined &&
    !r.date &&
    r.time === undefined &&
    !r.range &&
    !r.durationQuestion &&
    !r.phone &&
    !r.digits &&
    !r.reference &&
    !r.name &&
    !r.yes &&
    !r.no &&
    r.choice === undefined
  )
}

/** What the model may propose; every field is checked against the snapshot below. */
export interface ModelProposal {
  intent?: unknown
  topics?: unknown
  services?: unknown
  staff?: unknown
  date?: unknown
  time?: unknown
  phone?: unknown
  name?: unknown
  reference?: unknown
  answer?: unknown
}

const MODEL_INTENTS: Intent[] = ['book', 'reschedule', 'cancel', 'status', 'human', 'complaint', 'greeting', 'thanks', 'identity', 'privacy']
const MODEL_TOPICS: Topic[] = [
  'price',
  'duration',
  'services',
  'staff',
  'hours',
  'location',
  'cancel_policy',
  'deposit',
  'payment',
  'preparation',
  'aftercare',
  'parking',
  'contact',
  'availability',
]

/**
 * Grounds a model proposal: keys must be catalogue keys from the prompt, dates real calendar
 * days inside the booking window, times HH:MM, phones valid numbers. Anything else is dropped.
 */
export function groundProposal(
  base: Reading,
  p: ModelProposal,
  keys: { services: Map<string, string>; staff: Map<string, string> },
  window: { today: DateKey; last: DateKey },
): Reading {
  const r: Reading = { ...base, det: { ...base.det, intents: [...base.det.intents], topics: [...base.det.topics] } }
  if (typeof p.intent === 'string' && MODEL_INTENTS.includes(p.intent as Intent) && !r.det.intents.length)
    r.det.intents.push(p.intent as Intent)
  if (Array.isArray(p.topics))
    for (const t of p.topics) if (MODEL_TOPICS.includes(t as Topic) && !r.det.topics.includes(t as Topic)) r.det.topics.push(t as Topic)
  if (Array.isArray(p.services) && !r.services.length)
    r.services = [...new Set(p.services.map((k) => keys.services.get(String(k))).filter((id): id is string => Boolean(id)))].slice(0, 3)
  if (r.staffId === undefined && typeof p.staff === 'string') {
    if (p.staff === 'any') r.staffId = null
    else if (keys.staff.has(p.staff)) r.staffId = keys.staff.get(p.staff)
  }
  if (!r.date && typeof p.date === 'string' && isDateKey(p.date) && p.date >= window.today && p.date <= window.last) r.date = p.date
  if (r.time === undefined && typeof p.time === 'string') {
    const m = timeToMinutes(p.time)
    if (m !== null) r.time = m
  }
  if (!r.phone && typeof p.phone === 'string') r.phone = normalizePhone(p.phone) ?? undefined
  if (!r.reference && typeof p.reference === 'string') r.reference = findReference(p.reference) ?? undefined
  if (!r.name && typeof p.name === 'string' && /^[\p{L}][\p{L}\s-]{1,40}$/u.test(p.name.trim())) r.name = p.name.trim()
  if (p.answer === 'yes' && !r.no) r.yes = true
  if (p.answer === 'no' && !r.yes) r.no = true
  r.source = 'model'
  return r
}

/** Rough reply language: Cyrillic → Mongolian; plain English sentences → English. */
export function detectLocale(text: string, previous: 'mn' | 'en' | undefined): 'mn' | 'en' {
  if (/[а-яөүё]/iu.test(text)) return 'mn'
  const words = text.toLowerCase().match(/[a-z']+/g) ?? []
  if (!words.length) return previous ?? 'mn'
  const english = new Set([
    'i', 'you', 'my', 'me', 'the', 'a', 'an', 'is', 'are', 'can', 'could', 'how', 'what', 'when', 'where',
    'who', 'which', 'do', 'does', 'want', 'would', 'like', 'please', 'book', 'appointment', 'cancel', 'change',
    'much', 'price', 'tomorrow', 'today', 'available', 'need', 'to', 'for', 'at', 'have', 'there', 'yes', 'no',
    'thanks', 'thank', 'hello', 'hi', 'long', 'take', 'time', 'open', 'closed', 'your', 'it', 'this', 'that',
  ])
  const mongolian = /^(?:tsag\w*|cag\w*|bn|bna|baina|uu|vv|ve|yu|yuu|hed\w*|une\w*|margaash\w*|zahial\w*|hiilge\w*|bolno|boloh|bolh\w*|tiim|ugui|za|bayarlalaa|bga\w*|bdag|sain|unuudur|onoodor|ene|ter|minii|tanai|hums\w*|budalt\w*|sungalt\w*|garig\w*|garag\w*|oroi|ugluu)$/
  const en = words.filter((w) => english.has(w)).length
  const mn = words.filter((w) => mongolian.test(w)).length
  if (mn > 0) return 'mn'
  if (en >= 2 || (en >= 1 && words.length <= 3 && previous === 'en')) return 'en'
  return previous ?? 'mn'
}

export type { Topic }
