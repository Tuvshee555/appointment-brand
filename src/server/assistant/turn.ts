// One customer turn → one reply (the Lorentz turn.ts pattern, appointment edition). Pure apart
// from the injected SalonPort and model functions, so whole conversations run in tests.
// Order of layers:
//   0  safety: a request for a person, a complaint, other people's data, "I paid"
//   1  a summary waiting for "yes"/"no" (a new booking, a cancellation or a move)
//   2  existing bookings: status, cancel, reschedule — only after reference + phone match
//   3  booking: remembers service, specialist, day, time, name and phone across turns and asks
//      one question at a time; times come only from the availability engine
//   4  information from the live catalogue and settings; the owner's verified FAQ verbatim
//   5  the model's answer to an open question, behind the fact check
//   6  an honest "I don't know" with the phone number and the offer of a person — never silence
// The assistant never says a booking exists, moved or was cancelled unless the backend did it.
import { randomUUID } from 'node:crypto'
import type { ChatAction, ChatPart, DraftSummary, QuickReply } from '@/lib/assistant/types'
import { STATUS_EXPLANATIONS, STATUS_LABELS, type AppointmentStatus } from '@/lib/booking/status'
import { addDays, dateKeyOf, type DateKey } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { ServiceError } from '@/server/context'
import { matchKnowledge } from './engine/knowledge'
import type { Topic } from './engine/intents'
import { bareHour, type TimeRange } from './engine/when'
import {
  clock,
  dayLabel,
  duration,
  fullDayLabel,
  phone,
  price,
  say,
  serviceLine,
  weekdayName,
  weeklyHours,
  type Locale,
} from './format'
import { detectLocale, isEmptyReading, readMessage, type Reading } from './reading'
import type { BookingView, DayPlan, PortService, SalonPort, Snapshot } from './salon/port'

export type HandoffReason =
  'customer_request' | 'complaint' | 'payment_claim' | 'unanswered' | 'verification' | 'system_error'

export type Awaiting =
  | 'service'
  | 'service_choice'
  | 'date'
  | 'time'
  | 'contact'
  | 'confirm'
  | 'reference'
  | 'phone'
  | 'pick_booking'
  | 'manage_date'
  | 'manage_time'
  | 'change_confirm'

export interface BookingMemory {
  serviceIds: string[]
  /** undefined: not chosen yet; null: any specialist. */
  staffId?: string | null
  date?: DateKey
  time?: number
  range?: TimeRange
  name?: string
  phone?: string
  /** A generic word was read as this service; said once. */
  assumed?: { serviceId: string; label: string; told: boolean }
}

export interface AssistantState {
  v: 2
  locale?: Locale
  turns?: number
  greeted?: boolean
  demoHintShown?: boolean
  focus?: { serviceIds?: string[]; staffId?: string }
  booking?: BookingMemory
  awaiting?: Awaiting
  choices?: { kind: 'service' | 'date' | 'time' | 'booking'; values: string[] }
  draft?: {
    id: string
    serviceIds: string[]
    staffId: string | null
    date: DateKey
    start: number
    name: string
    phone: string
    expiresAt: string
  }
  manage?: {
    intent: 'cancel' | 'reschedule' | 'status'
    reference?: string
    appointmentId?: string
    date?: DateKey
    time?: number
    range?: TimeRange
    failures?: number
  }
  change?: {
    id: string
    kind: 'cancel' | 'reschedule'
    appointmentId: string
    reference: string
    date?: DateKey
    start?: number
    expiresAt: string
  }
  /** Bookings this chat may manage: created here, or proved with reference + phone (2 hours). */
  verified?: { id: string; reference: string; until: string }[]
  /** Confirmed drafts, so a repeated "yes" or button press never books twice. */
  done?: { draftId: string; reference: string }[]
  unknownStreak?: number
  handedOff?: boolean
  /** The day a "model budget used up" event was last recorded for this conversation. */
  budgetNoticeDay?: string
}

export interface TurnEvent {
  kind: string
  level?: 'info' | 'warning' | 'error'
  appointmentId?: string
  detail?: Record<string, unknown>
}

export interface HistoryLine {
  role: 'user' | 'assistant'
  text: string
}

export interface ModelPorts {
  /** A grounded reading of a message the rules could not read; null when the model is unavailable. */
  interpret?:
    | ((args: {
        reading: Reading
        snapshot: Snapshot
        state: AssistantState
        history: HistoryLine[]
        today: DateKey
      }) => Promise<Reading | null>)
    | null
  /** A fact-checked answer to an open question, or null (no answer / rejected / unavailable). */
  write?:
    | ((args: {
        question: string
        snapshot: Snapshot
        history: HistoryLine[]
        locale: Locale
        today: DateKey
      }) => Promise<string | null>)
    | null
}

export interface TurnInput {
  text?: string
  action?: ChatAction
  state: AssistantState | Record<string, unknown>
  history: HistoryLine[]
  port: SalonPort
  now: Date
  models?: ModelPorts
  settings: { englishReplies: boolean; greeting: string | null; handoverMessage: string | null }
}

export interface TurnOutput {
  parts: ChatPart[]
  state: AssistantState
  intent: string
  events: TurnEvent[]
  handoff?: { reason: HandoffReason }
  booked?: { appointmentId: string; reference: string }
  /** References the visitor proved in this turn (the web route grants them the booking page). */
  grantReferences: string[]
  usedModel: boolean
}

const DRAFT_MINUTES = 15
const VERIFIED_HOURS = 2
const MAX_FAILED_VERIFICATIONS = 3
const POPULAR = [
  'gel-polish',
  'classic-manicure',
  'french-manicure',
  'gel-extensions',
  'nail-refill',
  'gel-pedicure',
  'basic-pedicure',
]
const ACTIVE_STATUSES = new Set(['awaiting_deposit', 'pending', 'confirmed'])
const BOOKING_STEPS: Awaiting[] = ['service', 'service_choice', 'date', 'time', 'contact', 'confirm']
const MANAGE_STEPS: Awaiting[] = ['reference', 'phone', 'pick_booking', 'manage_date', 'manage_time', 'change_confirm']
const INFO_TOPICS: Topic[] = [
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
]
const STRONG_BOOKING = /(?:цаг\s*(?:авах|захиал|товл)|захиалах|захиалъя|бүртгүүл|\bbook\b|reserve|appointment)/u

function freshState(): AssistantState {
  return { v: 2, turns: 0 }
}

export async function runTurn(input: TurnInput): Promise<TurnOutput> {
  const raw = input.state as Partial<AssistantState>
  const state: AssistantState = raw && raw.v === 2 ? structuredClone(raw as AssistantState) : freshState()
  const snap = await input.port.snapshot()
  const turn = new Turn(input, snap, state)
  await turn.run()
  return turn.output()
}

class Turn {
  parts: ChatPart[] = []
  events: TurnEvent[] = []
  intent = 'unknown'
  handoff?: { reason: HandoffReason }
  booked?: { appointmentId: string; reference: string }
  grant: string[] = []
  usedModel = false
  today: DateKey
  locale: Locale

  constructor(
    readonly input: TurnInput,
    readonly snap: Snapshot,
    readonly state: AssistantState,
  ) {
    this.today = dateKeyOf(input.now)
    this.locale = state.locale ?? 'mn'
    const now = input.now.getTime()
    state.verified = (state.verified ?? []).filter((v) => Date.parse(v.until) > now)
    if (state.draft && Date.parse(state.draft.expiresAt) <= now) this.expiredDraft = true
    if (state.change && Date.parse(state.change.expiresAt) <= now) state.change = undefined
  }

  expiredDraft = false
  /** A phone number typed in this message while managing a booking. */
  typedPhone?: string

  // ---- output helpers ---------------------------------------------------------------------

  t(mn: string, en: string) {
    return say(this.locale, mn, en)
  }
  say(text: string) {
    this.parts.push({ type: 'text', text })
  }
  quick(options: QuickReply[]) {
    if (options.length) this.parts.push({ type: 'quick_replies', options: options.slice(0, 8) })
  }
  event(kind: string, level: TurnEvent['level'] = 'info', extra: Omit<TurnEvent, 'kind' | 'level'> = {}) {
    this.events.push({ kind, level, ...extra })
  }
  output(): TurnOutput {
    if (!this.parts.length) this.fallbackText()
    this.state.locale = this.locale
    return {
      parts: this.parts,
      state: this.state,
      intent: this.intent,
      events: this.events,
      handoff: this.handoff,
      booked: this.booked,
      grantReferences: this.grant,
      usedModel: this.usedModel,
    }
  }

  service(id: string): PortService | undefined {
    return this.snap.services.find((s) => s.id === id)
  }
  serviceNames(ids: string[]) {
    return ids
      .map((id) => this.service(id)?.name)
      .filter(Boolean)
      .join(' + ')
  }
  staffName(id: string | null | undefined) {
    return id ? (this.snap.staff.find((s) => s.id === id)?.name ?? '') : ''
  }
  menu(): QuickReply[] {
    return [
      {
        label: this.t('Үйлчилгээ, үнэ', 'Services & prices'),
        message: this.t('Ямар үйлчилгээ байдаг вэ?', 'What services do you offer?'),
      },
      {
        label: this.t('Цаг захиалах', 'Book a time'),
        message: this.t('Цаг захиалмаар байна', 'I want to book an appointment'),
      },
      {
        label: this.t('Ажлын цаг, хаяг', 'Hours & address'),
        message: this.t('Ажлын цаг, хаяг', 'Opening hours and address'),
      },
      {
        label: this.t('Захиалгаа өөрчлөх', 'Change my booking'),
        message: this.t('Захиалгаа өөрчлөх', 'Change my booking'),
      },
    ]
  }

  // ---- entry ------------------------------------------------------------------------------

  async run() {
    const { action, text } = this.input
    this.state.turns = (this.state.turns ?? 0) + (text ? 1 : 0)
    if (action) return this.onAction(action)
    if (text) return this.onText(text)
    return this.greeting()
  }

  async onAction(a: ChatAction) {
    const s = this.state
    switch (a.type) {
      case 'hello':
        return this.greeting()
      case 'reset':
        Object.keys(s).forEach((k) => delete (s as unknown as Record<string, unknown>)[k])
        Object.assign(s, freshState())
        return this.greeting()
      case 'human':
        return this.handOver('customer_request')
      case 'pick_service': {
        if (!this.service(a.serviceId)) return this.askService()
        const b = (s.booking ??= { serviceIds: [] })
        if (s.awaiting === 'service_choice' || !b.serviceIds.length) b.serviceIds = [a.serviceId]
        else if (!b.serviceIds.includes(a.serviceId)) b.serviceIds = [a.serviceId]
        b.assumed = undefined
        s.draft = undefined
        return this.bookingFlow()
      }
      case 'pick_staff': {
        const b = (s.booking ??= { serviceIds: [] })
        b.staffId = a.staffId
        b.time = undefined
        return this.bookingFlow()
      }
      case 'pick_date':
        if (s.manage && (s.awaiting === 'manage_date' || s.awaiting === 'manage_time')) {
          s.manage.date = a.date
          s.manage.time = undefined
          return this.manageFlow()
        }
        ;(s.booking ??= { serviceIds: [] }).date = a.date
        s.booking.time = undefined
        return this.bookingFlow()
      case 'choose_slot':
        if (s.manage?.appointmentId && s.manage.intent === 'reschedule') {
          s.manage.date = a.date
          s.manage.time = a.start
          return this.manageFlow()
        }
        s.booking ??= { serviceIds: [] }
        s.booking.date = a.date
        s.booking.time = a.start
        return this.bookingFlow()
      case 'confirm_draft':
        if (s.draft?.id === a.draftId) return this.confirmDraft()
        return this.staleConfirmation(a.draftId)
      case 'cancel_draft':
        return this.dropDraft()
      case 'confirm_change':
        if (s.change?.id === a.draftId) return this.executeChange()
        this.say(
          this.t('Энэ хүсэлт хүчингүй болсон байна. Дахин эхлүүлье.', 'This request has expired. Let’s start again.'),
        )
        return
      case 'cancel_change':
        return this.dropChange()
      case 'pick_booking': {
        const v = s.verified?.find((x) => x.reference === a.reference)
        if (!s.manage || !v) return this.askReference(s.manage?.intent ?? 'status')
        s.manage.appointmentId = v.id
        return this.manageFlow()
      }
    }
  }

  async onText(text: string) {
    const s = this.state
    if (this.input.settings.englishReplies) this.locale = detectLocale(text, s.locale)
    let r = readMessage(text, this.snap, {
      today: this.today,
      expectName: s.awaiting === 'contact',
      fallbackDate: s.awaiting === 'manage_time' ? s.manage?.date : s.booking?.date,
    })
    // A bare number or hour answering "which time?" / "which day?".
    if ((s.awaiting === 'time' || s.awaiting === 'manage_time') && r.time === undefined) {
      const date = s.awaiting === 'time' ? s.booking?.date : s.manage?.date
      const hour = bareHour(text, date ? this.snap.hoursFor(date) : null)
      const offered = s.choices?.kind === 'time' ? s.choices.values.map(Number) : []
      if (hour !== undefined && (!offered.length || offered.includes(hour) || r.choice === undefined)) r.time = hour
      else if (r.choice !== undefined && offered[r.choice] !== undefined) r.time = offered[r.choice]
    }
    if (isEmptyReading(r) && this.input.models?.interpret && !(s.awaiting && /^\s*\S{1,12}\s*$/u.test(text))) {
      const proposed = await this.input.models
        .interpret({ reading: r, snapshot: this.snap, state: s, history: this.input.history, today: this.today })
        .catch(() => null)
      if (proposed) {
        r = proposed
        this.usedModel = true
      }
    }
    const intents = r.det.intents
    const infoTopics = r.det.topics.filter((t) => INFO_TOPICS.includes(t))
    const strongBooking = STRONG_BOOKING.test(r.norm) || STRONG_BOOKING.test(text.toLowerCase())
    if (!isEmptyReading(r)) s.unknownStreak = 0

    // ---- 0: safety
    if (intents.includes('human')) return this.handOver('customer_request')
    if (intents.includes('complaint')) return this.handOver('complaint')
    if (intents.includes('privacy')) return this.privacy(r)
    if (intents.includes('payment_claim')) return this.paymentClaim()

    // A beauty service the salon does not offer: say so, never substitute a nail service.
    if (r.outside && !r.services.length) return this.notOffered(r.outside)

    // ---- 1: a summary waiting for an answer
    if (s.change) {
      if (r.yes && r.time === undefined && !r.date) return this.executeChange()
      if (r.no) return this.dropChange()
      if (s.change.kind === 'reschedule' && (r.date || r.time !== undefined)) {
        s.change = undefined
        if (r.date) s.manage!.date = r.date
        s.manage!.time = r.time
        return this.manageFlow()
      }
    }
    if (s.awaiting === 'contact' && r.digits && !r.phone) {
      this.intent = 'book'
      this.say(
        this.t(
          'Утасны дугаар 8 оронтой, 5–9-өөр эхэлсэн байх ёстой. Жишээ: 9911 2233.',
          'A Mongolian phone number has 8 digits and starts with 5–9, for example 9911 2233.',
        ),
      )
      return
    }
    if (s.draft) {
      const changes =
        r.services.length || r.generic || r.date || r.time !== undefined || r.staffId !== undefined || r.phone || r.name
      if (r.yes && !changes) return this.expiredDraft ? this.refreshDraft() : this.confirmDraft()
      if (r.no && !changes) return this.dropDraft()
      if (changes && !infoTopics.length) {
        s.draft = undefined
        this.merge(r)
        return this.bookingFlow()
      }
    }

    // ---- 2: existing bookings
    const manageIntent = intents.find((i) => i === 'cancel' || i === 'reschedule' || i === 'status')
    if (manageIntent && !(s.draft && manageIntent === 'reschedule')) {
      if (!s.manage || s.manage.intent !== manageIntent) s.manage = { intent: manageIntent }
      s.booking = undefined
      s.draft = undefined
      this.mergeManage(r)
      return this.manageFlow()
    }
    if (
      s.manage &&
      s.awaiting &&
      MANAGE_STEPS.includes(s.awaiting) &&
      (r.reference ||
        r.phone ||
        r.digits ||
        r.date ||
        r.time !== undefined ||
        r.range ||
        r.choice !== undefined ||
        r.yes)
    ) {
      this.mergeManage(r)
      if (s.awaiting === 'pick_booking' && r.choice !== undefined && s.choices?.kind === 'booking') {
        const ref = s.choices.values[r.choice]
        const v = s.verified?.find((x) => x.reference === ref)
        if (v) s.manage.appointmentId = v.id
      }
      return this.manageFlow()
    }

    // ---- 3: booking
    const awaitingBooking = s.awaiting && BOOKING_STEPS.includes(s.awaiting)
    const asksInfo = infoTopics.length > 0 && !(strongBooking && !r.det.question)
    const answersStep = awaitingBooking && this.answersBookingStep(r)
    if (
      !asksInfo &&
      (intents.includes('book') ||
        answersStep ||
        ((r.date || r.time !== undefined || r.range || r.det.topics.includes('availability')) && !intents.length))
    ) {
      this.merge(r)
      return this.bookingFlow()
    }

    // ---- 4: information
    if (asksInfo) {
      if (s.booking || r.date || r.time !== undefined) this.remember(r)
      // "Хулан ямар үйлчилгээ хийдэг вэ?" is about that specialist, not the whole list.
      const topics =
        r.staffNamed.length && infoTopics.some((x) => x === 'services' || x === 'staff')
          ? (['staff'] as Topic[])
          : infoTopics
      // "Маникюр хэд вэ? Маргааш сул цаг байна уу?": the price, then that day's free times
      // (or which service, when none is named yet).
      // Mid-booking, naming another service with its free-time question starts over with that service.
      const named = r.services.length > 0 || Boolean(r.generic)
      const current = s.booking?.serviceIds ?? []
      const switching =
        Boolean(awaitingBooking) && named && !(r.services.length && r.services.every((id) => current.includes(id)))
      const wantsTimes = r.det.topics.includes('availability') && !s.manage && (!awaitingBooking || switching)
      // The choice list below already shows each kind with its price, so it is not listed twice.
      const choiceFollows = wantsTimes && !r.services.length && Boolean(r.generic && !r.generic.canonical)
      const shown = choiceFollows ? topics.filter((x) => x !== 'price') : topics
      if (shown.length) await this.info(r, shown, { askService: !wantsTimes })
      if (wantsTimes) {
        this.merge(r)
        return this.bookingFlow()
      }
      if (awaitingBooking) this.reprompt()
      return
    }
    if (r.services.length || r.generic) return this.serviceCard(r)
    if (r.staffNamed.length) return this.staffInfo(r)
    if (intents.includes('identity')) return this.identity()
    if (intents.includes('greeting')) return this.greeting()
    if (intents.includes('thanks')) {
      this.intent = 'thanks'
      this.say(this.t('Зүгээр ээ. Өөр асуух зүйл байвал бичээрэй.', 'You’re welcome. Ask me anything else any time.'))
      return
    }
    if (intents.includes('bye')) {
      this.intent = 'bye'
      this.say(this.t('Баяртай! Сайхан өдөр өнгөрүүлээрэй.', 'Goodbye — have a lovely day!'))
      return
    }
    if (r.yes || r.no) {
      this.intent = 'smalltalk'
      this.say(this.t('Юугаар туслах вэ?', 'How can I help?'))
      this.quick(this.menu())
      return
    }
    if (intents.includes('book')) {
      this.merge(r)
      return this.bookingFlow()
    }

    // ---- 4b / 5 / 6: the owner's knowledge, a model answer, or an honest "I don't know"
    const known = matchKnowledge(text, this.snap.knowledge)
    if (known) {
      this.intent = 'knowledge'
      this.event('knowledge_answer', 'info', { detail: { topic: (known.item as { topic?: string }).topic } })
      this.say(known.item.answer)
      return
    }
    return this.unknown(text)
  }

  answersBookingStep(r: Reading): boolean {
    // Contact details given early are kept; the pending question is then asked again.
    if (r.phone || r.name) return true
    switch (this.state.awaiting) {
      case 'service':
      case 'service_choice':
        return Boolean(r.services.length || r.generic || r.choice !== undefined)
      case 'date':
        return Boolean(r.date || r.choice !== undefined || r.time !== undefined || r.staffId !== undefined)
      case 'time':
        return Boolean(
          r.time !== undefined || r.range || r.date || r.choice !== undefined || r.staffId !== undefined || r.no,
        )
      case 'contact':
        return Boolean(r.name || r.phone || r.yes || r.time !== undefined || r.date)
      default:
        return false
    }
  }

  // ---- booking memory -----------------------------------------------------------------------

  /** Keeps what a message said about a booking without asking anything (used beside an info answer). */
  remember(r: Reading) {
    const b = (this.state.booking ??= { serviceIds: [] })
    if (r.services.length) b.serviceIds = r.services.slice(0, this.snap.salon.maxServicesPerBooking)
    if (r.date) b.date = r.date
    if (r.time !== undefined) b.time = r.time
    if (r.staffId !== undefined) b.staffId = r.staffId
    this.state.focus = { ...this.state.focus, ...(r.services.length ? { serviceIds: r.services } : {}) }
  }

  merge(r: Reading) {
    const s = this.state
    const b = (s.booking ??= { serviceIds: [] })
    const max = this.snap.salon.maxServicesPerBooking
    if (s.awaiting === 'service_choice' && r.choice !== undefined && s.choices?.kind === 'service') {
      const id = s.choices.values[r.choice]
      if (id) b.serviceIds = [id]
    } else if (r.services.length) {
      b.serviceIds =
        r.det.adds && b.serviceIds.length
          ? [...new Set([...b.serviceIds, ...r.services])].slice(0, max)
          : r.services.slice(0, max)
      b.assumed = undefined
    } else if (r.generic) {
      const scoped = s.awaiting === 'service_choice' && s.choices?.kind === 'service' ? s.choices.values : null
      // "Маникюр" while choosing between the listed services: its usual meaning, when it is one of them.
      if (scoped && r.generic.canonical && scoped.includes(r.generic.canonical)) {
        b.serviceIds = [r.generic.canonical]
        b.assumed = { serviceId: r.generic.canonical, label: r.generic.label, told: false }
      }
      if (!scoped) {
        if (r.generic.canonical) {
          b.serviceIds =
            r.det.adds && b.serviceIds.length
              ? [...new Set([...b.serviceIds, r.generic.canonical])].slice(0, max)
              : [r.generic.canonical]
          b.assumed = { serviceId: r.generic.canonical, label: r.generic.label, told: false }
        } else if (!b.serviceIds.length || !r.det.adds) {
          b.serviceIds = []
          s.choices = { kind: 'service', values: r.generic.candidates }
          s.awaiting = 'service_choice'
        }
      }
    }
    if (s.awaiting === 'date' && r.choice !== undefined && s.choices?.kind === 'date' && !r.date) {
      const d = s.choices.values[r.choice]
      if (d) {
        b.date = d
        b.time = undefined
      }
    }
    if (r.staffId !== undefined) b.staffId = r.staffId
    if (r.date && r.date !== b.date) {
      b.date = r.date
      if (r.time === undefined) b.time = undefined
    }
    if (r.time !== undefined) b.time = r.time
    if (r.range) b.range = r.range
    if (r.name) b.name = r.name
    if (r.phone) b.phone = r.phone
    if (b.serviceIds.length) s.focus = { ...s.focus, serviceIds: b.serviceIds }
  }

  // ---- booking flow -------------------------------------------------------------------------

  async bookingFlow(): Promise<void> {
    const s = this.state
    const b = (s.booking ??= { serviceIds: [] })
    this.intent = 'book'
    if (!b.serviceIds.length) {
      if (s.awaiting === 'service_choice' && s.choices?.kind === 'service')
        return this.askServiceChoice(s.choices.values)
      return this.askService()
    }
    const services = b.serviceIds.map((id) => this.service(id)).filter((x): x is PortService => Boolean(x))
    const offline = services.find((x) => !x.onlineBookable)
    if (offline) {
      this.say(
        this.t(
          `${offline.name}-г онлайнаар захиалах боломжгүй — салон руу ${phone(this.snap.salon.phone)} залгаж цаг товлоно уу.`,
          `${offline.name} can’t be booked online — please call the salon at ${phone(this.snap.salon.phone)}.`,
        ),
      )
      s.awaiting = undefined
      return
    }
    if (b.staffId) {
      const staff = this.snap.staff.find((x) => x.id === b.staffId)
      if (!staff || !b.serviceIds.every((id) => staff.serviceIds.includes(id))) {
        const eligible = this.snap.staff.filter((x) => b.serviceIds.every((id) => x.serviceIds.includes(id)))
        this.say(
          this.t(
            `${staff?.name ?? 'Энэ'} мастер ${this.serviceNames(b.serviceIds)} хийдэггүй. Хийдэг мастерууд: ${eligible.map((x) => x.name).join(', ')}.`,
            `${staff?.name ?? 'That specialist'} doesn’t do ${this.serviceNames(b.serviceIds)}. Specialists who do: ${eligible.map((x) => x.name).join(', ')}.`,
          ),
        )
        b.staffId = undefined
      }
    }
    this.tellAssumption(b)
    if (!b.date) return this.askDate()
    const plan = await this.input.port.day(b.serviceIds, b.staffId ?? null, b.date)
    if (plan.state !== 'open' || !plan.hours) return this.dayNotOpen(plan)
    if (b.time === undefined) return this.showSlots(plan, b.serviceIds, b.staffId ?? null, b.range)
    const slot = plan.slots.find((x) => x.start === b.time)
    if (!slot) return this.timeNotFree(plan, b.time, b.serviceIds, b.staffId ?? null)
    if (!b.name || !b.phone) return this.askContact(plan.date, slot)
    return this.prepareDraft(plan.date, slot)
  }

  tellAssumption(b: BookingMemory) {
    if (!b.assumed || b.assumed.told) return
    const svc = this.service(b.assumed.serviceId)
    if (!svc) return
    b.assumed.told = true
    this.say(
      this.t(
        `«${b.assumed.label}» гэснийг ${svc.name} (${price(svc, 'mn')}, ${duration(svc.durationMinutes, 'mn')}) гэж ойлголоо — өөр төрөл бол хэлээрэй.`,
        `I’ve taken “${b.assumed.label}” as ${svc.name} (${price(svc, 'en')}, ${duration(svc.durationMinutes, 'en')}) — tell me if you meant another kind.`,
      ),
    )
  }

  askService() {
    const s = this.state
    const b = s.booking
    const when = b?.date
      ? `${dayLabel(b.date, this.today, this.locale)}${b.time !== undefined ? ` ${clock(b.time)}` : ''}`
      : b?.time !== undefined
        ? clock(b.time)
        : ''
    s.awaiting = 'service'
    s.choices = undefined
    this.say(
      this.t(
        `${when ? `${when[0].toLocaleUpperCase('mn')}${when.slice(1)}${b?.time !== undefined ? '-д' : ''} ямар` : 'Ямар'} үйлчилгээ хийлгэх вэ?`,
        `Which service would you like${when ? ` (${when})` : ''}?`,
      ),
    )
    const popular = POPULAR.map((slug) => this.snap.services.find((x) => x.slug === slug && x.onlineBookable)).filter(
      (x): x is PortService => Boolean(x),
    )
    this.quick(
      popular.map((x) => ({
        label: `${x.name} · ${price(x, this.locale)}`,
        action: { type: 'pick_service', serviceId: x.id },
      })),
    )
  }

  askServiceChoice(ids: string[]) {
    const s = this.state
    const list = ids.map((id) => this.service(id)).filter((x): x is PortService => Boolean(x))
    s.awaiting = 'service_choice'
    s.choices = { kind: 'service', values: list.map((x) => x.id) }
    this.say(
      [
        this.t(
          `${s.booking?.date ? `${fullDayLabel(s.booking.date, this.today, this.locale).replace(/^./u, (c) => c.toLocaleUpperCase('mn'))}: сонгосон төрлийн сул цагийг харуулъя. ` : ''}Хэд хэдэн төрөл бий — алийг нь хийлгэх вэ?`,
          `${s.booking?.date ? `${fullDayLabel(s.booking.date, this.today, this.locale)}: I'll show the free times for the one you pick. ` : ''}There are a few kinds — which one would you like?`,
        ),
        ...list.map((x, i) => `${i + 1}. ${serviceLine(x, this.locale)}`),
      ].join('\n'),
    )
    this.quick(list.map((x) => ({ label: x.name, action: { type: 'pick_service', serviceId: x.id } })))
  }

  async askDate(intro?: string) {
    const s = this.state
    const b = s.booking!
    const days = await this.input.port.openDays(b.serviceIds, b.staffId ?? null, this.today, 6)
    s.awaiting = 'date'
    s.choices = { kind: 'date', values: days.map((d) => d.date) }
    const names = this.serviceNames(b.serviceIds)
    if (!days.length) {
      this.say(
        this.t(
          `${intro ? `${intro} ` : ''}Ойрын хугацаанд ${names}-д сул цаг олдсонгүй${b.staffId ? ` (${this.staffName(b.staffId)} мастер)` : ''}. Өөр мастер сонгох эсвэл ${phone(this.snap.salon.phone)} руу залгаарай.`,
          `${intro ? `${intro} ` : ''}No free times for ${names} in the coming weeks. Try another specialist or call ${phone(this.snap.salon.phone)}.`,
        ),
      )
      return
    }
    this.say(
      `${intro ? `${intro}\n` : ''}${this.t(
        `${names} — аль өдөр тохирох вэ? Сул цагтай ойрын өдрүүд:`,
        `${names} — which day suits you? The nearest days with free times:`,
      )}`,
    )
    this.quick(
      days.map((d) => ({
        label: `${dayLabel(d.date, this.today, this.locale)} (${d.slotCount})`,
        action: { type: 'pick_date', date: d.date },
      })),
    )
  }

  async dayNotOpen(plan: DayPlan, manage = false) {
    const day = fullDayLabel(plan.date, this.today, this.locale)
    const reason =
      plan.state === 'closed'
        ? this.t(
            `${day} салон амарна${plan.special ? ` (${plan.special})` : ''}.`,
            `The salon is closed on ${day}${plan.special ? ` (${plan.special})` : ''}.`,
          )
        : plan.state === 'beyond'
          ? this.t(
              `${day} хэт хол байна — онлайнаар ${this.snap.salon.maxAdvanceDays} хоногийн дотор захиална.`,
              `${day} is too far ahead — online booking is open ${this.snap.salon.maxAdvanceDays} days ahead.`,
            )
          : this.t('Энэ өдөр өнгөрсөн байна.', 'That day has already passed.')
    if (manage) {
      this.state.manage!.date = undefined
      this.state.manage!.time = undefined
      return this.askManageDate(reason)
    }
    const b = this.state.booking!
    b.date = undefined
    b.time = undefined
    return this.askDate(reason)
  }

  slotChoices(plan: DayPlan, range?: TimeRange) {
    let slots = plan.slots
    if (range) {
      const inRange = slots.filter(
        (x) => (range.from === undefined || x.start >= range.from) && (range.to === undefined || x.start < range.to),
      )
      if (inRange.length) slots = inRange
    }
    if (slots.length > 16) {
      // Spread the offer over the day: every slot on the hour, then the rest.
      const onHour = slots.filter((x) => x.start % 60 === 0)
      slots = (onHour.length >= 6 ? onHour : slots).slice(0, 16)
    }
    return slots
  }

  showSlots(plan: DayPlan, serviceIds: string[], staffId: string | null, range?: TimeRange, manage = false) {
    const s = this.state
    const day = fullDayLabel(plan.date, this.today, this.locale)
    const names = this.serviceNames(serviceIds)
    if (!plan.slots.length) {
      const msg = this.t(`${day} ${names}-д сул цаг үлдсэнгүй.`, `There are no free times for ${names} on ${day}.`)
      if (manage) {
        s.manage!.date = undefined
        return this.askManageDate(msg)
      }
      s.booking!.date = undefined
      return this.askDate(msg)
    }
    const slots = this.slotChoices(plan, range)
    s.awaiting = manage ? 'manage_time' : 'time'
    s.choices = { kind: 'time', values: slots.map((x) => String(x.start)) }
    const staffHint =
      !manage &&
      !staffId &&
      this.snap.staff.filter((x) => serviceIds.every((id) => x.serviceIds.includes(id))).length > 1
        ? this.t(' Тодорхой мастер сонгох бол нэрийг нь бичээрэй.', ' To choose a specialist, write their name.')
        : ''
    this.say(
      this.t(
        `${day}, ${names}${staffId ? ` (${this.staffName(staffId)})` : ''} — сул цагууд:${staffHint}`,
        `${day}, ${names}${staffId ? ` with ${this.staffName(staffId)}` : ''} — free times:${staffHint}`,
      ),
    )
    this.parts.push({
      type: 'slots',
      date: plan.date,
      dateLabel: day,
      serviceLabel: names,
      slots: slots.map((x) => ({ start: x.start, label: clock(x.start) })),
    })
  }

  async timeNotFree(
    plan: DayPlan,
    time: number,
    serviceIds: string[],
    staffId: string | null,
    opts: { manage?: boolean; durationMinutes?: number } = {},
  ) {
    const s = this.state
    const manage = Boolean(opts.manage)
    const day = fullDayLabel(plan.date, this.today, this.locale)
    const minutes =
      opts.durationMinutes ?? (await this.input.port.quote(serviceIds, staffId).catch(() => null))?.durationMinutes ?? 0
    const hours = plan.hours!
    let why: string
    if (time < hours.opensAt)
      why = this.t(
        `${day} салон ${clock(hours.opensAt)}-с нээгдэнэ.`,
        `On ${day} the salon opens at ${clock(hours.opensAt)}.`,
      )
    else if (time >= hours.closesAt || (minutes && time + minutes > hours.closesAt))
      why = this.t(
        `${this.serviceNames(serviceIds)} ${duration(minutes, 'mn')} үргэлжилдэг тул ${clock(time)}-с эхэлбэл салон ${clock(hours.closesAt)}-д хаахаас өмнө амжихгүй.`,
        `${this.serviceNames(serviceIds)} takes ${duration(minutes, 'en')}, so a ${clock(time)} start would not finish before the salon closes at ${clock(hours.closesAt)}.`,
      )
    else
      why = this.t(
        `${day} ${clock(time)} сул биш байна${staffId ? ` (${this.staffName(staffId)} мастер энэ цагт завгүй эсвэл завсарлагатай)` : ''}.`,
        `${clock(time)} on ${day} is not available${staffId ? ` with ${this.staffName(staffId)}` : ''}.`,
      )
    if (manage) s.manage!.time = undefined
    else s.booking!.time = undefined
    if (!plan.slots.length) {
      if (manage) {
        s.manage!.date = undefined
        return this.askManageDate(why)
      }
      s.booking!.date = undefined
      return this.askDate(why)
    }
    const nearest = [...plan.slots]
      .sort((a, b) => Math.abs(a.start - time) - Math.abs(b.start - time))
      .slice(0, 4)
      .sort((a, b) => a.start - b.start)
    s.awaiting = manage ? 'manage_time' : 'time'
    s.choices = { kind: 'time', values: nearest.map((x) => String(x.start)) }
    this.say(`${why}\n${this.t('Ойрын сул цагууд:', 'The nearest free times:')}`)
    this.parts.push({
      type: 'slots',
      date: plan.date,
      dateLabel: day,
      serviceLabel: this.serviceNames(serviceIds),
      slots: nearest.map((x) => ({ start: x.start, label: clock(x.start) })),
    })
    this.event('time_unavailable', 'info', { detail: { manage } })
  }

  staffOnSlot(staffId: string | null | undefined, slot: { staffIds: string[] }) {
    if (staffId) return this.t(` (мастер ${this.staffName(staffId)})`, ` with ${this.staffName(staffId)}`)
    const names = slot.staffIds.map((id) => this.staffName(id)).filter(Boolean)
    if (names.length === 1) return this.t(` (мастер ${names[0]})`, ` with ${names[0]}`)
    if (names.length === 2) return this.t(` (${names.join(', ')} мастерууд сул)`, ` (free: ${names.join(', ')})`)
    return names.length ? this.t(` (${names.length} мастер сул)`, ` (${names.length} specialists free)`) : ''
  }

  askContact(date: DateKey, slot: { start: number; staffIds: string[] }) {
    const s = this.state
    const b = s.booking!
    s.awaiting = 'contact'
    s.choices = undefined
    const missing = !b.name && !b.phone ? 'both' : !b.name ? 'name' : 'phone'
    const ask =
      missing === 'both'
        ? this.t(
            'Захиалга бүртгэхэд нэр, утасны дугаараа бичнэ үү.',
            'To book it, please send your name and phone number.',
          )
        : missing === 'name'
          ? this.t('Захиалгыг хэний нэр дээр бүртгэх вэ? Нэрээ бичнэ үү.', 'What name should I put the booking under?')
          : this.t('Утасны дугаараа бичнэ үү (8 орон).', 'Please send your phone number (8 digits).')
    const hint =
      this.snap.salon.isDemo && !s.demoHintShown
        ? this.t(' Демо: жишээ нэр, дугаар бичиж болно.', ' (Demo: a sample name and number are fine.)')
        : ''
    if (hint) s.demoHintShown = true
    this.say(
      `${this.t(
        `${fullDayLabel(date, this.today, 'mn')} ${clock(slot.start)}-д ${this.serviceNames(b.serviceIds)} хийх цаг сул байна${this.staffOnSlot(b.staffId, slot)}.`,
        `${clock(slot.start)} on ${fullDayLabel(date, this.today, 'en')} is free for ${this.serviceNames(b.serviceIds)}${this.staffOnSlot(b.staffId, slot)}.`,
      )} ${ask}${hint}`,
    )
  }

  async prepareDraft(date: DateKey, slot: { start: number; staffIds: string[] }) {
    const s = this.state
    const b = s.booking!
    const quote = await this.input.port.quote(b.serviceIds, b.staffId ?? null)
    const staffName = b.staffId
      ? this.staffName(b.staffId)
      : slot.staffIds.length === 1
        ? this.staffName(slot.staffIds[0])
        : this.t(
            `Аль ч мастер (${slot.staffIds.map((id) => this.staffName(id)).join(', ')}-аас)`,
            `Any specialist (${slot.staffIds.map((id) => this.staffName(id)).join(', ')})`,
          )
    const statusAfter =
      quote.deposit > 0
        ? `${STATUS_LABELS.awaiting_deposit} (${formatMoney(quote.deposit)})`
        : this.snap.salon.confirmationMode === 'auto'
          ? STATUS_LABELS.confirmed
          : STATUS_LABELS.pending
    const summary: DraftSummary = {
      services: quote.lines.map((l) => ({
        name: l.name,
        price: l.price,
        from: l.from,
        durationMinutes: l.durationMinutes,
        addons: [],
      })),
      staffName,
      dateLabel: fullDayLabel(date, this.today, this.locale),
      timeRange: `${clock(slot.start)}–${clock(slot.start + quote.durationMinutes)}`,
      durationMinutes: quote.durationMinutes,
      total: quote.total,
      hasFromPrice: quote.hasFromPrice,
      deposit: quote.deposit,
      customerName: b.name!,
      customerPhone: phone(b.phone!),
      statusAfter,
    }
    const id = randomUUID()
    s.draft = {
      id,
      serviceIds: b.serviceIds,
      staffId: b.staffId ?? null,
      date,
      start: slot.start,
      name: b.name!,
      phone: b.phone!,
      expiresAt: new Date(this.input.now.getTime() + DRAFT_MINUTES * 60_000).toISOString(),
    }
    s.awaiting = 'confirm'
    s.choices = undefined
    this.intent = 'book'
    this.say(this.t('Захиалгын мэдээллээ шалгана уу:', 'Please check your booking:'))
    this.parts.push({ type: 'draft', draftId: id, summary })
    this.say(
      this.t(
        'Зөв бол «Тийм» гэж бичих эсвэл «Баталгаажуулах» товчийг дарна уу — түүнээс өмнө захиалга үүсэхгүй.',
        'If it’s right, reply “yes” or press Confirm — nothing is booked before that.',
      ),
    )
  }

  async refreshDraft() {
    const d = this.state.draft!
    this.state.draft = undefined
    const b = (this.state.booking ??= { serviceIds: d.serviceIds })
    Object.assign(b, {
      serviceIds: d.serviceIds,
      staffId: d.staffId,
      date: d.date,
      time: d.start,
      name: d.name,
      phone: d.phone,
    })
    this.say(
      this.t(
        'Хураангуйн хугацаа дууссан тул сул цагийг дахин шалгалаа.',
        'The summary expired, so I checked the time again.',
      ),
    )
    return this.bookingFlow()
  }

  staleConfirmation(draftId: string) {
    const done = this.state.done?.find((d) => d.draftId === draftId)
    this.intent = 'book'
    if (done) {
      this.say(
        this.t(
          `Энэ захиалга аль хэдийн бүртгэгдсэн: ${done.reference}.`,
          `This booking is already made: ${done.reference}.`,
        ),
      )
      return
    }
    this.say(
      this.t(
        'Энэ хураангуй хүчингүй болсон байна. Цагаа дахин сонгоё.',
        'This summary is no longer valid. Let’s pick the time again.',
      ),
    )
  }

  async confirmDraft() {
    const s = this.state
    const d = s.draft!
    this.intent = 'book'
    if (this.expiredDraft) return this.refreshDraft()
    try {
      const outcome = await this.input.port.book({
        serviceIds: d.serviceIds,
        staffId: d.staffId,
        date: d.date,
        start: d.start,
        name: d.name,
        phone: d.phone,
      })
      s.draft = undefined
      s.booking = undefined
      s.awaiting = undefined
      s.choices = undefined
      s.done = [...(s.done ?? []), { draftId: d.id, reference: outcome.reference }].slice(-5)
      if (!outcome.simulated) {
        s.verified = [
          ...(s.verified ?? []),
          { id: outcome.appointmentId, reference: outcome.reference, until: this.verifiedUntil() },
        ]
        this.grant.push(outcome.reference)
        this.booked = { appointmentId: outcome.appointmentId, reference: outcome.reference }
      }
      this.event(outcome.simulated ? 'booking_simulated' : 'booking_created', 'info', {
        appointmentId: outcome.simulated ? undefined : outcome.appointmentId,
        detail: { status: outcome.status, services: d.serviceIds.length, deposit: outcome.deposit },
      })
      this.parts.push({
        type: 'booking',
        reference: outcome.reference,
        status: outcome.status,
        statusLabel: outcome.statusLabel,
        explanation: outcome.explanation,
        link: outcome.manageLink,
      })
      const lines = [
        this.t(
          `Захиалга бүртгэгдлээ: ${outcome.reference}, ${fullDayLabel(outcome.date, this.today, 'mn')} ${clock(outcome.start)}, мастер ${outcome.staffName}.`,
          `Booked: ${outcome.reference}, ${fullDayLabel(outcome.date, this.today, 'en')} at ${clock(outcome.start)} with ${outcome.staffName}.`,
        ),
      ]
      if (outcome.status === 'awaiting_deposit')
        lines.push(
          this.t(
            `${formatMoney(outcome.deposit)} урьдчилгааг ${this.snap.salon.holdMinutes} минутын дотор «Захиалгаа харах» хуудаснаас төлбөл цаг баталгаажна.${this.snap.salon.isDemo ? ' Демо: QPay-н симуляц, бодит мөнгө авахгүй.' : ''}`,
            `Pay the ${formatMoney(outcome.deposit)} deposit within ${this.snap.salon.holdMinutes} minutes on the booking page to confirm it.${this.snap.salon.isDemo ? ' Demo: QPay is simulated, no real money is taken.' : ''}`,
          ),
        )
      this.say(lines.join('\n'))
      if (outcome.simulated)
        this.parts.push({
          type: 'notice',
          text: this.t(
            'Туршилтын горим: захиалгыг сервер бүрэн шалгасан ч хадгалаагүй.',
            'Test mode: the server validated the booking but did not save it.',
          ),
        })
    } catch (err) {
      if (!(err instanceof ServiceError)) throw err
      s.draft = undefined
      this.event('booking_failed', 'warning', { detail: { code: err.code } })
      const b = (s.booking ??= { serviceIds: d.serviceIds })
      Object.assign(b, {
        serviceIds: d.serviceIds,
        staffId: d.staffId,
        date: d.date,
        name: d.name,
        phone: d.phone,
        time: undefined,
      })
      const alts = (
        (err.details as { alternatives?: { date: string; start: number }[] } | undefined)?.alternatives ?? []
      ).slice(0, 4)
      this.say(err.message)
      if (alts.length) {
        s.awaiting = 'time'
        s.choices = { kind: 'time', values: alts.filter((a) => a.date === d.date).map((a) => String(a.start)) }
        this.quick(
          alts.map((a) => ({
            label: `${dayLabel(a.date, this.today, this.locale)} ${clock(a.start)}`,
            action: { type: 'choose_slot', date: a.date, start: a.start },
          })),
        )
      } else s.awaiting = 'time'
    }
  }

  dropDraft() {
    const s = this.state
    s.draft = undefined
    s.awaiting = undefined
    if (s.booking) s.booking.time = undefined
    this.intent = 'book'
    this.say(
      this.t(
        'За, захиалга үүсгэсэнгүй. Өөр цаг эсвэл үйлчилгээ сонгох уу?',
        'Okay, nothing was booked. Would you like another time or service?',
      ),
    )
    this.quick([
      { label: this.t('Өөр цаг', 'Another time'), message: this.t('Өөр цаг харуулаач', 'Show other times') },
      {
        label: this.t('Үйлчилгээ, үнэ', 'Services & prices'),
        message: this.t('Ямар үйлчилгээ байдаг вэ?', 'What services do you offer?'),
      },
    ])
  }

  reprompt() {
    const s = this.state
    const b = s.booking
    switch (s.awaiting) {
      case 'service':
      case 'service_choice':
        this.say(this.t('Ямар үйлчилгээ хийлгэх вэ?', 'Which service would you like?'))
        break
      case 'date':
        this.say(this.t('Аль өдөр тохирох вэ?', 'Which day suits you?'))
        break
      case 'time':
        this.say(this.t('Аль цаг тохирох вэ?', 'Which time suits you?'))
        break
      case 'contact':
        this.say(
          this.t(
            'Захиалгаа үргэлжлүүлэх бол нэр, утасны дугаараа бичнэ үү.',
            'To continue the booking, send your name and phone number.',
          ),
        )
        break
      case 'confirm':
        if (s.draft && b)
          this.say(
            this.t(
              'Захиалгын хураангуй таны «Тийм» хариуг хүлээж байна.',
              'The booking summary is waiting for your “yes”.',
            ),
          )
        break
    }
  }

  verifiedUntil() {
    return new Date(this.input.now.getTime() + VERIFIED_HOURS * 3_600_000).toISOString()
  }

  // ---- existing bookings ----------------------------------------------------------------------

  mergeManage(r: Reading) {
    const m = this.state.manage
    if (!m) return
    if (r.reference && r.reference !== m.reference) {
      m.reference = r.reference
      m.appointmentId = this.state.verified?.find((v) => v.reference === r.reference)?.id
    }
    if (r.date) {
      m.date = r.date
      if (r.time === undefined) m.time = undefined
    }
    if (r.time !== undefined) m.time = r.time
    if (r.range) m.range = r.range
    if (
      this.state.awaiting === 'manage_date' &&
      r.choice !== undefined &&
      this.state.choices?.kind === 'date' &&
      !r.date
    ) {
      const d = this.state.choices.values[r.choice]
      if (d) m.date = d
    }
    this.typedPhone = r.phone ?? r.digits
  }

  askReference(intent: 'cancel' | 'reschedule' | 'status', withPhone = false) {
    const s = this.state
    s.manage = { ...(s.manage ?? { intent }), intent, reference: undefined, appointmentId: undefined }
    s.awaiting = 'reference'
    s.choices = undefined
    const ask =
      intent === 'cancel'
        ? this.t(
            'Цуцлах захиалгынхаа дугаарыг (SV-XXXXXX) бичнэ үү.',
            'Please send the booking reference (SV-XXXXXX) you want to cancel.',
          )
        : intent === 'reschedule'
          ? this.t(
              'Цагийг нь өөрчлөх захиалгын дугаарыг (SV-XXXXXX) бичнэ үү.',
              'Please send the booking reference (SV-XXXXXX) you want to move.',
            )
          : this.t('Захиалгын дугаараа (SV-XXXXXX) бичнэ үү.', 'Please send your booking reference (SV-XXXXXX).')
    this.say(
      `${withPhone ? this.t('Аюулгүй байдлын үүднээс утасны дугаар дангаараа хангалтгүй. ', 'For your security a phone number alone is not enough. ') : ''}${ask} ${this.t(
        'Дугаар нь захиалга үүсгэхэд ирсэн мессеж эсвэл захиалгын хуудсанд бий.',
        'It is in the booking confirmation or on the booking page.',
      )}`,
    )
  }

  async manageFlow(): Promise<void> {
    const s = this.state
    const m = s.manage!
    this.intent = m.intent
    const typedPhone = this.typedPhone
    if (!m.appointmentId) {
      if (m.reference && typedPhone) {
        const ok = await this.verify(m.reference, typedPhone)
        if (!ok) return
      } else if (m.reference) {
        s.awaiting = 'phone'
        this.say(
          this.t(
            `${m.reference} захиалгыг баталгаажуулахын тулд тухайн захиалгад бүртгэлтэй утасны дугаараа бичнэ үү.`,
            `To confirm it’s yours, please send the phone number registered on ${m.reference}.`,
          ),
        )
        return
      } else {
        const mine = await this.myActiveBookings()
        if (mine.length === 1) m.appointmentId = mine[0].id
        else if (mine.length > 1) {
          s.awaiting = 'pick_booking'
          s.choices = { kind: 'booking', values: mine.map((v) => v.reference) }
          this.say(this.t('Аль захиалгыг хэлж байна вэ?', 'Which booking do you mean?'))
          this.quick(
            mine.map((v) => ({
              label: `${v.reference} · ${dayLabel(v.date, this.today, this.locale)} ${clock(v.start)}`,
              action: { type: 'pick_booking', reference: v.reference },
            })),
          )
          return
        } else return this.askReference(m.intent, Boolean(typedPhone))
      }
    }
    const view = await this.input.port.getBooking(m.appointmentId!)
    if (!view) {
      m.appointmentId = undefined
      return this.askReference(m.intent)
    }
    if (m.intent === 'status') return this.showStatus(view)
    if (m.intent === 'cancel') return this.startCancel(view)
    return this.rescheduleFlow(view)
  }

  async myActiveBookings(): Promise<BookingView[]> {
    const out: BookingView[] = []
    for (const v of this.state.verified ?? []) {
      const view = await this.input.port.getBooking(v.id)
      if (view && ACTIVE_STATUSES.has(view.status) && view.startsAt > this.input.now) out.push(view)
    }
    return out
  }

  async verify(reference: string, typedPhone: string): Promise<boolean> {
    const s = this.state
    const m = s.manage!
    let view: BookingView | null
    try {
      view = await this.input.port.findBooking(reference, typedPhone)
    } catch (err) {
      if (err instanceof ServiceError) {
        this.say(err.message)
        this.event('verify_rate_limited', 'warning')
        return false
      }
      throw err
    }
    if (!view) {
      m.failures = (m.failures ?? 0) + 1
      // The reference stays, so a corrected phone number alone can be tried again — up to the limit.
      if (m.failures >= MAX_FAILED_VERIFICATIONS) {
        m.reference = undefined
        s.awaiting = undefined
      } else s.awaiting = 'phone'
      this.event('verify_failed', 'warning', { detail: { attempts: m.failures } })
      this.say(
        this.t(
          'Захиалгын дугаар эсвэл утасны дугаар таарсангүй. Шалгаад дахин бичнэ үү.',
          'The booking reference or phone number did not match. Please check both and try again.',
        ) +
          (m.failures >= MAX_FAILED_VERIFICATIONS
            ? this.t(
                ` Тусламж хэрэгтэй бол ${phone(this.snap.salon.phone)} руу залгаарай.`,
                ` If you need help, call ${phone(this.snap.salon.phone)}.`,
              )
            : ''),
      )
      if (m.failures >= MAX_FAILED_VERIFICATIONS)
        this.quick([{ label: this.t('Ажилтантай холбогдох', 'Talk to staff'), action: { type: 'human' } }])
      return false
    }
    s.verified = [
      ...(s.verified ?? []).filter((v) => v.id !== view.id),
      { id: view.id, reference: view.reference, until: this.verifiedUntil() },
    ]
    this.grant.push(view.reference)
    m.appointmentId = view.id
    m.failures = 0
    this.event('verify_ok', 'info', { appointmentId: view.id })
    return true
  }

  appointmentPart(v: BookingView) {
    this.parts.push({
      type: 'appointment',
      summary: {
        reference: v.reference,
        dateLabel: fullDayLabel(v.date, this.today, this.locale),
        timeRange: `${clock(v.start)}–${clock(v.start + v.durationMinutes)}`,
        services: v.services,
        staffName: v.staffName,
        statusLabel: v.statusLabel,
      },
    })
  }

  showStatus(v: BookingView) {
    const s = this.state
    this.appointmentPart(v)
    this.say(
      this.t(
        `${v.reference}: ${fullDayLabel(v.date, this.today, 'mn')} ${clock(v.start)}, ${v.services.join(', ')}, мастер ${v.staffName}. Төлөв: ${v.statusLabel}. ${STATUS_EXPLANATIONS[v.status as AppointmentStatus] ?? ''}`,
        `${v.reference}: ${fullDayLabel(v.date, this.today, 'en')} at ${clock(v.start)}, ${v.services.join(', ')}, with ${v.staffName}. Status: ${v.statusLabel}.`,
      ).trim(),
    )
    s.manage = undefined
    s.awaiting = undefined
    if (ACTIVE_STATUSES.has(v.status) && v.startsAt > this.input.now)
      this.quick([
        {
          label: this.t('Цаг өөрчлөх', 'Move it'),
          message: this.t(`${v.reference} цагаа өөрчлөх`, `Reschedule ${v.reference}`),
        },
        { label: this.t('Цуцлах', 'Cancel it'), message: this.t(`${v.reference} цуцлах`, `Cancel ${v.reference}`) },
      ])
  }

  startCancel(v: BookingView) {
    const s = this.state
    if (!ACTIVE_STATUSES.has(v.status)) {
      this.say(
        this.t(
          `${v.reference} захиалга «${v.statusLabel}» төлөвтэй тул цуцлах боломжгүй.`,
          `${v.reference} is “${v.statusLabel}”, so it can’t be cancelled.`,
        ),
      )
      s.manage = undefined
      s.awaiting = undefined
      return
    }
    if (v.startsAt <= this.input.now) {
      this.say(
        this.t(
          'Эхэлсэн эсвэл өнгөрсөн цагийг онлайнаар цуцлах боломжгүй. Салон руу залгана уу.',
          'An appointment that has started can’t be cancelled online. Please call the salon.',
        ),
      )
      s.manage = undefined
      s.awaiting = undefined
      return
    }
    const notice = (v.startsAt.getTime() - this.input.now.getTime()) / 3_600_000
    const limit = this.snap.salon.cancellationNoticeHours
    const note = v.depositPaid
      ? notice >= limit
        ? this.t('Төлсөн урьдчилгааг тань буцаана.', 'Your paid deposit will be refunded.')
        : this.t(
            `Цаг эхлэхэд ${limit} цагаас бага хугацаа үлдсэн тул нөхцлийн дагуу урьдчилгаа буцаагдахгүй.`,
            `It is less than ${limit} hours before the start, so under the policy the deposit is not refunded.`,
          )
      : v.status === 'awaiting_deposit'
        ? this.t(
            'Урьдчилгаа төлөгдөөгүй тул нэмэлт төлбөр гарахгүй.',
            'No deposit was paid, so there is nothing to forfeit.',
          )
        : this.t(
            'Энэ захиалгад урьдчилгаа төлөөгүй, цуцлахад төлбөр гарахгүй.',
            'No deposit was paid for this booking; cancelling costs nothing.',
          )
    const id = randomUUID()
    s.change = {
      id,
      kind: 'cancel',
      appointmentId: v.id,
      reference: v.reference,
      expiresAt: new Date(this.input.now.getTime() + DRAFT_MINUTES * 60_000).toISOString(),
    }
    s.awaiting = 'change_confirm'
    this.appointmentPart(v)
    this.parts.push({
      type: 'change',
      draftId: id,
      summary: {
        kind: 'cancel',
        reference: v.reference,
        from: `${fullDayLabel(v.date, this.today, this.locale)} ${clock(v.start)}`,
        note,
      },
    })
    this.say(
      this.t(
        `${v.reference} захиалгыг цуцлах уу? «Тийм» эсвэл «Үгүй» гэж хариулна уу.`,
        `Cancel ${v.reference}? Reply “yes” or “no”.`,
      ),
    )
  }

  async askManageDate(intro?: string) {
    const s = this.state
    const m = s.manage!
    const opts = await this.input.port.rescheduleOptions(m.appointmentId!)
    if (!opts.ok) {
      this.say(opts.message)
      s.manage = undefined
      s.awaiting = undefined
      return
    }
    const days = await this.input.port.openDays(opts.serviceIds, opts.staffId, this.today, 6, m.appointmentId)
    s.awaiting = 'manage_date'
    s.choices = { kind: 'date', values: days.map((d) => d.date) }
    this.say(
      `${intro ? `${intro}\n` : ''}${
        days.length
          ? this.t(
              'Аль өдөр рүү шилжүүлэх вэ? Сул цагтай ойрын өдрүүд:',
              'Which day would you like to move it to? The nearest days with free times:',
            )
          : this.t(
              `Ойрын хугацаанд сул цаг олдсонгүй. ${phone(this.snap.salon.phone)} руу залгаарай.`,
              `No free times soon. Please call ${phone(this.snap.salon.phone)}.`,
            )
      }`,
    )
    this.quick(
      days.map((d) => ({
        label: `${dayLabel(d.date, this.today, this.locale)} (${d.slotCount})`,
        action: { type: 'pick_date', date: d.date },
      })),
    )
  }

  async rescheduleFlow(v: BookingView) {
    const s = this.state
    const m = s.manage!
    const opts = await this.input.port.rescheduleOptions(v.id)
    if (!opts.ok) {
      this.appointmentPart(v)
      this.say(opts.message)
      s.manage = undefined
      s.awaiting = undefined
      return
    }
    if (!m.date) {
      this.appointmentPart(v)
      return this.askManageDate(
        this.t(
          `${v.reference}: одоо ${fullDayLabel(v.date, this.today, 'mn')} ${clock(v.start)}, ${v.services.join(', ')}.`,
          `${v.reference} is now on ${fullDayLabel(v.date, this.today, 'en')} at ${clock(v.start)} (${v.services.join(', ')}).`,
        ),
      )
    }
    const plan = await this.input.port.day(opts.serviceIds, opts.staffId, m.date, v.id)
    if (plan.state !== 'open' || !plan.hours) return this.dayNotOpen(plan, true)
    if (m.time === undefined) return this.showSlots(plan, opts.serviceIds, opts.staffId, m.range, true)
    const slot = plan.slots.find((x) => x.start === m.time)
    if (!slot)
      return this.timeNotFree(plan, m.time, opts.serviceIds, opts.staffId, {
        manage: true,
        durationMinutes: v.durationMinutes,
      })
    const id = randomUUID()
    s.change = {
      id,
      kind: 'reschedule',
      appointmentId: v.id,
      reference: v.reference,
      date: m.date,
      start: m.time,
      expiresAt: new Date(this.input.now.getTime() + DRAFT_MINUTES * 60_000).toISOString(),
    }
    s.awaiting = 'change_confirm'
    const staff = opts.staffId ? this.staffName(opts.staffId) : slot.staffIds.map((x) => this.staffName(x)).join(', ')
    this.parts.push({
      type: 'change',
      draftId: id,
      summary: {
        kind: 'reschedule',
        reference: v.reference,
        from: `${fullDayLabel(v.date, this.today, this.locale)} ${clock(v.start)}`,
        to: `${fullDayLabel(m.date, this.today, this.locale)} ${clock(m.time)}`,
        staffName: staff,
        note: this.t(
          'Үнэ, үйлчилгээ хэвээр. Шинэ захиалгын дугаар олгогдоно.',
          'Price and services stay the same; you will get a new reference.',
        ),
      },
    })
    this.say(
      this.t(
        `${v.reference}-г ${fullDayLabel(m.date, this.today, 'mn')} ${clock(m.time)} руу шилжүүлэх үү? «Тийм» эсвэл «Үгүй» гэж хариулна уу.`,
        `Move ${v.reference} to ${fullDayLabel(m.date, this.today, 'en')} at ${clock(m.time)}? Reply “yes” or “no”.`,
      ),
    )
  }

  async executeChange() {
    const s = this.state
    const c = s.change!
    s.change = undefined
    this.intent = c.kind
    try {
      if (c.kind === 'cancel') {
        const out = await this.input.port.cancel(c.appointmentId, null)
        this.event(out.simulated ? 'cancel_simulated' : 'cancel_done', 'info', {
          appointmentId: c.appointmentId,
          detail: { depositOutcome: out.depositOutcome ?? null },
        })
        s.verified = (s.verified ?? []).filter((v) => v.id !== c.appointmentId)
        const deposit =
          out.depositOutcome === 'refund'
            ? this.t(' Төлсөн урьдчилгааг буцаана.', ' Your deposit will be refunded.')
            : out.depositOutcome === 'forfeit'
              ? this.t(
                  ' Цуцлалтын нөхцлийн дагуу урьдчилгаа буцаагдахгүй.',
                  ' Under the policy the deposit is not refunded.',
                )
              : ''
        this.say(
          this.t(`${c.reference} захиалга цуцлагдлаа.${deposit}`, `${c.reference} has been cancelled.${deposit}`),
        )
        if (out.simulated)
          this.parts.push({
            type: 'notice',
            text: this.t(
              'Туршилтын горим: цуцлалтыг шалгасан ч хадгалаагүй.',
              'Test mode: the cancellation was validated but not saved.',
            ),
          })
      } else {
        const out = await this.input.port.reschedule(c.appointmentId, c.date!, c.start!)
        this.event(out.simulated ? 'reschedule_simulated' : 'reschedule_done', 'info', {
          appointmentId: out.simulated ? c.appointmentId : out.appointmentId,
        })
        if (!out.simulated) {
          s.verified = [
            ...(s.verified ?? []).filter((v) => v.id !== c.appointmentId),
            { id: out.appointmentId, reference: out.reference, until: this.verifiedUntil() },
          ]
          this.grant.push(out.reference)
        }
        this.parts.push({
          type: 'booking',
          reference: out.reference,
          status: out.status,
          statusLabel: out.statusLabel,
          explanation: STATUS_EXPLANATIONS[out.status as AppointmentStatus] ?? '',
          link: null,
        })
        this.say(
          this.t(
            `Цаг тань ${fullDayLabel(c.date!, this.today, 'mn')} ${clock(c.start!)} болж өөрчлөгдлөө${out.staffName ? `, мастер ${out.staffName}` : ''}. Шинэ дугаар: ${out.reference}.`,
            `Your appointment is now ${fullDayLabel(c.date!, this.today, 'en')} at ${clock(c.start!)}${out.staffName ? ` with ${out.staffName}` : ''}. New reference: ${out.reference}.`,
          ),
        )
        if (out.simulated)
          this.parts.push({
            type: 'notice',
            text: this.t(
              'Туршилтын горим: цаг өөрчлөлтийг шалгасан ч хадгалаагүй.',
              'Test mode: the change was validated but not saved.',
            ),
          })
      }
      s.manage = undefined
      s.awaiting = undefined
      s.choices = undefined
    } catch (err) {
      if (!(err instanceof ServiceError)) throw err
      this.event(`${c.kind}_failed`, 'warning', { appointmentId: c.appointmentId, detail: { code: err.code } })
      this.say(err.message)
      if (c.kind === 'reschedule' && s.manage) {
        s.manage.time = undefined
        s.awaiting = 'manage_date'
      } else {
        s.manage = undefined
        s.awaiting = undefined
      }
    }
  }

  dropChange() {
    const s = this.state
    const kind = s.change?.kind ?? s.manage?.intent
    s.change = undefined
    s.manage = undefined
    s.awaiting = undefined
    this.intent = kind ?? 'manage'
    this.say(
      kind === 'reschedule'
        ? this.t('За, цаг тань хэвээр үлдлээ.', 'Okay, your appointment stays as it is.')
        : this.t('За, захиалга тань хэвээр үлдлээ — цуцлаагүй.', 'Okay, your booking stays — nothing was cancelled.'),
    )
  }

  // ---- information ------------------------------------------------------------------------------

  focusServices(r: Reading): string[] {
    if (r.services.length) return r.services
    const s = this.state
    return s.booking?.serviceIds.length ? s.booking.serviceIds : (s.focus?.serviceIds ?? [])
  }

  async info(r: Reading, topics: Topic[], opts: { askService?: boolean } = {}) {
    this.intent = `info:${topics.join('+')}`
    const lines: string[] = []
    const salon = this.snap.salon
    const focus = this.focusServices(r)
    if (r.services.length) this.state.focus = { ...this.state.focus, serviceIds: r.services }
    const list = (ids: string[]) => ids.map((id) => this.service(id)).filter((x): x is PortService => Boolean(x))
    for (const topic of topics) {
      switch (topic) {
        case 'price': {
          if (r.generic && !r.services.length) {
            lines.push(`${r.generic.label}:`, ...list(r.generic.candidates).map((x) => serviceLine(x, this.locale)))
          } else if (focus.length) {
            lines.push(...list(focus).map((x) => serviceLine(x, this.locale)))
            if (/хямд|хямдр|discount|\d{4,}\s*(?:болго|bolgo)/iu.test(r.text))
              lines.push(
                this.t(
                  'Үнэ салоны үнийн жагсаалтаар тогтсон — хямдруулах боломжгүй.',
                  'Prices follow the salon’s price list; I can’t change them.',
                ),
              )
          } else {
            lines.push(this.t('Үйлчилгээний үнэ (эхлэх үнэ):', 'Prices (starting from):'))
            for (const c of this.snap.categories) {
              const items = list(c.serviceIds)
              if (!items.length) continue
              const min = Math.min(...items.map((x) => x.price))
              lines.push(`${c.name} — ${formatMoney(min)}${this.t('-өөс', ' and up')}`)
            }
            if (opts.askService !== false)
              lines.push(this.t('Аль үйлчилгээг сонирхож байна вэ?', 'Which service are you interested in?'))
          }
          break
        }
        case 'duration': {
          const ids = r.generic && !r.services.length ? r.generic.candidates : focus
          if (ids.length) lines.push(...list(ids).map((x) => `${x.name} — ${duration(x.durationMinutes, this.locale)}`))
          else lines.push(this.t('Аль үйлчилгээний хугацааг асууж байна вэ?', 'Which service do you mean?'))
          break
        }
        case 'services': {
          lines.push(this.t('Манай үйлчилгээ:', 'Our services:'))
          for (const c of this.snap.categories) {
            const items = list(c.serviceIds)
            if (!items.length) continue
            const min = Math.min(...items.map((x) => x.price))
            lines.push(
              `${c.name}: ${items.map((x) => x.name).join(', ')} (${formatMoney(min)}${this.t('-өөс', ' and up')})`,
            )
          }
          this.quickCategories()
          break
        }
        case 'staff':
          lines.push(...this.staffLines(r, focus))
          break
        case 'hours': {
          if (r.date) {
            const h = this.snap.hoursFor(r.date)
            const special = salon.specials.find((d) => d.date === r.date)
            lines.push(
              `${fullDayLabel(r.date, this.today, this.locale)}: ${h ? `${clock(h.opensAt)}–${clock(h.closesAt)}` : this.t('амарна', 'closed')}${special ? ` (${special.label})` : ''}`,
            )
          } else {
            lines.push(this.t('Ажлын цаг:', 'Opening hours:'), ...weeklyHours(salon, this.locale))
            const soon = salon.specials.filter((d) => d.date >= this.today && d.date <= addDays(this.today, 21))
            for (const d of soon)
              lines.push(
                `${fullDayLabel(d.date, this.today, this.locale)}: ${d.closed ? this.t('амарна', 'closed') : `${clock(d.opensAt!)}–${clock(d.closesAt!)}`} (${d.label})`,
              )
          }
          break
        }
        case 'location':
          lines.push(
            this.t(
              `Хаяг: ${salon.address}${salon.addressNote ? ` (${salon.addressNote})` : ''}. Утас: ${phone(salon.phone)}.`,
              `Address: ${salon.address}${salon.addressNote ? ` (${salon.addressNote})` : ''}. Phone: ${phone(salon.phone)}.`,
            ),
          )
          break
        case 'contact':
          lines.push(
            this.t(
              `Утас: ${phone(salon.phone)}${salon.email ? `, имэйл: ${salon.email}` : ''}. Хаяг: ${salon.address}.`,
              `Phone: ${phone(salon.phone)}${salon.email ? `, e-mail: ${salon.email}` : ''}. Address: ${salon.address}.`,
            ),
          )
          break
        case 'cancel_policy':
          lines.push(
            salon.cancellationPolicy,
            this.t(
              `Онлайнаар цаг өөрчлөх, цуцлахыг энэ чатаар эсвэл «Миний захиалга» хуудсаар хийнэ (өөрчлөлт — эхлэхээс ${salon.rescheduleNoticeHours} цагийн өмнө хүртэл).`,
              `You can move or cancel online here or on the “My booking” page (moves up to ${salon.rescheduleNoticeHours} hours before the start).`,
            ),
          )
          break
        case 'deposit':
          lines.push(salon.depositPolicy)
          break
        case 'payment':
        case 'preparation':
        case 'aftercare':
        case 'parking': {
          const entry =
            matchKnowledge(
              r.text,
              this.snap.knowledge.filter((k) => k.topic === topic),
            )?.item ?? this.snap.knowledge.find((k) => k.topic === topic)
          if (entry) lines.push(entry.answer)
          else if (topic === 'payment') lines.push(salon.depositPolicy)
          else {
            this.event('unanswered_topic', 'warning', { detail: { topic } })
            lines.push(
              this.t(
                `Энэ талаар нийтэлсэн мэдээлэл надад алга. ${phone(salon.phone)} руу залгаж тодруулна уу.`,
                `I don’t have published information about that. Please call ${phone(salon.phone)}.`,
              ),
            )
          }
          break
        }
        default:
          break
      }
    }
    this.say([...new Set(lines)].join('\n'))
    if (topics.includes('price') || topics.includes('duration')) {
      const ids = r.services.length ? r.services : focus
      if (ids.length === 1 && this.service(ids[0])?.onlineBookable && !this.state.booking?.date)
        this.quick([
          { label: this.t('Сул цаг харах', 'See free times'), action: { type: 'pick_service', serviceId: ids[0] } },
        ])
    }
  }

  quickCategories() {
    this.quick(
      this.snap.categories
        .filter((c) => c.serviceIds.length)
        .slice(0, 6)
        .map((c) => ({ label: c.name, message: this.t(`${c.name} үнэ`, `${c.name} prices`) })),
    )
  }

  staffLines(r: Reading, focus: string[]): string[] {
    const staff = this.snap.staff
    const describe = (x: (typeof staff)[number]) =>
      this.t(
        `${x.name} — ${x.title}${x.experienceYears ? `, ${x.experienceYears} жилийн туршлагатай` : ''}${x.specialties.length ? `. Онцлог: ${x.specialties.join(', ')}` : ''}.`,
        `${x.name} — ${x.title}${x.experienceYears ? `, ${x.experienceYears} years of experience` : ''}${x.specialties.length ? `. Known for: ${x.specialties.join(', ')}` : ''}.`,
      )
    if (r.staffNamed.length) {
      return r.staffNamed.flatMap((id) => {
        const x = staff.find((y) => y.id === id)
        if (!x) return []
        const services = x.serviceIds.map((sid) => this.service(sid)?.name).filter(Boolean)
        return [
          describe(x),
          this.t(
            `Хийдэг үйлчилгээ: ${services.slice(0, 8).join(', ')}${services.length > 8 ? ` гэх мэт ${services.length}` : ''}.`,
            `Services: ${services.slice(0, 8).join(', ')}${services.length > 8 ? ` and more (${services.length})` : ''}.`,
          ),
          this.t(
            `Ажлын өдөр: ${x.workdays.map((d) => weekdayName(d, 'mn')).join(', ')}.`,
            `Works on: ${x.workdays.map((d) => weekdayName(d, 'en')).join(', ')}.`,
          ),
        ]
      })
    }
    const ids = r.generic && !r.services.length ? r.generic.candidates : focus
    if (ids.length) {
      const eligible = staff.filter((x) => ids.some((id) => x.serviceIds.includes(id)))
      const strict = staff.filter((x) => ids.every((id) => x.serviceIds.includes(id)))
      const who = strict.length ? strict : eligible
      return [
        this.t(
          `${r.generic && !r.services.length ? r.generic.label : this.serviceNames(ids)} хийдэг мастерууд:`,
          `Specialists for ${this.serviceNames(ids)}:`,
        ),
        ...who.map(describe),
      ]
    }
    const asksBest = /(?:сайн|шилдэг|хамгийн|best|good)/iu.test(r.norm)
    return [
      this.t('Манай мастерууд:', 'Our specialists:'),
      ...staff.map(describe),
      ...(asksBest
        ? [
            this.t(
              'Бүх мастер маань мэргэжлийн. Ямар үйлчилгээ хийлгэхээ хэлбэл тэр чиглэлээр нь туршлагатай мастерыг санал болгоё.',
              'All our specialists are trained professionals. Tell me the service you want and I’ll suggest who specialises in it.',
            ),
          ]
        : []),
    ]
  }

  serviceCard(r: Reading) {
    const s = this.state
    this.intent = 'service'
    if (r.generic && !r.services.length) {
      const items = r.generic.candidates.map((id) => this.service(id)).filter((x): x is PortService => Boolean(x))
      this.say(
        [
          `${r.generic.label}:`,
          ...items.map((x) => serviceLine(x, this.locale)),
          this.t('Алийг нь сонирхож байна вэ?', 'Which one interests you?'),
        ].join('\n'),
      )
      s.choices = { kind: 'service', values: items.map((x) => x.id) }
      s.awaiting = 'service_choice'
      ;(s.booking ??= { serviceIds: [] }).serviceIds = []
      this.quick(
        items
          .filter((x) => x.onlineBookable)
          .map((x) => ({ label: x.name, action: { type: 'pick_service', serviceId: x.id } })),
      )
      return
    }
    const items = r.services.map((id) => this.service(id)).filter((x): x is PortService => Boolean(x))
    s.focus = { ...s.focus, serviceIds: items.map((x) => x.id) }
    this.say(
      items.map((x) => `${serviceLine(x, this.locale)}${x.description ? `\n${x.description}` : ''}`).join('\n\n'),
    )
    const bookable = items.filter((x) => x.onlineBookable)
    if (bookable.length === 1)
      this.quick([
        {
          label: this.t('Сул цаг харах', 'See free times'),
          action: { type: 'pick_service', serviceId: bookable[0].id },
        },
      ])
  }

  staffInfo(r: Reading) {
    this.intent = 'info:staff'
    this.say(this.staffLines(r, []).join('\n'))
  }

  // ---- small talk, safety, hand-over --------------------------------------------------------------

  greeting() {
    const s = this.state
    this.intent = 'greeting'
    if (!s.greeted) {
      s.greeted = true
      this.say(
        this.input.settings.greeting?.trim() ||
          this.t(
            `Сайн байна уу! Би ${this.snap.salon.name} салоны туслах. Үнэ, сул цагийг салоны системээс шалгаж, цаг захиалах, өөрчлөх, цуцлахад тусална. Юугаар туслах вэ?`,
            `Hello! I’m the ${this.snap.salon.name} salon assistant. I check prices and free times in the salon’s system and can book, move or cancel appointments. How can I help?`,
          ),
      )
    } else this.say(this.t('Сайн байна уу! Юугаар туслах вэ?', 'Hi! How can I help?'))
    this.quick(this.menu())
  }

  notOffered(term: string) {
    this.intent = 'not_offered'
    this.event('not_offered', 'info', { detail: { term } })
    const categories = this.snap.categories.filter((c) => c.serviceIds.length).map((c) => c.name.toLowerCase())
    this.say(
      this.t(
        `Уучлаарай, манай салон «${term}» үйлчилгээ үзүүлдэггүй. Бид зөвхөн хумсны үйлчилгээ хийдэг: ${categories.join(', ')}.`,
        `Sorry, we don’t offer “${term}”. We only do nail services: ${categories.join(', ')}.`,
      ),
    )
    this.quickCategories()
  }

  identity() {
    this.intent = 'identity'
    this.say(
      this.t(
        `Би ${this.snap.salon.name} салоны онлайн туслах (AI туслах). Үнэ, сул цаг шалгаж, цаг захиалах, өөрчлөх, цуцлахад тусална. Хүнтэй ярих бол «ажилтантай холбогдох» гэж бичээрэй.`,
        `I’m the ${this.snap.salon.name} online assistant (an AI assistant). I can check prices and free times and book, move or cancel appointments. To talk to a person, write “staff”.`,
      ),
    )
  }

  privacy(r: Reading) {
    this.intent = 'privacy'
    this.event('privacy_refused', 'info')
    const aboutStaff = r.staffNamed.length > 0
    this.say(
      aboutStaff
        ? this.t(
            'Мастеруудын хувийн мэдээллийг хуваалцдаггүй. Мэргэжлийн туршлагыг нь хэлж өгье:',
            'I don’t share our specialists’ personal details. Here is their professional background:',
          )
        : this.t(
            'Бусад үйлчлүүлэгчийн мэдээллийг хуваалцах боломжгүй — хүн бүрийн мэдээлэл нууц.',
            'I can’t share other customers’ information — everyone’s details are private.',
          ),
    )
    if (aboutStaff) this.say(this.staffLines(r, []).slice(0, 1).join('\n'))
  }

  paymentClaim() {
    this.intent = 'payment_claim'
    this.event('payment_claim', 'info')
    this.say(
      this.t(
        'Урьдчилгааг систем QPay-ээс шалгаж баталгаажуулдаг — би төлбөр орсныг батлах боломжгүй. Захиалгын хуудсан дээрх «Төлбөр шалгах» товчийг дарна уу. Асуудал хэвээр бол ажилтанд дамжуулъя.',
        'Deposits are confirmed automatically once QPay reports them — I can’t confirm a payment myself. Press “Check payment” on your booking page. If it still looks wrong, I can pass this to staff.',
      ),
    )
    this.quick([{ label: this.t('Ажилтантай холбогдох', 'Talk to staff'), action: { type: 'human' } }])
  }

  handOver(reason: HandoffReason) {
    const s = this.state
    this.intent = 'human'
    const already = s.handedOff
    s.handedOff = true
    this.handoff = { reason }
    this.event('handoff', 'info', { detail: { reason, repeat: Boolean(already) } })
    if (already) {
      this.say(
        this.t(
          'Таны хүсэлт ажилтанд хүрсэн. Тэр зуур би бусад асуултад тань тусалж болно.',
          'Your request has reached our staff. Meanwhile I can help with anything else.',
        ),
      )
      return
    }
    this.say(
      this.input.settings.handoverMessage?.trim() ||
        this.t(
          `Таны хүсэлтийг салоны ажилтанд дамжууллаа. Ажлын цагаар энэ чатаар эсвэл утсаар холбогдоно. Яаралтай бол ${phone(this.snap.salon.phone)} руу залгаарай.`,
          `I’ve passed your request to the salon staff. They’ll reply here or by phone during opening hours. If it’s urgent, call ${phone(this.snap.salon.phone)}.`,
        ),
    )
    if (this.snap.salon.isDemo)
      this.parts.push({
        type: 'notice',
        text: this.t(
          'Демо: мэдэгдэл бодитоор илгээгдэхгүй, зөвхөн бүртгэлд хадгалагдана.',
          'Demo: no real message is sent; it is only logged.',
        ),
      })
  }

  async unknown(text: string) {
    const s = this.state
    const write = this.input.models?.write
    if (write) {
      const answer = await write({
        question: text,
        snapshot: this.snap,
        history: this.input.history,
        locale: this.locale,
        today: this.today,
      }).catch(() => null)
      if (answer) {
        this.usedModel = true
        this.intent = 'ai_answer'
        this.say(answer)
        return
      }
    }
    s.unknownStreak = (s.unknownStreak ?? 0) + 1
    this.intent = 'unknown'
    this.event('unsupported', 'warning', { detail: { words: text.trim().split(/\s+/).length } })
    if (s.unknownStreak >= 2) return this.handOver('unanswered')
    this.fallbackText()
  }

  fallbackText() {
    this.say(
      this.t(
        `Уучлаарай, энэ асуултад баттай хариулт надад алга. Ажилтантай холбогдох уу? Эсвэл ${phone(this.snap.salon.phone)} руу залгаж болно.`,
        `Sorry, I don’t have a reliable answer to that. Shall I connect you with staff? You can also call ${phone(this.snap.salon.phone)}.`,
      ),
    )
    this.quick([
      { label: this.t('Ажилтантай холбогдох', 'Talk to staff'), action: { type: 'human' } },
      ...this.menu().slice(0, 2),
    ])
  }
}
