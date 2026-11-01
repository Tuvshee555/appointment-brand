import { ArrowRight, Plus } from 'lucide-react'
import Link from 'next/link'
import { connection } from 'next/server'
import { ActionButton } from '@/components/admin/action-button'
import { RankBars, RevenueBars } from '@/components/admin/charts'
import { Card, EmptyState, PageHeader, StatCard } from '@/components/admin/ui'
import { StaffAvatar } from '@/components/catalog/staff-card'
import { buttonClass } from '@/components/ui/button'
import { DemoTag, StatusBadge } from '@/components/ui/badge'
import { dateKeyOf, formatDateKey, formatDateTime, formatDuration, formatTime, formatTimeRange } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { transitionAction } from '@/server/actions/admin-appointments'
import { requireAdminPage } from '@/server/auth/current'
import { loadDashboard } from '@/server/queries/admin-dashboard'

export const metadata = { title: 'Тойм' }

const EVENT_LABELS: Record<string, string> = {
  created: 'шинэ захиалга',
  confirmed: 'баталгаажсан',
  deposit_paid: 'урьдчилгаа төлөгдсөн',
  cancelled: 'цуцлагдсан',
  rejected: 'татгалзсан',
  rescheduled: 'цаг өөрчлөгдсөн',
  completed: 'үйлчилгээ дууссан',
  no_show: 'ирээгүй',
  hold_expired: 'урьдчилгааны хугацаа дууссан',
  payment_recorded: 'төлбөр бүртгэгдсэн',
  request_expired: 'хүсэлтийн хугацаа дууссан',
  late_payment: 'хоцорсон төлбөр',
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const session = await requireAdminPage('dashboard.view')
  await connection()
  const now = new Date()
  const [data, sp] = await Promise.all([loadDashboard(session, now), searchParams])
  const scoped = session.role === 'specialist'

  return (
    <>
      <PageHeader
        eyebrow={formatDateKey(data.today)}
        title={scoped ? 'Миний өдөр' : 'Өнөөдрийн тойм'}
        description={
          scoped
            ? 'Мастерын эрх: зөвхөн өөрийн захиалга, хуваарь харагдана.'
            : 'Бүх тоо салоны өгөгдлийн сангаас шууд тооцоологдоно (жишээ өгөгдөл).'
        }
        actions={
          session.permissions.includes('appointments.view') ? (
            <Link href="/admin/appointments/new" className={buttonClass('primary', 'md')}>
              <Plus className="size-4" aria-hidden /> Захиалга нэмэх
            </Link>
          ) : null
        }
      />
      {sp.denied ? <p className="mb-6 rounded-xs bg-amber-50 px-4 py-3 text-sm text-amber-700">Тэр хэсгийг харах эрх танд алга.</p> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Өнөөдөр" value={data.counts.today} hint="захиалга" tone="accent" />
        <StatCard label="Ойрын 7 хоног" value={data.counts.upcoming} hint="идэвхтэй захиалга" />
        <StatCard label="Хүлээгдэж буй" value={data.counts.pending} hint="баталгаажуулах хүсэлт" tone={data.counts.pending ? 'warning' : 'default'} />
        <StatCard label="Дууссан" value={data.counts.completedMonth} hint="энэ сард" />
        <StatCard label="Цуцалсан" value={data.counts.cancelledMonth} hint="энэ сард" />
        <StatCard label="Ирээгүй" value={data.counts.noShowMonth} hint="энэ сард" tone={data.counts.noShowMonth ? 'danger' : 'default'} />
      </div>

      {data.revenue ? (
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <StatCard label="Өнөөдрийн орлого" value={formatMoney(data.revenue.today)} hint="баталгаажсан төлбөр" />
          <StatCard label="Энэ долоо хоног" value={formatMoney(data.revenue.week)} hint="Даваагаас хойш" />
          <StatCard label="Энэ сар" value={formatMoney(data.revenue.month)} hint="буцаалт хассан" />
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <Card
          title="Өнөөдрийн цагийн хуваарь"
          action={
            <Link href="/admin/calendar" className="inline-flex items-center gap-1 text-sm text-cocoa-700 hover:text-cocoa-900">
              Хуанли <ArrowRight className="size-4" aria-hidden />
            </Link>
          }
          bodyClassName="p-0"
        >
          {data.todayList.length === 0 ? (
            <div className="p-5">
              <EmptyState title="Өнөөдөр захиалга алга" />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {data.todayList.map((a) => (
                <li key={a.id}>
                  <Link href={`/admin/appointments/${a.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-ivory">
                    <span className="w-24 shrink-0 text-sm text-cocoa-900 tabular">{formatTimeRange(a.startsAt, a.endsAt)}</span>
                    <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: a.staffColor }} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">
                        {a.customerName} {a.isDemo ? <DemoTag className="ml-1" /> : null}
                      </span>
                      <span className="block truncate text-xs text-ink-3">
                        {a.services} · {a.staffName}
                      </span>
                    </span>
                    <StatusBadge status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Баталгаажуулах хүсэлт (${data.pendingRequests.length})`} bodyClassName="p-0">
          {data.pendingRequests.length === 0 ? (
            <div className="p-5">
              <EmptyState title="Хүлээгдэж буй хүсэлт алга" />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {data.pendingRequests.map((r) => (
                <li key={r.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/admin/appointments/${r.id}`} className="min-w-0 hover:underline">
                      <span className="block text-sm font-medium text-ink">
                        {r.customerName}
                        {r.demoVisitorHash && session.demoVisitorHash === r.demoVisitorHash ? (
                          <span className="ml-2 rounded-xs bg-sage-50 px-1.5 py-0.5 text-[0.68rem] text-sage-700">таны туршилт</span>
                        ) : null}
                      </span>
                      <span className="block text-xs text-ink-3">
                        {formatDateTime(r.startsAt)} · {r.staffName} · {r.reference}
                      </span>
                    </Link>
                    <StatusBadge status={r.status} />
                  </div>
                  {r.status === 'pending' && session.permissions.includes('appointments.view') && !scoped ? (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <ActionButton action={transitionAction.bind(null, { appointmentId: r.id, to: 'confirmed' })} variant="primary" okText="Баталгаажлаа.">
                        Баталгаажуулах
                      </ActionButton>
                      <ActionButton
                        action={transitionAction.bind(null, { appointmentId: r.id, to: 'rejected', note: 'Тухайн цагт боломжгүй' })}
                        variant="ghost"
                        okText="Татгалзлаа."
                        confirm="Энэ хүсэлтээс татгалзах уу?"
                      >
                        Татгалзах
                      </ActionButton>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {data.revenue ? (
          <Card title="Сүүлийн 14 хоногийн орлого">
            <RevenueBars data={data.revenue.daily} />
            <p className="mt-3 text-xs text-ink-3">Төлбөрийн системээр баталгаажсан болон ажилтны бүртгэсэн төлбөр. Буцаасан төлбөр орохгүй.</p>
          </Card>
        ) : null}
        <Card title="Эрэлттэй үйлчилгээ (30 хоног)">
          {data.popular.length ? <RankBars rows={data.popular.map((p) => ({ label: p.name, value: p.n }))} format={(n) => `${n} удаа`} /> : <EmptyState title="Мэдээлэл алга" />}
        </Card>
        <Card title="Өнөөдрийн мастерууд">
          <ul className="space-y-3">
            {data.staffToday.map((s) => (
              <li key={s.id} className="flex items-center gap-3">
                <StaffAvatar staff={{ photoUrl: s.photoUrl, photoAlt: s.name, displayName: s.name }} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{s.name}</p>
                  <p className="text-xs text-ink-3">
                    {s.working
                      ? `${formatDuration(s.bookedMinutes)} захиалгатай · ${formatDuration(Math.max(0, s.shiftMinutes - s.bookedMinutes))} сул`
                      : s.timeOff?.fullDay
                        ? 'Чөлөөтэй (амралт)'
                        : 'Амралтын өдөр'}
                  </p>
                </div>
                <span className={`size-2 rounded-full ${s.working ? 'bg-sage-600' : 'bg-line-strong'}`} aria-label={s.working ? 'ажиллаж байна' : 'ажиллахгүй'} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Сүүлийн үйл явдал" className="mt-6" bodyClassName="p-0">
        <ul className="divide-y divide-line">
          {data.activity.map((a, i) => (
            <li key={i} className="flex items-start gap-4 px-5 py-3 text-sm">
              <span className="w-28 shrink-0 text-xs text-ink-3 tabular">
                {dateKeyOf(a.at) === data.today ? formatTime(a.at) : formatDateTime(a.at)}
              </span>
              {a.type === 'event' ? (
                <Link href={`/admin/appointments/${a.appointmentId}`} className="min-w-0 flex-1 hover:underline">
                  <span className="font-medium text-ink">{a.reference}</span> · {a.customerName} — {EVENT_LABELS[a.kind] ?? a.kind}
                  {a.actorType === 'assistant' ? ' (AI туслахаар)' : a.actorType === 'customer' ? ' (үйлчлүүлэгч)' : ''}
                </Link>
              ) : (
                <span className="min-w-0 flex-1 text-ink-2">{a.summary}</span>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}
