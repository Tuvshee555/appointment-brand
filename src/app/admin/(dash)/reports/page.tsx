import Link from 'next/link'
import { connection } from 'next/server'
import { RankBars, RevenueBars } from '@/components/admin/charts'
import { Card, PageHeader, StatCard, TableWrap, td, th } from '@/components/admin/ui'
import { SOURCE_LABELS } from '@/lib/booking/status'
import { formatDateKey, formatDuration } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/cn'
import { requireAdminPage } from '@/server/auth/current'
import { loadReports, type ReportPeriod } from '@/server/queries/admin-reports'

export const metadata = { title: 'Тайлан' }

const PERIODS: Record<ReportPeriod, string> = {
  '30d': '30 хоног',
  this_month: 'Энэ сар',
  last_month: 'Өмнөх сар',
  '90d': '90 хоног',
}
const pct = (v: number) => `${Math.round(v * 100)}%`

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const session = await requireAdminPage('reports.view')
  await connection()
  const sp = await searchParams
  const period: ReportPeriod = sp.period && sp.period in PERIODS ? (sp.period as ReportPeriod) : '30d'
  const r = await loadReports(session.salonId, period, new Date())
  return (
    <>
      <PageHeader
        title="Тайлан"
        description={`${formatDateKey(r.range.from)} – ${formatDateKey(r.range.to)}. Бүх үзүүлэлт захиалга, төлбөрийн бүртгэлээс тооцоологдсон (жишээ өгөгдөл).`}
        actions={
          <div className="inline-flex rounded-xs border border-line-strong bg-porcelain p-0.5">
            {(Object.keys(PERIODS) as ReportPeriod[]).map((p) => (
              <Link
                key={p}
                href={`/admin/reports?period=${p}`}
                className={cn(
                  'rounded-[3px] px-3 py-1.5 text-sm',
                  period === p ? 'bg-cocoa-800 text-ivory' : 'text-ink-2 hover:bg-sand',
                )}
              >
                {PERIODS[p]}
              </Link>
            ))}
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <StatCard
          label="Орлого"
          value={formatMoney(r.revenue.paid)}
          hint={r.revenue.refunded ? `буцаалт ${formatMoney(r.revenue.refunded)}` : 'буцаалтгүй'}
          tone="accent"
        />
        <StatCard label="Нийт захиалга" value={r.totals.total} />
        <StatCard label="Гүйцэтгэл" value={pct(r.totals.completionRate)} hint={`${r.totals.completed} дууссан`} />
        <StatCard label="Цуцлалт" value={pct(r.totals.cancellationRate)} hint={`${r.totals.cancelled} захиалга`} />
        <StatCard
          label="Ирээгүй"
          value={pct(r.totals.noShowRate)}
          hint={`${r.totals.noShow} удаа`}
          tone={r.totals.noShow ? 'danger' : 'default'}
        />
        <StatCard
          label="Давтан үйлчлүүлэгч"
          value={r.retention.customers ? pct(r.retention.returning / r.retention.customers) : '—'}
          hint={`${r.retention.returning} давтан · ${r.retention.newCustomers} шинэ`}
        />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card title="Өдөр тутмын орлого">
          <RevenueBars data={r.revenue.daily} height={170} />
        </Card>
        <Card title="Захиалгын эх сурвалж">
          <RankBars
            rows={r.sources.map((s) => ({ label: SOURCE_LABELS[s.source] ?? s.source, value: s.n }))}
            format={(n) => `${n}`}
          />
        </Card>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.35fr]">
        <Card title="Эрэлттэй үйлчилгээ" bodyClassName="p-0">
          <TableWrap bare minWidth="min-w-[24rem]">
            <thead>
              <tr>
                <th className={th}>Үйлчилгээ</th>
                <th className={cn(th, 'text-right')}>Захиалга</th>
                <th className={cn(th, 'text-right')}>Орлого (дууссан)</th>
              </tr>
            </thead>
            <tbody>
              {r.services.map((s) => (
                <tr key={s.name}>
                  <td className={td}>{s.name}</td>
                  <td className={cn(td, 'tabular text-right')}>{s.n}</td>
                  <td className={cn(td, 'tabular text-right')}>{formatMoney(s.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
        <Card title="Мастерын гүйцэтгэл" bodyClassName="p-0">
          <TableWrap bare minWidth="min-w-[32rem]">
            <thead>
              <tr>
                <th className={th}>Мастер</th>
                <th className={cn(th, 'text-right')}>Дууссан</th>
                <th className={cn(th, 'text-right')}>Орлого</th>
                <th className={cn(th, 'text-right')}>Ачаалал</th>
                <th className={cn(th, 'text-right')}>Ирээгүй</th>
              </tr>
            </thead>
            <tbody>
              {r.staff.map((s) => (
                <tr key={s.staffId}>
                  <td className={td}>
                    <span className="inline-flex items-center gap-2">
                      <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
                      {s.name}
                    </span>
                  </td>
                  <td className={cn(td, 'tabular text-right')}>{s.completed}</td>
                  <td className={cn(td, 'tabular text-right')}>{formatMoney(s.revenue)}</td>
                  <td
                    className={cn(td, 'tabular text-right')}
                    title={`${formatDuration(s.bookedMinutes)} / ${formatDuration(s.scheduledMinutes)}`}
                  >
                    {pct(s.utilisation)}
                  </td>
                  <td className={cn(td, 'tabular text-right')}>{s.noShows}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <p className="px-5 py-3 text-xs text-ink-3">Ачаалал = захиалгатай минут ÷ ажлын хуваарийн минут.</p>
        </Card>
      </div>
    </>
  )
}
