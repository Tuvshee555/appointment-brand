// Appointment notifications. Every message is written to salon.notifications
// first (one row per appointment/kind/channel/audience via dedupe_key, so a
// retry never sends twice). Delivery uses only channels that are configured:
// - DEMO_MODE: nothing leaves the server; rows are stored with status "logged".
// - Telegram staff alerts: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID.
// - Customer SMS / Messenger: not configured in this project → "skipped".
import { eq } from 'drizzle-orm'
import { formatDateTime, formatTime } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { maskPhone } from '@/lib/phone'
import type { Database } from '@/server/db/client'
import * as t from '@/server/db/schema'

export type NotificationKind =
  | 'booking_created'
  | 'booking_confirmed'
  | 'booking_rejected'
  | 'booking_cancelled'
  | 'booking_rescheduled'
  | 'reminder'
  | 'deposit_paid'
  | 'deposit_expired'
  | 'staff_new_booking'
  | 'staff_cancelled'

export const NOTIFICATION_LABELS: Record<NotificationKind, string> = {
  booking_created: 'Захиалга бүртгэгдсэн',
  booking_confirmed: 'Баталгаажсан',
  booking_rejected: 'Татгалзсан',
  booking_cancelled: 'Цуцлагдсан',
  booking_rescheduled: 'Цаг өөрчлөгдсөн',
  reminder: 'Сануулга',
  deposit_paid: 'Урьдчилгаа төлөгдсөн',
  deposit_expired: 'Урьдчилгааны хугацаа дууссан',
  staff_new_booking: 'Ажилтанд: шинэ захиалга',
  staff_cancelled: 'Ажилтанд: цуцлалт',
}

export interface NotificationVars {
  salonName: string
  reference: string
  customerName: string
  customerPhone: string
  staffName: string
  startsAt: Date
  services: string
  statusLabel: string
  amount?: number
  address?: string
}

function render(kind: NotificationKind, v: NotificationVars): { subject: string; body: string } {
  const when = formatDateTime(v.startsAt)
  switch (kind) {
    case 'booking_created':
      return {
        subject: `${v.salonName}: захиалга ${v.reference}`,
        body: `${v.salonName}: Таны ${when}-ийн захиалга (${v.reference}) бүртгэгдлээ. Төлөв: ${v.statusLabel}.`,
      }
    case 'booking_confirmed':
      return {
        subject: `${v.salonName}: цаг баталгаажлаа`,
        body: `${v.salonName}: ${when}-д ${v.staffName} мастерт захиалсан цаг тань баталгаажлаа (${v.reference}).`,
      }
    case 'booking_rejected':
      return {
        subject: `${v.salonName}: хүсэлт баталгаажаагүй`,
        body: `${v.salonName}: Уучлаарай, ${when}-ийн хүсэлтийг (${v.reference}) баталгаажуулах боломжгүй боллоо. Өөр цаг сонгоно уу.`,
      }
    case 'booking_cancelled':
      return {
        subject: `${v.salonName}: захиалга цуцлагдлаа`,
        body: `${v.salonName}: ${when}-ийн захиалга (${v.reference}) цуцлагдлаа.`,
      }
    case 'booking_rescheduled':
      return {
        subject: `${v.salonName}: цаг өөрчлөгдлөө`,
        body: `${v.salonName}: Таны цаг ${when} болж өөрчлөгдлөө (${v.reference}). Мастер: ${v.staffName}.`,
      }
    case 'reminder':
      return {
        subject: `${v.salonName}: сануулга`,
        body: `${v.salonName}: ${when}-д ${v.staffName} мастер таныг хүлээж байна. ${v.address ? `Хаяг: ${v.address}.` : ''}`.trim(),
      }
    case 'deposit_paid':
      return {
        subject: `${v.salonName}: урьдчилгаа баталгаажлаа`,
        body: `${v.salonName}: ${formatMoney(v.amount ?? 0)} урьдчилгаа төлбөрийн системээр баталгаажлаа. ${v.reference} захиалгын төлөв: ${v.statusLabel}.`,
      }
    case 'deposit_expired':
      return {
        subject: `${v.salonName}: цаг чөлөөлөгдлөө`,
        body: `${v.salonName}: Урьдчилгаа хугацаандаа төлөгдөөгүй тул ${v.reference} захиалгын ${formatTime(v.startsAt)}-ийн цаг чөлөөлөгдлөө.`,
      }
    case 'staff_new_booking':
      return {
        subject: `Шинэ захиалга ${v.reference}`,
        body: `Шинэ захиалга ${v.reference}: ${v.customerName}, ${v.services}, ${when}, мастер ${v.staffName}. Төлөв: ${v.statusLabel}.`,
      }
    case 'staff_cancelled':
      return {
        subject: `Цуцлалт ${v.reference}`,
        body: `Цуцлалт ${v.reference}: ${v.customerName}, ${when}, мастер ${v.staffName}.`,
      }
  }
}

const STAFF_KINDS: NotificationKind[] = ['staff_new_booking', 'staff_cancelled']

export function isDemoMode() {
  return process.env.DEMO_MODE === 'true'
}

function telegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
}

/**
 * Records a notification (idempotent per dedupe key) inside the caller's
 * transaction. Returns the row id when a new row was written.
 */
export async function queueNotification(
  db: Database,
  input: {
    salonId: string
    appointmentId: string
    kind: NotificationKind
    vars: NotificationVars
    isDemo: boolean
    /** Distinguishes repeatable kinds, e.g. one reschedule per new time. */
    variant?: string
  },
): Promise<string | null> {
  const audience = STAFF_KINDS.includes(input.kind) ? 'staff' : 'customer'
  const channel = audience === 'staff' ? 'telegram' : 'sms'
  const { subject, body } = render(input.kind, input.vars)
  const demo = input.isDemo || isDemoMode()
  const status = demo ? 'logged' : channel === 'telegram' && telegramConfigured() ? 'logged' : 'skipped'
  const rows = await db
    .insert(t.notifications)
    .values({
      salonId: input.salonId,
      appointmentId: input.appointmentId,
      kind: input.kind,
      channel,
      audience,
      recipient: audience === 'staff' ? 'Ажилтны Telegram групп' : maskPhone(input.vars.customerPhone),
      subject,
      body,
      status,
      error: demo
        ? 'Демо горим: гадагш илгээгээгүй, зөвхөн бүртгэлд хадгалсан.'
        : status === 'skipped'
          ? 'Энэ суваг тохируулагдаагүй.'
          : null,
      dedupeKey: `${input.appointmentId}:${input.kind}:${audience}:${channel}:${input.variant ?? ''}`.slice(0, 200),
      isDemo: input.isDemo,
    })
    .onConflictDoNothing({ target: t.notifications.dedupeKey })
    .returning({ id: t.notifications.id })
  return rows[0]?.id ?? null
}

/**
 * Sends notifications that a configured channel can deliver. Called after the
 * booking transaction commits; failures are recorded, never thrown.
 */
export async function deliverNotification(db: Database, notificationId: string | null) {
  if (!notificationId || isDemoMode() || !telegramConfigured()) return
  const [row] = await db.select().from(t.notifications).where(eq(t.notifications.id, notificationId))
  if (!row || row.channel !== 'telegram' || row.sentAt) return
  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: row.body }),
      signal: AbortSignal.timeout(8000),
    })
    await db
      .update(t.notifications)
      .set(
        res.ok
          ? { status: 'sent', sentAt: new Date(), error: null }
          : { status: 'failed', error: `Telegram HTTP ${res.status}` },
      )
      .where(eq(t.notifications.id, notificationId))
  } catch (err) {
    await db
      .update(t.notifications)
      .set({ status: 'failed', error: err instanceof Error ? err.message.slice(0, 200) : 'Telegram алдаа' })
      .where(eq(t.notifications.id, notificationId))
  }
}
