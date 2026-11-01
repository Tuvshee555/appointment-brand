import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { ActionButton } from '@/components/admin/action-button'
import { NoteForm, PaymentForm, ReschedulePanel, StatusActions } from '@/components/admin/appointment-panels'
import { Card, Pill } from '@/components/admin/ui'
import { DemoTag, StatusBadge } from '@/components/ui/badge'
import { Money } from '@/components/ui/money'
import { SOURCE_LABELS, STATUS_LABELS } from '@/lib/booking/status'
import {
  dateKeyOf,
  formatDateTime,
  formatDateWithWeekday,
  formatDuration,
  formatTime,
  formatTimeRange,
} from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { formatPhone } from '@/lib/phone'
import { refundPaymentAction } from '@/server/actions/admin-appointments'
import { requireAdminPage } from '@/server/auth/current'
import { loadAppointmentDetail, staffOptions } from '@/server/queries/admin-appointments'
import { NOTIFICATION_LABELS, type NotificationKind } from '@/server/notifications'

export const metadata = { title: 'Захиалга' }

const EVENT_LABELS: Record<string, string> = {
  created: 'Захиалга үүссэн',
  confirmed: 'Баталгаажуулсан',
  deposit_paid: 'Урьдчилгаа баталгаажсан',
  cancelled: 'Цуцалсан',
  rejected: 'Татгалзсан',
  rescheduled: 'Цаг шилжүүлсэн',
  completed: 'Үйлчилгээ дууссан',
  no_show: 'Ирээгүй гэж тэмдэглэсэн',
  hold_expired: 'Урьдчилгааны хугацаа дууссан',
  request_expired: 'Хүсэлтийн хугацаа дууссан',
  payment_recorded: 'Төлбөр бүртгэсэн',
  late_payment: 'Хоцорсон төлбөр',
}
const ACTOR_LABELS: Record<string, string> = {
  customer: 'үйлчлүүлэгч',
  staff: 'ажилтан',
  system: 'систем',
  assistant: 'AI туслах',
}
const PAYMENT_STATUS: Record<string, string> = {
  pending: 'Хүлээгдэж буй',
  paid: 'Төлөгдсөн',
  failed: 'Амжилтгүй',
  cancelled: 'Цуцлагдсан',
  expired: 'Хугацаа дууссан',
  refunded: 'Буцаагдсан',
}
const METHOD: Record<string, string> = { qpay: 'QPay', cash: 'Бэлэн', card: 'Карт', bank_transfer: 'Дансаар' }

export default async function AppointmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminPage('appointments.view')
  await connection()
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const [detail, staff] = await Promise.all([loadAppointmentDetail(session, id), staffOptions(session.salonId)])
  if (!detail) notFound()
  const { appointment: a, customer, lines } = detail
  const now = new Date()
  const paid = detail.payments.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
  const outstanding = Math.max(0, a.totalPrice - paid)
  const manage = session.permissions.includes('appointments.manage') || session.isDemo
  const canPay =
    session.permissions.includes('payments.manage') || (session.isDemo && session.permissions.includes('payments.view'))
  const active = a.status === 'pending' || a.status === 'confirmed'
  const items = lines
    .filter((l) => l.serviceId)
    .map((l) => ({ serviceId: l.serviceId!, addonIds: l.addons.filter((x) => x.addonId).map((x) => x.addonId!) }))

  return (
    <>
      <Link
        href="/admin/appointments"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-cocoa-900"
      >
        <ArrowLeft className="size-4" aria-hidden /> Захиалгууд
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow flex items-center gap-2">
            {a.reference} {a.isDemo ? <DemoTag /> : null}
            {detail.ownDemoBooking ? (
              <span className="rounded-xs bg-sage-50 px-1.5 py-0.5 text-[0.68rem] tracking-normal text-sage-700 normal-case">
                таны туршилт — жинхэнээр өөрчилнө
              </span>
            ) : null}
          </p>
          <h1 className="display mt-1 text-4xl text-cocoa-900">{customer.name}</h1>
          <p className="mt-1 text-ink-2">
            {formatDateWithWeekday(a.startsAt)} ·{' '}
            <span className="tabular">{formatTimeRange(a.startsAt, a.endsAt)}</span> · {detail.staff.displayName}
          </p>
        </div>
        <div className="text-right">
          <StatusBadge status={a.status} label={STATUS_LABELS[a.status]} className="text-sm" />
          <p className="mt-2 max-w-xs text-xs text-ink-3">
            {a.status === 'awaiting_deposit' && a.holdExpiresAt
              ? `Урьдчилгааг ${formatTime(a.holdExpiresAt)} хүртэл хүлээнэ · `
              : ''}
            {SOURCE_LABELS[a.source] ?? a.source} · {formatDateTime(a.createdAt)}
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          {manage ? (
            <Card title="Үйлдэл">
              <StatusActions appointmentId={a.id} status={a.status} started={now >= a.startsAt} />
              {detail.replacement ? (
                <p className="mt-3 text-sm">
                  Шинэ захиалга:{' '}
                  <Link href={`/admin/appointments/${detail.replacement.id}`} className="font-medium underline">
                    {detail.replacement.reference}
                  </Link>
                </p>
              ) : null}
            </Card>
          ) : null}

          <Card title="Үйлчилгээ (захиалах үеийн үнэ)">
            <ul className="divide-y divide-line">
              {lines.map((l) => (
                <li key={l.id} className="py-2.5 first:pt-0">
                  <div className="flex justify-between gap-4">
                    <span>
                      {l.serviceName}{' '}
                      <span className="text-xs text-ink-3">
                        · {l.categoryName} · {formatDuration(l.durationMinutes)}
                      </span>
                    </span>
                    <Money amount={l.price} from={l.priceType === 'from'} />
                  </div>
                  {l.addons.map((x) => (
                    <div key={x.id} className="flex justify-between gap-4 pl-4 text-sm text-ink-3">
                      <span>
                        + {x.addonName} · {formatDuration(x.durationMinutes)}
                      </span>
                      <Money amount={x.price} from={x.priceType === 'from'} />
                    </div>
                  ))}
                </li>
              ))}
            </ul>
            <dl className="mt-3 grid grid-cols-2 gap-y-1.5 border-t border-line pt-3 text-sm">
              <dt className="text-ink-3">Үргэлжлэх хугацаа</dt>
              <dd className="text-right">
                {formatDuration(a.durationMinutes)} + {a.bufferMinutes} мин бэлтгэл
              </dd>
              <dt className="text-ink-3">Нийт</dt>
              <dd className="text-right font-medium">
                <Money amount={a.totalPrice} from={a.hasFromPrice} />
              </dd>
              {a.depositAmount > 0 ? (
                <>
                  <dt className="text-ink-3">Урьдчилгаа</dt>
                  <dd className="text-right">{formatMoney(a.depositAmount)}</dd>
                </>
              ) : null}
              <dt className="text-ink-3">Төлсөн</dt>
              <dd className="text-right">{formatMoney(paid)}</dd>
              <dt className="text-ink-3">Үлдэгдэл</dt>
              <dd className={`text-right font-medium ${outstanding ? 'text-amber-700' : 'text-sage-700'}`}>
                {formatMoney(outstanding)}
              </dd>
            </dl>
            <p className="mt-3 text-xs text-ink-3">
              Үйлчилгээний үнэ дараа өөрчлөгдсөн ч энэ захиалга захиалах үеийн үнээрээ хадгалагдана.
            </p>
          </Card>

          {manage && active ? (
            <Card title="Цаг шилжүүлэх">
              <ReschedulePanel
                appointmentId={a.id}
                items={items}
                staffId={a.staffId}
                staff={staff}
                today={dateKeyOf(now)}
              />
            </Card>
          ) : null}

          <Card title="Төлбөр">
            {detail.payments.length ? (
              <ul className="divide-y divide-line text-sm">
                {detail.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0">
                    <div>
                      <p>
                        {p.kind === 'deposit' ? 'Урьдчилгаа' : p.kind === 'refund' ? 'Буцаалт' : 'Төлбөр'} ·{' '}
                        {METHOD[p.method]} ·{' '}
                        <span className={p.status === 'paid' ? 'text-sage-700' : 'text-ink-3'}>
                          {PAYMENT_STATUS[p.status]}
                        </span>
                      </p>
                      <p className="text-xs text-ink-3">
                        {p.provider === 'simulated'
                          ? 'Туршилтын QPay (симуляц)'
                          : p.provider === 'qpay'
                            ? 'QPay'
                            : 'Ажилтан бүртгэсэн'}
                        {p.verifiedBy === 'provider_check'
                          ? ' · төлбөрийн систем баталгаажуулсан'
                          : p.verifiedBy === 'staff_record'
                            ? ' · ажилтны бүртгэл'
                            : ''}
                        {p.paidAt ? ` · ${formatDateTime(p.paidAt)}` : ''}
                      </p>
                      {p.note ? <p className="text-xs text-amber-700">{p.note}</p> : null}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="tabular">{formatMoney(p.amount)}</span>
                      {p.status === 'paid' && canPay ? (
                        <ActionButton
                          action={refundPaymentAction.bind(null, { paymentId: p.id, note: 'Ажилтан буцаав' })}
                          variant="ghost"
                          confirm="Энэ төлбөрийг буцаах уу?"
                          okText="Буцаагдлаа."
                        >
                          Буцаах
                        </ActionButton>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">Төлбөр бүртгэгдээгүй.</p>
            )}
            {canPay &&
            outstanding > 0 &&
            (a.status === 'confirmed' || a.status === 'completed' || a.status === 'pending') ? (
              <div className="mt-5 border-t border-line pt-5">
                <PaymentForm appointmentId={a.id} outstanding={outstanding} />
              </div>
            ) : null}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Үйлчлүүлэгч">
            <p className="font-medium">{customer.name}</p>
            <p className="tabular text-sm text-ink-2">{formatPhone(customer.phone)}</p>
            {customer.email ? <p className="text-sm text-ink-2">{customer.email}</p> : null}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Pill>{detail.customerStats.visits} удаа үйлчлүүлсэн</Pill>
              {detail.customerStats.cancellations ? <Pill>{detail.customerStats.cancellations} цуцлалт</Pill> : null}
              {detail.customerStats.noShows ? (
                <Pill className="bg-rose-50 text-rose-700">{detail.customerStats.noShows} ирээгүй</Pill>
              ) : null}
            </div>
            {customer.preferences ? <p className="mt-3 text-sm text-ink-2">Сонголт: {customer.preferences}</p> : null}
            {a.customerNote ? <p className="mt-2 text-sm text-ink-2">Захиалгын тэмдэглэл: «{a.customerNote}»</p> : null}
            {customer.notes ? (
              <p className="mt-2 rounded-xs bg-amber-50 px-3 py-2 text-sm text-amber-700">Дотоод: {customer.notes}</p>
            ) : null}
            {session.permissions.includes('customers.view') ? (
              <Link
                href={`/admin/customers/${customer.id}`}
                className="mt-3 inline-block text-sm text-cocoa-700 underline underline-offset-4"
              >
                Харилцагчийн түүх
              </Link>
            ) : null}
          </Card>

          <Card title="Дотоод тэмдэглэл">
            {manage ? (
              <NoteForm appointmentId={a.id} note={a.internalNote} />
            ) : (
              <p className="text-sm text-ink-2">{a.internalNote ?? '—'}</p>
            )}
          </Card>

          {detail.cancellations.length ? (
            <Card title="Цуцлалтын бүртгэл">
              {detail.cancellations.map((c) => (
                <div key={c.id} className="text-sm">
                  <p>
                    {c.cancelledBy === 'customer' ? 'Үйлчлүүлэгч' : c.cancelledBy === 'system' ? 'Систем' : 'Салон'} ·{' '}
                    {c.noticeHours} цагийн өмнө · {c.withinPolicy ? 'бодлогын дагуу' : 'хугацаа хоцорсон'}
                  </p>
                  <p className="text-xs text-ink-3">
                    Урьдчилгаа:{' '}
                    {c.depositOutcome === 'refund'
                      ? 'буцаасан'
                      : c.depositOutcome === 'forfeit'
                        ? 'буцаагдахгүй'
                        : 'байхгүй'}
                    {c.reasonText ? ` · «${c.reasonText}»` : ''}
                  </p>
                </div>
              ))}
            </Card>
          ) : null}

          <Card title="Түүх">
            <ol className="space-y-3 border-l border-line pl-4">
              {detail.events.map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className="absolute top-1.5 -left-[1.2rem] size-2 rounded-full bg-cocoa-400" aria-hidden />
                  <p>
                    {EVENT_LABELS[e.kind] ?? e.kind}
                    <span className="text-ink-3"> · {e.actorName ?? ACTOR_LABELS[e.actorType]}</span>
                  </p>
                  <p className="text-xs text-ink-3">
                    {formatDateTime(e.createdAt)}
                    {e.note ? ` · ${e.note}` : ''}
                  </p>
                </li>
              ))}
            </ol>
            {detail.previous ? (
              <p className="mt-4 text-sm">
                Өмнөх:{' '}
                <Link href={`/admin/appointments/${detail.previous.id}`} className="underline">
                  {detail.previous.reference}
                </Link>
              </p>
            ) : null}
          </Card>

          <Card title="Мэдэгдэл">
            {detail.notifications.length ? (
              <ul className="space-y-2 text-sm">
                {detail.notifications.map((n) => (
                  <li key={n.id}>
                    <p>
                      {NOTIFICATION_LABELS[n.kind as NotificationKind] ?? n.kind} ·{' '}
                      <span className="text-ink-3">{n.channel === 'telegram' ? 'Telegram' : 'SMS'}</span>
                    </p>
                    <p className="text-xs text-ink-3">
                      {n.status === 'logged'
                        ? 'Бүртгэлд хадгалсан (илгээгээгүй)'
                        : n.status === 'sent'
                          ? 'Илгээсэн'
                          : n.status === 'skipped'
                            ? 'Суваг тохируулаагүй'
                            : 'Алдаа'}{' '}
                      · {formatDateTime(n.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">Мэдэгдэл алга.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
