import Link from 'next/link'
import { connection } from 'next/server'
import { AssistantTabs } from '@/components/admin/assistant/tabs'
import { Card, EmptyState, PageHeader, TableWrap, td, th } from '@/components/admin/ui'
import { Badge } from '@/components/ui/badge'
import { redactCustomerText } from '@/lib/assistant/redact'
import { formatDateTime } from '@/lib/datetime'
import { requireAdminPage } from '@/server/auth/current'
import { assistantProblems, EVENT_LABELS } from '@/server/queries/admin-assistant'

export const metadata = { title: 'Асуудал · AI туслах' }

const HINTS: Record<string, string> = {
  unsupported: 'Мэдлэг хэсэгт асуулт, хариулт нэмж болно.',
  unanswered_topic: 'Бэлтгэл, зогсоол зэрэг мэдээллийг «Мэдлэг»-т нэмнэ үү.',
  booking_failed: 'Ихэвчлэн цаг дөнгөж захиалагдсан, эсвэл давхар захиалга оролдсон.',
  verify_failed: 'Захиалгын дугаар, утас таараагүй — олон удаа бол анхаарна уу.',
  model_error: 'AI үйлчилгээ хариу өгөөгүй; туслах дүрмээр үргэлжилсэн.',
  model_rejected: 'AI-ийн хариулт баримтын шалгалтад унасан тул илгээгээгүй.',
  budget_exceeded: 'Өдрийн зардлын хязгаар хүрсэн; туслах дүрмээр хариулсан.',
  engine_error: 'Системийн алдаа: үйлчлүүлэгчид утасны дугаар өгсөн.',
  backend_timeout: 'Өгөгдлийн сан удаан хариулсан.',
}

export default async function AssistantProblemsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const session = await requireAdminPage('assistant.view')
  await connection()
  const days = [1, 7, 30].includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 7
  const { byKind, latest } = await assistantProblems(session.salonId, new Date(), days)
  const contacts = !session.isDemo && session.permissions.includes('customers.contact')
  return (
    <>
      <PageHeader
        title="AI туслах"
        description="Туслах хариулж чадаагүй асуулт, амжилтгүй болсон үйлдэл, AI болон системийн алдаа. Туршилтын яриаг оруулаагүй."
      />
      <AssistantTabs current="problems" problems={byKind.reduce((a, k) => a + k.n, 0)} />
      <div className="mb-4 flex gap-2 text-sm">
        {[1, 7, 30].map((d) => (
          <Link key={d} href={`/admin/assistant/problems?days=${d}`} className={d === days ? 'font-medium underline' : 'text-ink-3'}>
            {d === 1 ? '24 цаг' : `${d} хоног`}
          </Link>
        ))}
      </div>
      {byKind.length ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {byKind.map((k) => (
            <Card key={`${k.kind}-${k.level}`}>
              <p className="flex items-center justify-between gap-2 text-sm font-medium">
                {EVENT_LABELS[k.kind] ?? k.kind}
                <Badge tone={k.level === 'error' ? 'danger' : 'warning'}>{k.n}</Badge>
              </p>
              {HINTS[k.kind] ? <p className="mt-1 text-xs text-ink-3">{HINTS[k.kind]}</p> : null}
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="Асуудал алга">Энэ хугацаанд туслах бүх асуултад хариулж, үйлдлүүд амжилттай болсон.</EmptyState>
      )}
      {latest.length ? (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Хэзээ</th>
              <th className={th}>Асуудал</th>
              <th className={th}>Үйлчлүүлэгчийн мессеж</th>
              <th className={th}>Яриа</th>
            </tr>
          </thead>
          <tbody>
            {latest.map(({ e, question, meta }) => (
              <tr key={e.id}>
                <td className={`${td} whitespace-nowrap`}>{formatDateTime(e.createdAt)}</td>
                <td className={td}>
                  {EVENT_LABELS[e.kind] ?? e.kind} <Badge tone={e.level === 'error' ? 'danger' : 'warning'}>{e.level}</Badge>
                </td>
                <td className={`${td} max-w-md`}>
                  {question
                    ? contacts
                      ? question
                      : redactCustomerText(question, Boolean((meta as { sensitive?: boolean } | null)?.sensitive))
                    : '—'}
                </td>
                <td className={td}>
                  {e.sessionId ? (
                    <Link href={`/admin/assistant/conversations?session=${e.sessionId}`} className="underline">
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
      ) : null}
    </>
  )
}
