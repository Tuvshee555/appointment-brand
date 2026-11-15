import Link from 'next/link'
import { connection } from 'next/server'
import { AssistantTabs } from '@/components/admin/assistant/tabs'
import { Card, EmptyState, PageHeader, StatCard, TableWrap, td, th } from '@/components/admin/ui'
import { formatShortDate } from '@/lib/datetime'
import { cn } from '@/lib/cn'
import { requireAdminPage } from '@/server/auth/current'
import { assistantAnalytics, HANDOFF_LABELS } from '@/server/queries/admin-assistant'

export const metadata = { title: 'Аналитик · AI туслах' }

const RANGES = [7, 30, 90]

export default async function AssistantAnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const session = await requireAdminPage('assistant.view')
  await connection()
  const sp = await searchParams
  const days = RANGES.includes(Number(sp.days)) ? Number(sp.days) : 30
  const a = await assistantAnalytics(session.salonId, new Date(), days)
  const max = Math.max(1, ...a.series.map((d) => d.conversations))
  const aiReplies = a.modes.find((m) => m.mode === 'ai')?.n ?? 0
  const allReplies = a.modes.reduce((s, m) => s + m.n, 0)
  return (
    <>
      <PageHeader
        title="AI туслах"
        description="Туслахын яриа, үүсгэсэн захиалга, ажилтанд шилжүүлэлт, AI-ийн зардал. Туршилтын яриаг тооцохгүй."
      />
      <AssistantTabs current="analytics" />
      <div className="mb-4 flex gap-2">
        {RANGES.map((r) => (
          <Link
            key={r}
            href={`/admin/assistant/analytics?days=${r}`}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm',
              r === days ? 'border-cocoa-800 bg-cocoa-800 text-ivory' : 'border-line-strong',
            )}
          >
            {r} хоног
          </Link>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Яриа"
          value={a.totals.conversations}
          hint={`${(a.totals.conversion * 100).toFixed(0)}% нь захиалгатай дууссан`}
        />
        <StatCard
          label="Туслахаар захиалга"
          value={a.totals.bookings}
          hint={`цуцлалт ${a.totals.cancels} · шилжүүлэлт ${a.totals.reschedules}`}
        />
        <StatCard
          label="Ажилтанд шилжүүлсэн"
          value={a.totals.handoffs}
          hint={`хариулж чадаагүй ${a.totals.unanswered}`}
        />
        <StatCard
          label="AI зардал"
          value={`$${a.usageCost.toFixed(2)}`}
          hint={`AI хариулт ${allReplies ? Math.round((aiReplies / allReplies) * 100) : 0}% · дундаж ${a.durations.avg} мс`}
        />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="Өдрөөр (яриа · захиалга · шилжүүлэлт)">
          <ul className="space-y-1.5">
            {a.series.slice(-Math.min(days, 31)).map((d) => (
              <li key={d.day} className="grid grid-cols-[3.5rem_1fr_5rem] items-center gap-2 text-xs">
                <span className="tabular text-ink-3">{formatShortDate(d.day)}</span>
                <span className="h-2.5 rounded-full bg-sand">
                  <span
                    className="block h-2.5 rounded-full bg-cocoa-700"
                    style={{ width: `${(d.conversations / max) * 100}%` }}
                  />
                </span>
                <span className="tabular text-right text-ink-2">
                  {d.conversations} · {d.bookings} · {d.handoffs}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-6">
          <Card title="Юу асуусан бэ (хариултын төрөл)" bodyClassName="p-0">
            {a.intents.length ? (
              <TableWrap bare minWidth="min-w-0">
                <tbody>
                  {a.intents.map((i) => (
                    <tr key={i.intent ?? '-'}>
                      <td className={td}>{i.intent ?? '—'}</td>
                      <td className={cn(td, 'tabular text-right')}>{i.n}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            ) : (
              <div className="p-5">
                <EmptyState title="Өгөгдөл алга" />
              </div>
            )}
          </Card>
          <Card title="Ажилтанд шилжүүлсэн шалтгаан">
            {a.reasons.length ? (
              <ul className="space-y-1 text-sm">
                {a.reasons.map((r) => (
                  <li key={r.reason ?? '-'} className="flex justify-between">
                    <span>{HANDOFF_LABELS[r.reason ?? ''] ?? r.reason}</span>
                    <span className="tabular">{r.n}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">Шилжүүлэлт алга.</p>
            )}
          </Card>
        </div>
      </div>
      <Card title="AI загварын хэрэглээ, тооцоолсон зардал" className="mt-6" bodyClassName="p-0">
        {a.usage.length ? (
          <TableWrap bare>
            <thead>
              <tr>
                <th className={th}>Загвар</th>
                <th className={cn(th, 'text-right')}>Дуудлага</th>
                <th className={cn(th, 'text-right')}>Алдаа</th>
                <th className={cn(th, 'text-right')}>Токен (оролт / гаралт)</th>
                <th className={cn(th, 'text-right')}>Зардал</th>
              </tr>
            </thead>
            <tbody>
              {a.usage.map((u) => (
                <tr key={u.model}>
                  <td className={td}>{u.model}</td>
                  <td className={cn(td, 'tabular text-right')}>{u.calls}</td>
                  <td className={cn(td, 'tabular text-right')}>{u.failures}</td>
                  <td className={cn(td, 'tabular text-right')}>
                    {u.input.toLocaleString('en-US')} / {u.output.toLocaleString('en-US')}
                  </td>
                  <td className={cn(td, 'tabular text-right')}>${u.cost.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <div className="p-5">
            <EmptyState title="AI дуудлага алга">
              AI түлхүүр тохируулаагүй эсвэл бүх асуултад дүрмээр хариулсан.
            </EmptyState>
          </div>
        )}
      </Card>
    </>
  )
}
