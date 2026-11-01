import { asc, desc, eq, inArray } from 'drizzle-orm'
import Link from 'next/link'
import { connection } from 'next/server'
import { Card, EmptyState, PageHeader, StatCard } from '@/components/admin/ui'
import { Badge, DemoTag } from '@/components/ui/badge'
import type { ChatPart } from '@/lib/assistant/types'
import { formatDateTime } from '@/lib/datetime'
import { cn } from '@/lib/cn'
import { AI_MODEL, aiConfigured, spentToday } from '@/server/assistant/llm'
import { requireAdminPage } from '@/server/auth/current'
import { db } from '@/server/db'
import * as t from '@/server/db/schema'

export const metadata = { title: 'AI туслах' }

export default async function AssistantAdminPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const session = await requireAdminPage('assistant.view')
  await connection()
  const sp = await searchParams
  const now = new Date()
  const sessions = await db
    .select()
    .from(t.chatSessions)
    .where(eq(t.chatSessions.salonId, session.salonId))
    .orderBy(desc(t.chatSessions.lastMessageAt))
    .limit(40)
  const selected = sessions.find((s) => s.id === sp.session) ?? sessions[0] ?? null
  const messages = selected
    ? await db
        .select()
        .from(t.chatMessages)
        .where(eq(t.chatMessages.sessionId, selected.id))
        .orderBy(asc(t.chatMessages.createdAt))
    : []
  const booked = sessions.filter((s) => s.appointmentId).map((s) => s.appointmentId!)
  const refs = booked.length
    ? await db
        .select({ id: t.appointments.id, reference: t.appointments.reference })
        .from(t.appointments)
        .where(inArray(t.appointments.id, booked))
    : []
  const spent = await spentToday({ db, salonId: session.salonId, actor: null, now })
  const budget = Number(process.env.AI_DAILY_BUDGET_USD ?? 2)
  const messenger = Boolean(
    process.env.MESSENGER_PAGE_TOKEN && process.env.MESSENGER_APP_SECRET && process.env.MESSENGER_VERIFY_TOKEN,
  )
  return (
    <>
      <PageHeader
        title="AI туслах"
        description="Туслах үнэ, хугацаа, мастер, сул цагийг салоны өгөгдлийн сангаас уншина. Захиалгыг өөрөө баталгаажуулдаггүй — үйлчлүүлэгч хураангуйг шалгаад «Баталгаажуулах» дарна."
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Горим"
          value={aiConfigured() ? 'AI' : 'Дүрэм'}
          hint={aiConfigured() ? AI_MODEL : 'ANTHROPIC_API_KEY тохируулаагүй — дүрэмд суурилсан хариулт'}
        />
        <StatCard label="Өнөөдрийн AI зардал" value={`$${spent.toFixed(2)}`} hint={`Өдрийн дээд хязгаар $${budget}`} />
        <StatCard label="Яриа" value={sessions.length} hint="сүүлийн 40" />
        <StatCard label="Туслахаар үүссэн захиалга" value={booked.length} />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="surface p-4 text-sm">
          <p className="flex items-center justify-between font-medium">
            Вэбсайт чат <Badge tone="success">Идэвхтэй</Badge>
          </p>
          <p className="mt-1 text-xs text-ink-3">Баруун доод булан дахь туслах. IP тус бүрээр хязгаартай.</p>
        </div>
        <div className="surface p-4 text-sm">
          <p className="flex items-center justify-between font-medium">
            Facebook Messenger{' '}
            <Badge tone={messenger ? 'success' : 'muted'}>{messenger ? 'Тохируулсан' : 'Бэлтгэсэн, идэвхгүй'}</Badge>
          </p>
          <p className="mt-1 text-xs text-ink-3">
            Webhook (/api/messenger/webhook) гарын үсэг шалгадаг, ижил хөдөлгүүр ашиглана. Идэвхжүүлэхэд Meta апп,
            хуудасны token, pages_messaging зөвшөөрөл шаардлагатай.
          </p>
        </div>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[22rem_1fr]">
        <Card title="Яриа" bodyClassName="p-0">
          {sessions.length ? (
            <ul className="max-h-[36rem] divide-y divide-line overflow-y-auto">
              {sessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/admin/assistant?session=${s.id}`}
                    className={cn('block px-4 py-3 text-sm hover:bg-ivory', selected?.id === s.id && 'bg-cocoa-50')}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span>{formatDateTime(s.lastMessageAt)}</span>
                      <span className="flex gap-1">
                        {s.isDemo ? <DemoTag /> : null}
                        {s.handedOff ? <Badge tone="warning">Ажилтанд</Badge> : null}
                        {s.appointmentId ? <Badge tone="success">Захиалга</Badge> : null}
                      </span>
                    </span>
                    <span className="text-xs text-ink-3">
                      {s.channel === 'messenger' ? 'Messenger' : 'Вэбсайт'} · {s.messageCount} мессеж
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-5">
              <EmptyState title="Яриа алга" />
            </div>
          )}
        </Card>
        <Card title="Яриа харах">
          {selected ? (
            <div className="space-y-3">
              {messages.map((m) => {
                const parts = ((m.meta as { parts?: ChatPart[] } | null)?.parts ?? []) as ChatPart[]
                const mode = (m.meta as { mode?: string } | null)?.mode
                return (
                  <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[80%] rounded-card px-3.5 py-2.5 text-sm',
                        m.role === 'user' ? 'bg-cocoa-800 text-ivory' : 'border border-line bg-porcelain',
                      )}
                    >
                      <p className="whitespace-pre-line">{m.content}</p>
                      {m.role === 'assistant' ? (
                        <p className="mt-1 text-[0.68rem] text-ink-3">
                          {mode === 'ai' ? 'AI' : 'дүрэм'}
                          {parts.some((p) => p.type === 'booking') ? ' · захиалга үүсгэсэн' : ''} ·{' '}
                          {formatDateTime(m.createdAt)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                )
              })}
              {selected.appointmentId ? (
                <p className="text-sm">
                  Үүссэн захиалга:{' '}
                  <Link href={`/admin/appointments/${selected.appointmentId}`} className="underline">
                    {refs.find((r) => r.id === selected.appointmentId)?.reference ?? 'харах'}
                  </Link>
                </p>
              ) : null}
            </div>
          ) : (
            <EmptyState title="Яриа сонгоно уу" />
          )}
        </Card>
      </div>
    </>
  )
}
