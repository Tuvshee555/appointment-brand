import Link from 'next/link'
import { connection } from 'next/server'
import { AssistantTabs } from '@/components/admin/assistant/tabs'
import { Card, EmptyState, PageHeader, Pager, TableWrap, td, th } from '@/components/admin/ui'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/datetime'
import { requireAdminPage } from '@/server/auth/current'
import { assistantActivity, EVENT_LABELS } from '@/server/queries/admin-assistant'

export const metadata = { title: 'Үйл ажиллагаа · AI туслах' }

const PAGE_SIZE = 50

export default async function AssistantActivityPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await requireAdminPage('assistant.view')
  await connection()
  const page = Math.max(1, Math.floor(Number((await searchParams).page)) || 1)
  const { events, total, audits } = await assistantActivity(session.salonId, page, PAGE_SIZE)
  return (
    <>
      <PageHeader
        title="AI туслах"
        description="Туслахын хийсэн үйлдэл (захиалга, цуцлалт, шилжүүлэлт, баталгаажуулалт) болон ажилтны тохиргоо, мэдлэгийн өөрчлөлт. Мессежийн агуулга энд хадгалагдахгүй."
      />
      <AssistantTabs current="activity" />
      {audits.length ? (
        <Card title="Ажилтны өөрчлөлт" className="mb-6">
          <ul className="space-y-1.5 text-sm">
            {audits.map(({ a, name }) => (
              <li key={a.id}>
                <span className="text-ink-3">{formatDateTime(a.createdAt)}</span> · {name ?? 'Систем'} · {a.summary}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {events.length ? (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Хэзээ</th>
              <th className={th}>Үйлдэл</th>
              <th className={th}>Захиалга</th>
              <th className={th}>Яриа</th>
            </tr>
          </thead>
          <tbody>
            {events.map(({ e, reference }) => (
              <tr key={e.id}>
                <td className={`${td} whitespace-nowrap`}>{formatDateTime(e.createdAt)}</td>
                <td className={td}>
                  {EVENT_LABELS[e.kind] ?? e.kind}{' '}
                  {e.level !== 'info' ? (
                    <Badge tone={e.level === 'error' ? 'danger' : 'warning'}>{e.level}</Badge>
                  ) : null}
                  {e.isTest ? <Badge tone="muted">туршилт</Badge> : null}
                </td>
                <td className={td}>
                  {e.appointmentId && reference ? (
                    <Link href={`/admin/appointments/${e.appointmentId}`} className="underline">
                      {reference}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className={td}>
                  {e.sessionId ? (
                    <Link
                      href={`/admin/assistant/conversations?filter=${e.isTest ? 'test' : 'all'}&session=${e.sessionId}`}
                      className="underline"
                    >
                      Харах
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <EmptyState title="Үйл ажиллагаа алга" />
      )}
      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        href={(p) => `/admin/assistant/activity?page=${p}`}
        unit="бичлэг"
      />
    </>
  )
}
