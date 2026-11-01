import { CalendarCheck2, CircleAlert, Clock3, Hourglass, LayoutDashboard, XCircle } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { DepositPanel } from '@/components/booking/deposit-panel'
import { ManageBooking } from '@/components/booking/manage-booking'
import { buttonClass } from '@/components/ui/button'
import { DemoTag } from '@/components/ui/badge'
import { Money } from '@/components/ui/money'
import { formatDateTime, formatDateWithWeekday, formatDuration, formatTimeRange, hoursUntil } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { formatPhone } from '@/lib/phone'
import { cn } from '@/lib/cn'
import { authorizeBooking, loadCustomerBooking } from '@/server/queries/customer-booking'
import { getPublicSalon } from '@/server/queries/public'
import { visitorHash } from '@/server/request'

export const metadata: Metadata = { title: 'Миний захиалга', robots: { index: false } }

const EVENT_LABELS: Record<string, string> = {
  created: 'Захиалга үүссэн',
  confirmed: 'Салон баталгаажуулсан',
  deposit_paid: 'Урьдчилгаа баталгаажсан',
  cancelled: 'Цуцлагдсан',
  rejected: 'Салон татгалзсан',
  rescheduled: 'Цаг өөрчлөгдсөн',
  completed: 'Үйлчилгээ хийгдсэн',
  no_show: 'Ирээгүй',
  hold_expired: 'Урьдчилгааны хугацаа дууссан',
  request_expired: 'Хүсэлтийн хугацаа дууссан',
}

const TONE: Record<string, { box: string; icon: typeof CalendarCheck2 }> = {
  confirmed: { box: 'border-sage-600/30 bg-sage-50 text-sage-700', icon: CalendarCheck2 },
  completed: { box: 'border-sage-600/30 bg-sage-50 text-sage-700', icon: CalendarCheck2 },
  pending: { box: 'border-sky-600/30 bg-sky-50 text-sky-700', icon: Hourglass },
  awaiting_deposit: { box: 'border-amber-600/30 bg-amber-50 text-amber-700', icon: Clock3 },
}

async function BookingContent({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>
  searchParams: Promise<{ t?: string; new?: string }>
}) {
  const [{ reference: raw }, sp] = await Promise.all([params, searchParams])
  const reference = decodeURIComponent(raw).toUpperCase()
  const token = typeof sp.t === 'string' ? sp.t : null
  const access = await authorizeBooking({ reference, token })
  if (!access) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <CircleAlert className="mx-auto size-10 text-blush-500" aria-hidden />
        <h1 className="display mt-4 text-4xl text-cocoa-900">Захиалга харах эрх алга</h1>
        <p className="mt-3 text-ink-3">Захиалгын дугаар, утасны дугаараараа нэвтэрч харна уу.</p>
        <Link href={`/booking?reference=${reference}`} className={cn(buttonClass('primary', 'md'), 'mt-6')}>
          Захиалгаа хайх
        </Link>
      </div>
    )
  }
  const demoVisitor = await visitorHash({ create: false })
  const [booking, salon] = await Promise.all([loadCustomerBooking(access.id, demoVisitor), getPublicSalon()])
  if (!booking) return null
  const now = new Date()
  const startsIn = hoursUntil(new Date(booking.startsAt), now)
  const active = booking.status === 'pending' || booking.status === 'confirmed' || booking.status === 'awaiting_deposit'
  const canCancel = active && startsIn > 0
  const canReschedule =
    (booking.status === 'pending' || booking.status === 'confirmed') && startsIn >= salon.rules.rescheduleNoticeHours
  const paidDeposit = booking.payments
    .filter((p) => p.kind === 'deposit' && p.status === 'paid')
    .reduce((s, p) => s + p.amount, 0)
  const tone = TONE[booking.status] ?? { box: 'border-line bg-sand text-ink-2', icon: XCircle }
  const Icon = tone.icon

  return (
    <div className="mx-auto max-w-3xl">
      {sp.new ? (
        <p className="mb-6 text-sm text-sage-700">
          Захиалга салоны системд бүртгэгдлээ. Энэ хуудасны холбоосыг хадгалаарай — цагаа өөрчлөх, цуцлахад хэрэгтэй.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <p className="eyebrow">Захиалгын дугаар</p>
        {booking.isDemo ? <DemoTag /> : null}
      </div>
      <h1 className="display tabular mt-2 text-5xl text-cocoa-900 sm:text-6xl">{booking.reference}</h1>

      <div className={cn('mt-8 flex gap-4 rounded-card border p-5', tone.box)} role="status">
        <Icon className="mt-0.5 size-6 shrink-0" aria-hidden />
        <div>
          <p className="text-lg font-medium">{booking.statusLabel}</p>
          <p className="mt-1 text-sm opacity-90">{booking.explanation}</p>
          {booking.replacement ? (
            <Link
              href={`/booking/${booking.replacement.reference}${token ? `?t=${encodeURIComponent(token)}` : ''}`}
              className="mt-2 inline-block text-sm font-medium underline underline-offset-4"
            >
              Шинэ захиалга: {booking.replacement.reference}
            </Link>
          ) : null}
          {booking.previous ? (
            <p className="mt-2 text-sm opacity-80">
              Өмнөх захиалга {booking.previous.reference}-ийн цагийг өөрчилж үүсгэсэн.
            </p>
          ) : null}
        </div>
      </div>

      {booking.status === 'awaiting_deposit' ? (
        <div className="mt-6">
          <DepositPanel
            reference={booking.reference}
            token={token}
            amount={booking.depositAmount}
            holdExpiresAt={booking.holdExpiresAt}
          />
        </div>
      ) : null}

      <section aria-label="Захиалгын дэлгэрэнгүй" className="surface mt-6 divide-y divide-line">
        <dl className="grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2 sm:p-6">
          <div>
            <dt className="text-xs font-medium tracking-wide text-ink-3 uppercase">Өдөр</dt>
            <dd className="mt-1 text-lg text-cocoa-900">{formatDateWithWeekday(booking.startsAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-ink-3 uppercase">Цаг</dt>
            <dd className="tabular mt-1 text-lg text-cocoa-900">
              {formatTimeRange(booking.startsAt, booking.endsAt)}{' '}
              <span className="text-sm text-ink-3">({formatDuration(booking.durationMinutes)})</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-ink-3 uppercase">Мастер</dt>
            <dd className="mt-1 text-cocoa-900">
              {booking.staffName}
              {!booking.staffRequested ? <span className="text-sm text-ink-3"> (систем оноосон)</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-ink-3 uppercase">Үйлчлүүлэгч</dt>
            <dd className="mt-1 text-cocoa-900">
              {booking.customerName}, <span className="tabular">{formatPhone(booking.customerPhone)}</span>
            </dd>
          </div>
        </dl>
        <div className="p-5 sm:p-6">
          <ul className="space-y-2">
            {booking.lines.map((l) => (
              <li key={l.name}>
                <div className="flex justify-between gap-4">
                  <span>
                    {l.name} <span className="text-sm text-ink-3">· {formatDuration(l.durationMinutes)}</span>
                  </span>
                  <Money amount={l.price} from={l.priceType === 'from'} />
                </div>
                {l.addons.map((a) => (
                  <div key={a.name} className="flex justify-between gap-4 pl-4 text-sm text-ink-3">
                    <span>+ {a.name}</span>
                    <Money amount={a.price} />
                  </div>
                ))}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-between border-t border-line pt-4 text-lg font-medium text-cocoa-900">
            <span>Нийт</span>
            <Money amount={booking.total} from={booking.hasFromPrice} />
          </div>
          {booking.payments.length ? (
            <ul className="mt-3 space-y-1 text-sm text-ink-2">
              {booking.payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-4">
                  <span>
                    {p.kind === 'deposit' ? 'Урьдчилгаа' : 'Төлбөр'} ·{' '}
                    {p.status === 'paid'
                      ? 'төлөгдсөн'
                      : p.status === 'pending'
                        ? 'хүлээгдэж буй'
                        : p.status === 'refunded'
                          ? 'буцаагдсан'
                          : p.status === 'expired'
                            ? 'хугацаа дууссан'
                            : 'цуцлагдсан'}
                    {p.provider === 'simulated' ? ' (туршилтын)' : ''}
                  </span>
                  <span className="tabular">{formatMoney(p.amount)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {booking.customerNote ? <p className="mt-4 text-sm text-ink-3">Тэмдэглэл: «{booking.customerNote}»</p> : null}
        </div>
      </section>

      <div className="mt-6">
        <ManageBooking
          reference={booking.reference}
          token={token}
          canCancel={canCancel}
          canReschedule={canReschedule}
          rescheduleBlockedReason={
            active && !canReschedule && startsIn > 0
              ? `Цаг эхлэхээс ${salon.rules.rescheduleNoticeHours} цагийн дотор онлайнаар өөрчлөх боломжгүй — салон руу залгана уу (${formatPhone(salon.phone)}).`
              : null
          }
          cancelWithinPolicy={startsIn >= salon.rules.cancellationNoticeHours}
          paidDeposit={paidDeposit}
          noticeHours={salon.rules.cancellationNoticeHours}
          maxAdvanceDays={salon.rules.maxAdvanceDays}
        />
      </div>

      <section aria-labelledby="history-title" className="mt-10">
        <h2 id="history-title" className="font-display text-2xl text-cocoa-900">
          Түүх
        </h2>
        <ol className="mt-4 space-y-3 border-l border-line pl-5">
          {booking.history.map((h, i) => (
            <li key={`${h.kind}-${i}`} className="relative">
              <span className="absolute top-1.5 -left-[1.42rem] size-2 rounded-full bg-cocoa-400" aria-hidden />
              <p className="text-sm text-ink">{EVENT_LABELS[h.kind] ?? h.kind}</p>
              <p className="text-xs text-ink-3">
                {formatDateTime(h.at)}
                {h.note ? ` · ${h.note}` : ''}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {booking.isDemo ? (
        <aside className="mt-12 rounded-card border border-line bg-porcelain p-5 sm:p-6">
          <p className="eyebrow">Демо</p>
          <p className="mt-2 text-[0.95rem] text-ink-2">
            {booking.ownDemoBooking
              ? 'Энэ захиалгыг та үүсгэсэн тул админ самбарын демо дээр баталгаажуулах, цуцлах, цаг шилжүүлэхийг жинхэнээр туршиж болно.'
              : 'Салоны эзэн энэ захиалгыг админ самбарын хуанли, захиалгын жагсаалтаас харна.'}
          </p>
          <Link href="/admin" className={cn(buttonClass('secondary', 'md'), 'mt-4')}>
            <LayoutDashboard className="size-4" aria-hidden /> Админ самбар үзэх
          </Link>
        </aside>
      ) : null}
    </div>
  )
}

export default function BookingPage(props: {
  params: Promise<{ reference: string }>
  searchParams: Promise<{ t?: string; new?: string }>
}) {
  return (
    <div className="container-page pt-10 pb-24 lg:pt-14">
      <Suspense
        fallback={
          <div className="mx-auto max-w-3xl space-y-4" aria-hidden>
            <div className="h-6 w-40 animate-pulse rounded-xs bg-sand" />
            <div className="h-14 w-72 animate-pulse rounded-xs bg-sand" />
            <div className="h-24 animate-pulse rounded-card bg-sand" />
          </div>
        }
      >
        <BookingContent {...props} />
      </Suspense>
    </div>
  )
}
