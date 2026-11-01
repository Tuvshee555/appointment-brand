import { Plus, Search } from 'lucide-react'
import Form from 'next/form'
import Link from 'next/link'
import { connection } from 'next/server'
import { EmptyState, PageHeader, TableWrap, td, th } from '@/components/admin/ui'
import { buttonClass } from '@/components/ui/button'
import { DemoTag, StatusBadge } from '@/components/ui/badge'
import { inputClass } from '@/components/ui/field'
import { Money } from '@/components/ui/money'
import { formatDateTime, isDateKey } from '@/lib/datetime'
import { formatPhone } from '@/lib/phone'
import { cn } from '@/lib/cn'
import { requireAdminPage } from '@/server/auth/current'
import { LIST_TABS, listAppointments, staffOptions, type ListTab } from '@/server/queries/admin-appointments'

export const metadata = { title: 'Захиалгууд' }

const SOURCE_LABELS: Record<string, string> = {
  website: 'Вэбсайт',
  admin: 'Самбар',
  assistant: 'AI туслах',
  messenger: 'Messenger',
  phone: 'Утас',
  walk_in: 'Шууд ирсэн',
}

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; staff?: string; q?: string; from?: string; to?: string; page?: string }>
}) {
  const session = await requireAdminPage('appointments.view')
  await connection()
  const sp = await searchParams
  const tab: ListTab = sp.tab && sp.tab in LIST_TABS ? (sp.tab as ListTab) : 'upcoming'
  const page = Math.max(1, Number(sp.page) || 1)
  const staffId = sp.staff && /^[0-9a-f-]{36}$/.test(sp.staff) ? sp.staff : null
  const q = sp.q?.trim().slice(0, 60) || null
  const from = sp.from && isDateKey(sp.from) ? sp.from : null
  const to = sp.to && isDateKey(sp.to) ? sp.to : null
  const [list, staff] = await Promise.all([
    listAppointments(session, { tab, staffId, q, from, to, page, now: new Date() }),
    staffOptions(session.salonId),
  ])
  const link = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams()
    const merged = { tab, staff: staffId, q, from, to, page: null as string | null, ...patch }
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v))
    return `/admin/appointments?${p.toString()}`
  }
  const pages = Math.ceil(list.total / list.pageSize)

  return (
    <>
      <PageHeader
        title="Захиалгууд"
        description="Бүх захиалга, хүсэлт, түүх. Цуцлагдсан захиалга устгагдахгүй — түүхэнд хадгалагдана."
        actions={
          session.role !== 'specialist' ? (
            <Link href="/admin/appointments/new" className={buttonClass('primary', 'md')}>
              <Plus className="size-4" aria-hidden /> Захиалга нэмэх
            </Link>
          ) : null
        }
      />
      <div className="no-scrollbar -mx-4 mb-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Шүүлтүүр">
        {(Object.keys(LIST_TABS) as ListTab[]).map((k) => (
          <Link
            key={k}
            href={link({ tab: k })}
            role="tab"
            aria-selected={tab === k}
            className={cn('shrink-0 rounded-full px-3.5 py-1.5 text-sm', tab === k ? 'bg-cocoa-800 text-ivory' : 'text-ink-2 hover:bg-sand')}
          >
            {LIST_TABS[k]}
          </Link>
        ))}
      </div>
      <Form className="mb-5 flex flex-wrap items-end gap-3" action="/admin/appointments">
        <input type="hidden" name="tab" value={tab} />
        <label className="relative min-w-56 flex-1">
          <span className="sr-only">Хайх</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input name="q" defaultValue={q ?? ''} placeholder="Нэр, утас, захиалгын дугаар" className={cn(inputClass, 'pl-9')} />
        </label>
        {session.role !== 'specialist' ? (
          <label className="w-44">
            <span className="mb-1 block text-xs text-ink-3">Мастер</span>
            <select name="staff" defaultValue={staffId ?? ''} className={inputClass}>
              <option value="">Бүгд</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="w-40">
          <span className="mb-1 block text-xs text-ink-3">Эхлэх өдөр</span>
          <input type="date" name="from" defaultValue={from ?? ''} className={inputClass} />
        </label>
        <label className="w-40">
          <span className="mb-1 block text-xs text-ink-3">Дуусах өдөр</span>
          <input type="date" name="to" defaultValue={to ?? ''} className={inputClass} />
        </label>
        <button type="submit" className={buttonClass('secondary', 'md')}>
          Шүүх
        </button>
      </Form>

      {list.rows.length === 0 ? (
        <EmptyState title="Захиалга олдсонгүй">Шүүлтүүрээ өөрчилж үзнэ үү.</EmptyState>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Цаг</th>
              <th className={th}>Үйлчлүүлэгч</th>
              <th className={th}>Үйлчилгээ</th>
              <th className={th}>Мастер</th>
              <th className={th}>Төлөв</th>
              <th className={cn(th, 'text-right')}>Үнэ / төлсөн</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((r) => (
              <tr key={r.id} className="hover:bg-ivory">
                <td className={td}>
                  <Link href={`/admin/appointments/${r.id}`} className="font-medium text-cocoa-900 hover:underline">
                    {formatDateTime(r.startsAt)}
                  </Link>
                  <div className="text-xs text-ink-3">
                    {r.reference} · {SOURCE_LABELS[r.source]}
                  </div>
                </td>
                <td className={td}>
                  <div className="flex items-center gap-1.5">
                    {r.customerName} {r.isDemo ? <DemoTag /> : null}
                  </div>
                  <div className="text-xs text-ink-3 tabular">{formatPhone(r.customerPhone)}</div>
                  {r.demoVisitorHash && r.demoVisitorHash === session.demoVisitorHash ? (
                    <span className="mt-1 inline-block rounded-xs bg-sage-50 px-1.5 py-0.5 text-[0.68rem] text-sage-700">таны туршилт</span>
                  ) : null}
                </td>
                <td className={cn(td, 'max-w-64 text-ink-2')}>{r.services}</td>
                <td className={td}>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="size-2 rounded-full" style={{ background: r.staffColor }} aria-hidden />
                    {r.staffName}
                  </span>
                </td>
                <td className={td}>
                  <StatusBadge status={r.status} />
                </td>
                <td className={cn(td, 'text-right whitespace-nowrap')}>
                  <Money amount={r.total} from={r.hasFromPrice} />
                  <div className={cn('text-xs', r.paid >= r.total ? 'text-sage-700' : 'text-ink-3')}>
                    <Money amount={r.paid} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      {pages > 1 ? (
        <nav aria-label="Хуудас" className="mt-5 flex items-center justify-between text-sm">
          <span className="text-ink-3">
            Нийт {list.total} · {page}/{pages} хуудас
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={link({ page: String(page - 1) })} className={buttonClass('secondary', 'sm')}>
                Өмнөх
              </Link>
            ) : null}
            {page < pages ? (
              <Link href={link({ page: String(page + 1) })} className={buttonClass('secondary', 'sm')}>
                Дараах
              </Link>
            ) : null}
          </div>
        </nav>
      ) : (
        <p className="mt-4 text-xs text-ink-3">Нийт {list.total} захиалга</p>
      )}
    </>
  )
}
