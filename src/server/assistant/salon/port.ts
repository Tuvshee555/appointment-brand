// The contract between the conversation (turn.ts) and an appointment business. Сувд implements it
// over the existing booking services (adapter.ts); another business — the cleaning-service project
// — implements the same interface over its own services and keeps the engine and the dialogue.
import type { DateKey } from '@/lib/datetime'
import type { KnowledgeItem } from '../engine/knowledge'
import type { Vocabulary } from '../engine/vocab'
import type { Hours } from '../engine/when'

export interface PortService {
  id: string
  slug: string
  name: string
  categoryId: string
  categoryName: string
  price: number
  priceType: 'fixed' | 'from'
  durationMinutes: number
  description: string
  onlineBookable: boolean
  staffIds: string[]
}

export interface PortStaff {
  id: string
  name: string
  title: string
  experienceYears: number | null
  specialties: string[]
  serviceIds: string[]
  /** ISO weekdays (1 = Monday) the specialist works. */
  workdays: number[]
}

export interface PortCategory {
  id: string
  name: string
  serviceIds: string[]
}

export interface PortSalon {
  name: string
  isDemo: boolean
  phone: string
  email: string | null
  address: string
  addressNote: string | null
  weekly: { weekday: number; isClosed: boolean; opensAt: number; closesAt: number }[]
  specials: { date: DateKey; label: string; closed: boolean; opensAt: number | null; closesAt: number | null }[]
  minAdvanceMinutes: number
  maxAdvanceDays: number
  cancellationNoticeHours: number
  rescheduleNoticeHours: number
  lateArrivalMinutes: number
  holdMinutes: number
  confirmationMode: 'auto' | 'manual'
  cancellationPolicy: string
  depositPolicy: string
  maxServicesPerBooking: number
}

/** A generic word ("маникюр") and the services it may mean; `canonical` is the usual meaning. */
export interface GenericTerm {
  label: string
  candidates: string[]
  canonical: string | null
}

export interface KnowledgeEntry extends KnowledgeItem {
  topic: string
}

export interface Snapshot {
  salon: PortSalon
  services: PortService[]
  categories: PortCategory[]
  staff: PortStaff[]
  knowledge: KnowledgeEntry[]
  vocabulary: Vocabulary
  generics: Map<string, GenericTerm>
  /** Opening hours of a date (special days applied); null when closed. */
  hoursFor: (date: DateKey) => Hours | null
}

export interface DayPlan {
  date: DateKey
  hours: Hours | null
  special: string | null
  state: 'open' | 'closed' | 'past' | 'beyond'
  slots: { start: number; staffIds: string[] }[]
}

export interface PortQuote {
  total: number
  hasFromPrice: boolean
  deposit: number
  durationMinutes: number
  lines: { name: string; price: number; from: boolean; durationMinutes: number }[]
  candidates: { id: string; name: string }[]
}

export interface BookingView {
  id: string
  reference: string
  status: string
  statusLabel: string
  date: DateKey
  start: number
  durationMinutes: number
  startsAt: Date
  services: string[]
  staffId: string
  staffName: string
  total: number
  hasFromPrice: boolean
  depositAmount: number
  depositPaid: boolean
}

export interface BookRequest {
  serviceIds: string[]
  staffId: string | null
  date: DateKey
  start: number
  name: string
  phone: string
}

export interface BookOutcome {
  appointmentId: string
  reference: string
  status: string
  statusLabel: string
  explanation: string
  staffName: string
  date: DateKey
  start: number
  deposit: number
  /** Private manage link — shown once in the live reply, never stored with the message. */
  manageLink: string | null
  simulated: boolean
}

export interface ChangeOutcome {
  appointmentId: string
  reference: string
  status: string
  statusLabel: string
  staffName?: string
  date?: DateKey
  start?: number
  depositOutcome?: string
  simulated: boolean
}

export interface SalonPort {
  snapshot(): Promise<Snapshot>
  quote(serviceIds: string[], staffId: string | null): Promise<PortQuote>
  day(serviceIds: string[], staffId: string | null, date: DateKey, excludeAppointmentId?: string): Promise<DayPlan>
  openDays(
    serviceIds: string[],
    staffId: string | null,
    from: DateKey,
    limit: number,
    excludeAppointmentId?: string,
  ): Promise<{ date: DateKey; slotCount: number }[]>
  book(request: BookRequest): Promise<BookOutcome>
  /** The booking when the phone matches the reference — null otherwise (one answer for both). */
  findBooking(reference: string, phone: string): Promise<BookingView | null>
  getBooking(id: string): Promise<BookingView | null>
  cancel(id: string, note: string | null): Promise<ChangeOutcome>
  /** Whether the customer may move the booking online, and with which services and specialist. */
  rescheduleOptions(
    id: string,
  ): Promise<{ ok: true; serviceIds: string[]; staffId: string | null } | { ok: false; message: string }>
  reschedule(id: string, date: DateKey, start: number): Promise<ChangeOutcome>
}
