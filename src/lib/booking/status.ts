// Appointment status machine. Every status change goes through
// canTransition() here and transitionAppointment() in the booking service.

export const APPOINTMENT_STATUSES = [
  'awaiting_deposit',
  'pending',
  'confirmed',
  'completed',
  'no_show',
  'cancelled',
  'rejected',
  'expired',
  'rescheduled',
] as const

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number]

/** Customer-facing labels — never shows a request as "confirmed". */
export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  awaiting_deposit: 'Урьдчилгаа хүлээж буй',
  pending: 'Салоны баталгаажуулалт хүлээж буй',
  confirmed: 'Баталгаажсан',
  completed: 'Үйлчилгээ хийгдсэн',
  no_show: 'Ирээгүй',
  cancelled: 'Цуцлагдсан',
  rejected: 'Салон татгалзсан',
  expired: 'Хугацаа дууссан',
  rescheduled: 'Шинэ цаг руу шилжсэн',
}

/** Short labels for dense admin tables and calendar chips. */
export const STATUS_SHORT: Record<AppointmentStatus, string> = {
  awaiting_deposit: 'Урьдчилгаа',
  pending: 'Хүсэлт',
  confirmed: 'Баталгаажсан',
  completed: 'Дууссан',
  no_show: 'Ирээгүй',
  cancelled: 'Цуцалсан',
  rejected: 'Татгалзсан',
  expired: 'Хугацаа дууссан',
  rescheduled: 'Шилжүүлсэн',
}

/** What the customer should understand right after booking. */
export const STATUS_EXPLANATIONS: Record<AppointmentStatus, string> = {
  awaiting_deposit:
    'Цаг тань түр хадгалагдсан. Урьдчилгаа төлөгдөж, төлбөрийн систем баталгаажуулсны дараа захиалга баталгаажна.',
  pending: 'Захиалгын хүсэлт тань салонд бүртгэгдлээ. Салон баталгаажуулах хүртэл энэ цаг таны нэр дээр хадгалагдана.',
  confirmed: 'Таны цаг баталгаажсан. Товлосон цагаасаа 5–10 минутын өмнө ирээрэй.',
  completed: 'Үйлчилгээ хийгдэж дууссан.',
  no_show: 'Энэ цагт ирээгүй гэж тэмдэглэгдсэн.',
  cancelled: 'Энэ захиалга цуцлагдсан. Цаг нь бусдад нээлттэй болсон.',
  rejected: 'Салон энэ цагийг баталгаажуулах боломжгүй байна. Өөр цаг сонгоно уу.',
  expired: 'Урьдчилгаа хугацаандаа төлөгдөөгүй тул цаг чөлөөлөгдсөн.',
  rescheduled: 'Энэ захиалгыг шинэ цаг руу шилжүүлсэн.',
}

/** Statuses that occupy the specialist's time (mirrors the exclusion constraint). */
export const SLOT_HOLDING_STATUSES = [
  'awaiting_deposit',
  'pending',
  'confirmed',
  'completed',
  'no_show',
] as const satisfies readonly AppointmentStatus[]

export const ACTIVE_STATUSES = [
  'awaiting_deposit',
  'pending',
  'confirmed',
] as const satisfies readonly AppointmentStatus[]
export const TERMINAL_STATUSES = ['completed', 'no_show', 'cancelled', 'rejected', 'expired', 'rescheduled'] as const

export function holdsSlot(status: AppointmentStatus): boolean {
  return (SLOT_HOLDING_STATUSES as readonly string[]).includes(status)
}

export function isActive(status: AppointmentStatus): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status)
}

export type TransitionActor = 'customer' | 'staff' | 'system'

const TRANSITIONS: Record<AppointmentStatus, Partial<Record<AppointmentStatus, TransitionActor[]>>> = {
  awaiting_deposit: {
    pending: ['system'],
    confirmed: ['system'],
    expired: ['system'],
    cancelled: ['customer', 'staff'],
  },
  pending: {
    confirmed: ['staff'],
    rejected: ['staff'],
    cancelled: ['customer', 'staff'],
    expired: ['system'],
    rescheduled: ['customer', 'staff'],
  },
  confirmed: {
    completed: ['staff'],
    no_show: ['staff'],
    cancelled: ['customer', 'staff'],
    rescheduled: ['customer', 'staff'],
  },
  // A no-show recorded by mistake can be corrected by staff.
  no_show: { completed: ['staff'] },
  completed: {},
  cancelled: {},
  rejected: {},
  expired: {},
  rescheduled: {},
}

export function canTransition(from: AppointmentStatus, to: AppointmentStatus, actor: TransitionActor): boolean {
  return TRANSITIONS[from]?.[to]?.includes(actor) ?? false
}

export function allowedTransitions(from: AppointmentStatus, actor: TransitionActor): AppointmentStatus[] {
  return Object.entries(TRANSITIONS[from] ?? {})
    .filter(([, actors]) => actors?.includes(actor))
    .map(([to]) => to as AppointmentStatus)
}

/** Labels for the staff action buttons. */
export const STATUS_ACTION_LABELS: Partial<Record<AppointmentStatus, string>> = {
  confirmed: 'Баталгаажуулах',
  rejected: 'Татгалзах',
  cancelled: 'Цуцлах',
  completed: 'Үйлчилгээ дууссан',
  no_show: 'Ирээгүй гэж тэмдэглэх',
}

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'muted'

export const STATUS_TONES: Record<AppointmentStatus, StatusTone> = {
  awaiting_deposit: 'warning',
  pending: 'info',
  confirmed: 'success',
  completed: 'neutral',
  no_show: 'danger',
  cancelled: 'muted',
  rejected: 'muted',
  expired: 'muted',
  rescheduled: 'muted',
}

export const CANCELLATION_REASONS = {
  customer_request: 'Үйлчлүүлэгчийн хүсэлтээр',
  schedule_conflict: 'Цагийн зөрчил',
  staff_unavailable: 'Мастер ажиллах боломжгүй',
  salon_closed: 'Салон хаалттай',
  duplicate: 'Давхардсан захиалга',
  other: 'Бусад',
} as const

export type CancellationReason = keyof typeof CANCELLATION_REASONS

/** Where a booking came from, as shown to staff. */
export const SOURCE_LABELS: Record<string, string> = {
  website: 'Вэбсайт',
  admin: 'Самбар',
  assistant: 'AI туслах',
  messenger: 'Messenger',
  phone: 'Утас',
  walk_in: 'Шууд ирсэн',
}
