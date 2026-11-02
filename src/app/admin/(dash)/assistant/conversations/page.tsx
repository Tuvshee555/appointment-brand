import Link from 'next/link'
import { connection } from 'next/server'
import { ConversationActions } from '@/components/admin/assistant/forms'
import { AssistantTabs } from '@/components/admin/assistant/tabs'
import { Card, EmptyState, PageHeader, Pager } from '@/components/admin/ui'
import { Badge, DemoTag } from '@/components/ui/badge'
import { redactCustomerText, redactParts } from '@/lib/assistant/redact'
import type { ChatPart } from '@/lib/assistant/types'
import { formatDateTime } from '@/lib/datetime'
import { cn } from '@/lib/cn'
import { requireAdminPage } from '@/server/auth/current'
import {
  conversationDetail,
  EVENT_LABELS,
  HANDOFF_LABELS,
  listConversations,
  STATUS_LABELS_CHAT,
  type ConversationFilter,
} from '@/server/queries/admin-assistant'

export const metadata = { title: 'Харилцан яриа · AI туслах' }

const FILTERS: Record<ConversationFilter, string> = {
  all: 'Бүгд',
  attention: 'Ажилтан хүлээж буй',
  staff: 'Ажилтан хариулж буй',
  booked: 'Захиалгатай',
  test: 'Туршилт',
}
const PAGE_SIZE = 30
const tone = (status: string) =>
  status === 'handoff' ? 'warning' : status === 'staff' ? 'info' : status === 'closed' ? 'muted' : 'neutral'

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string; session?: string }>
}) {
  const session = await requireAdminPage('assistant.view')
  await connection()
  const sp = await searchParams
  const filter: ConversationFilter = sp.filter && sp.filter in FILTERS ? (sp.filter as ConversationFilter) : 'all'
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1)
  const { rows, total } = await listConversations(session.salonId, filter, page, PAGE_SIZE)
  const selectedId = sp.session ?? rows[0]?.s.id
  const detail = selectedId ? await conversationDetail(session.salonId, selectedId) : null
  const contacts = !session.isDemo && session.permissions.includes('customers.contact')
  const canReply = session.permissions.includes('assistant.reply')
  const href = (f: ConversationFilter, p = 1, s?: string) =>
    `/admin/assistant/conversations?filter=${f}${p > 1 ? `&page=${p}` : ''}${s ? `&session=${s}` : ''}`

  return (
    <>
      <PageHeader
        title="AI туслах"
        description={
          contacts
            ? 'Үйлчлүүлэгчтэй хийсэн яриа. Ажилтан хариулахаар авбал туслах чимээгүй болж, таны хариулт үйлчлүүлэгчийн чатад харагдана.'
            : 'Үйлчлүүлэгчтэй хийсэн яриа. Холбоо барих мэдээллийг нууцалсан (харилцагчийн холбоо барих эрх шаардлагатай).'
        }
      />
      <AssistantTabs current="conversations" />
      <div className="mb-4 flex flex-wrap gap-2">
        {Object.entries(FILTERS).map(([k, label]) => (
          <Link
            key={k}
            href={href(k as ConversationFilter)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm',
              filter === k
                ? 'border-cocoa-800 bg-cocoa-800 text-ivory'
                : 'border-line-strong text-ink-2 hover:border-cocoa-700',
            )}
          >
            {label}
          </Link>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[22rem_1fr]">
        <Card title="Яриа" bodyClassName="p-0">
          {rows.length ? (
            <ul className="max-h-[40rem] divide-y divide-line overflow-y-auto">
              {rows.map(({ s, reference }) => (
                <li key={s.id}>
                  <Link
                    href={href(filter, page, s.id)}
                    className={cn('block px-4 py-3 text-sm hover:bg-ivory', selectedId === s.id && 'bg-cocoa-50')}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span>{formatDateTime(s.lastMessageAt)}</span>
                      <span className="flex gap-1">
                        {s.isDemo ? <DemoTag /> : null}
                        <Badge tone={tone(s.status)}>{STATUS_LABELS_CHAT[s.status] ?? s.status}</Badge>
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-3">
                      {s.channel === 'messenger' ? 'Messenger' : s.channel === 'test' ? 'Туршилт' : 'Вэбсайт'} ·{' '}
                      {s.messageCount} мессеж
                      {reference ? ` · ${reference}` : ''}
                      {s.handoffReason ? ` · ${HANDOFF_LABELS[s.handoffReason] ?? s.handoffReason}` : ''}
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
        <Card
          title={detail ? `Яриа · ${STATUS_LABELS_CHAT[detail.s.status] ?? detail.s.status}` : 'Яриа'}
          action={
            detail?.reference && detail.s.appointmentId ? (
              <Link href={`/admin/appointments/${detail.s.appointmentId}`} className="text-sm underline">
                {detail.reference}
              </Link>
            ) : null
          }
        >
          {detail ? (
            <div className="space-y-5">
              <div className="space-y-3">
                {detail.messages.map((m) => {
                  const meta = (m.meta ?? {}) as {
                    parts?: ChatPart[]
                    mode?: string
                    intent?: string
                    sensitive?: boolean
                  }
                  const parts = meta.parts ?? []
                  const shown = contacts ? parts : redactParts(parts)
                  return (
                    <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                      <div
                        className={cn(
                          'max-w-[85%] rounded-card px-3.5 py-2.5 text-sm',
                          m.role === 'user'
                            ? 'bg-cocoa-800 text-ivory'
                            : m.role === 'staff'
                              ? 'border border-cocoa-300 bg-cocoa-50'
                              : 'border border-line bg-porcelain',
                        )}
                      >
                        {m.role === 'user' ? (
                          <p className="whitespace-pre-line">
                            {contacts ? m.content : redactCustomerText(m.content, Boolean(meta.sensitive))}
                          </p>
                        ) : (
                          <p className="whitespace-pre-line">
                            {shown
                              .map((p) =>
                                p.type === 'text' || p.type === 'handoff' || p.type === 'staff' || p.type === 'notice'
                                  ? p.text
                                  : p.type === 'slots'
                                    ? `[${p.dateLabel}: ${p.slots.map((x) => x.label).join(', ')}]`
                                    : p.type === 'draft'
                                      ? `[Хураангуй: ${p.summary.dateLabel} ${p.summary.timeRange}, ${p.summary.customerName}]`
                                      : p.type === 'booking'
                                        ? `[Захиалга ${p.reference}: ${p.statusLabel}]`
                                        : p.type === 'appointment'
                                          ? `[${p.summary.reference}: ${p.summary.dateLabel} ${p.summary.timeRange}]`
                                          : p.type === 'change'
                                            ? `[${p.summary.kind === 'cancel' ? 'Цуцлах' : 'Шилжүүлэх'}: ${p.summary.reference}]`
                                            : '',
                              )
                              .filter(Boolean)
                              .join('\n')}
                          </p>
                        )}
                        <p className={cn('mt-1 text-[0.68rem]', m.role === 'user' ? 'text-ivory/70' : 'text-ink-3')}>
                          {m.role === 'staff'
                            ? 'ажилтан · '
                            : m.role === 'assistant'
                              ? `${meta.mode === 'ai' ? 'AI' : 'дүрэм'} · ${meta.intent ?? ''} · `
                              : ''}
                          {formatDateTime(m.createdAt)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
              {detail.events.length ? (
                <div>
                  <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">Туслахын үйлдэл</p>
                  <ul className="mt-2 space-y-1 text-xs text-ink-2">
                    {detail.events.map((e) => (
                      <li key={e.id}>
                        {formatDateTime(e.createdAt)} · {EVENT_LABELS[e.kind] ?? e.kind}
                        {e.level !== 'info' ? <span className="text-rose-700"> ({e.level})</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {!detail.s.isTest ? (
                <ConversationActions sessionId={detail.s.id} status={detail.s.status} canReply={canReply} />
              ) : null}
            </div>
          ) : (
            <EmptyState title="Яриа сонгоно уу" />
          )}
        </Card>
      </div>
      <Pager page={page} pageSize={PAGE_SIZE} total={total} href={(p) => href(filter, p)} unit="яриа" />
    </>
  )
}
