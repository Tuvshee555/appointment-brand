import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { connection } from 'next/server'
import { EmptyState, PageHeader, Pager, TableWrap, td, th } from '@/components/admin/ui'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/datetime'
import { cn } from '@/lib/cn'
import { requireAdminPage } from '@/server/auth/current'
import { db } from '@/server/db'
import * as t from '@/server/db/schema'
import { NOTIFICATION_LABELS, type NotificationKind } from '@/server/notifications'

export const metadata = { title: 'Мэдэгдэл' }

const STATUS = {
  logged: { label: 'Бүртгэлд', tone: 'muted' as const },
  sent: { label: 'Илгээсэн', tone: 'success' as const },
  failed: { label: 'Алдаа', tone: 'danger' as const },
  skipped: { label: 'Суваг алга', tone: 'warning' as const },
}

const CHANNELS = { web: 'Вэбсайт', email: 'И-мэйл', sms: 'SMS', messenger: 'Messenger', telegram: 'Telegram' } as const
const AUDIENCES = { all: 'Бүгд', staff: 'Ажилтанд', customer: 'Үйлчлүүлэгчид' } as const
type AudienceFilter = keyof typeof AUDIENCES
const PAGE_SIZE = 40

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ audience?: string; page?: string }>
}) {
  const session = await requireAdminPage('notifications.view')
  await connection()
  const sp = await searchParams
  const audience: AudienceFilter = sp.audience && sp.audience in AUDIENCES ? (sp.audience as AudienceFilter) : 'all'
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1)
  const where = and(
    eq(t.notifications.salonId, session.salonId),
    audience === 'all' ? undefined : eq(t.notifications.audience, audience),
  )
  const [rows, total] = await Promise.all([
    db
      .select({ n: t.notifications, reference: t.appointments.reference })
      .from(t.notifications)
      .leftJoin(t.appointments, eq(t.appointments.id, t.notifications.appointmentId))
      .where(where)
      .orderBy(desc(t.notifications.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.$count(t.notifications, where),
  ])
  const href = (patch: { audience?: AudienceFilter; page?: number }) => {
    const p = new URLSearchParams()
    const a = patch.audience ?? audience
    if (a !== 'all') p.set('audience', a)
    if (patch.page && patch.page > 1) p.set('page', String(patch.page))
    const qs = p.toString()
    return qs ? `/admin/notifications?${qs}` : '/admin/notifications'
  }
  const telegram = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
  const demo = process.env.DEMO_MODE === 'true'
  return (
    <>
      <PageHeader
        title="Мэдэгдэл"
        description="Захиалга бүрт нэг төрлийн мэдэгдэл нэг л удаа үүснэ (давхардахгүй). Бүх мэдэгдэл энд бүртгэгдэнэ."
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { name: 'Вэбсайт дээрх баталгаа', on: true, note: 'Захиалгын хуудас шууд төлөв харуулна' },
          {
            name: 'Telegram (ажилтан)',
            on: telegram && !demo,
            note: telegram
              ? demo
                ? 'Тохируулсан, демод унтраалттай'
                : 'Идэвхтэй'
              : 'TELEGRAM_BOT_TOKEN тохируулаагүй',
          },
          { name: 'SMS (үйлчлүүлэгч)', on: false, note: 'SMS үйлчилгээ холбогдоогүй' },
          { name: 'Messenger', on: false, note: 'Facebook хуудас холбогдоогүй' },
        ].map((c) => (
          <div key={c.name} className="surface p-4">
            <p className="flex items-center justify-between gap-2 text-sm font-medium">
              {c.name} <Badge tone={c.on ? 'success' : 'muted'}>{c.on ? 'Идэвхтэй' : 'Идэвхгүй'}</Badge>
            </p>
            <p className="mt-1 text-xs text-ink-3">{c.note}</p>
          </div>
        ))}
      </div>
      {demo ? (
        <p className="mb-4 rounded-xs bg-blush-50 px-4 py-3 text-sm text-blush-700">
          Демо горим: ямар ч мессеж гадагш илгээгдэхгүй — зөвхөн энэ бүртгэлд хадгалагдана.
        </p>
      ) : null}
      <div className="mb-3 flex flex-wrap gap-1">
        {(Object.keys(AUDIENCES) as AudienceFilter[]).map((a) => (
          <Link
            key={a}
            href={href({ audience: a })}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-sm',
              audience === a ? 'bg-cocoa-800 text-ivory' : 'text-ink-2 hover:bg-sand',
            )}
          >
            {AUDIENCES[a]}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Мэдэгдэл алга" />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Огноо</th>
              <th className={th}>Төрөл</th>
              <th className={th}>Хүлээн авагч</th>
              <th className={th}>Агуулга</th>
              <th className={th}>Төлөв</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ n, reference }) => (
              <tr key={n.id}>
                <td className={cn(td, 'whitespace-nowrap')}>{formatDateTime(n.createdAt)}</td>
                <td className={td}>
                  {NOTIFICATION_LABELS[n.kind as NotificationKind] ?? n.kind}
                  {reference && n.appointmentId ? (
                    <Link
                      href={`/admin/appointments/${n.appointmentId}`}
                      className="block text-xs text-ink-3 hover:underline"
                    >
                      {reference}
                    </Link>
                  ) : null}
                </td>
                <td className={cn(td, 'text-xs text-ink-2')}>
                  {CHANNELS[n.channel]}
                  {n.recipient ? ` · ${n.recipient}` : ''}
                </td>
                <td className={cn(td, 'max-w-md text-xs text-ink-2')}>{n.body}</td>
                <td className={td}>
                  <Badge tone={STATUS[n.status].tone}>{STATUS[n.status].label}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <Pager page={page} pageSize={PAGE_SIZE} total={total} href={(n) => href({ page: n })} unit="мэдэгдэл" />
    </>
  )
}
