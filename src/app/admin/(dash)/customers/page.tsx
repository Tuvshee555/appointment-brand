import { Search } from 'lucide-react'
import Form from 'next/form'
import Link from 'next/link'
import { connection } from 'next/server'
import { EmptyState, PageHeader, Pager, TableWrap, td, th } from '@/components/admin/ui'
import { buttonClass } from '@/components/ui/button'
import { DemoTag } from '@/components/ui/badge'
import { inputClass } from '@/components/ui/field'
import { Money } from '@/components/ui/money'
import { formatDateNumeric, formatDateTime } from '@/lib/datetime'
import { formatPhone } from '@/lib/phone'
import { cn } from '@/lib/cn'
import { requireAdminPage } from '@/server/auth/current'
import { listCustomers, type CustomerFilter } from '@/server/queries/admin-customers'

export const metadata = { title: 'Харилцагч' }

const FILTERS: Record<CustomerFilter, string> = {
  all: 'Бүгд',
  upcoming: 'Ирэх захиалгатай',
  regular: 'Байнгын (3+)',
  new: 'Шинэ',
  no_show: 'Ирээгүй түүхтэй',
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string; page?: string }>
}) {
  const session = await requireAdminPage('customers.view')
  await connection()
  const sp = await searchParams
  const filter: CustomerFilter = sp.filter && sp.filter in FILTERS ? (sp.filter as CustomerFilter) : 'all'
  const q = sp.q?.trim().slice(0, 60) || null
  const page = Math.max(1, Number(sp.page) || 1)
  const list = await listCustomers(session, { q, filter, page })
  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ q, filter, page: null as string | null, ...patch }))
      if (v && v !== 'all') p.set(k, v)
    return `/admin/customers?${p.toString()}`
  }
  return (
    <>
      <PageHeader
        title="Харилцагч"
        description={
          session.isDemo || !session.permissions.includes('customers.contact')
            ? 'Хувийн мэдээллийг хамгаалах үүднээс утасны дугаар нууцлагдсан. Бүх харилцагч зохиомол.'
            : 'Харилцагчийн түүх, тэмдэглэл, ирц.'
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-1">
        {(Object.keys(FILTERS) as CustomerFilter[]).map((f) => (
          <Link
            key={f}
            href={href({ filter: f })}
            className={cn(
              'rounded-full px-3.5 py-1.5 text-sm',
              filter === f ? 'bg-cocoa-800 text-ivory' : 'text-ink-2 hover:bg-sand',
            )}
          >
            {FILTERS[f]}
          </Link>
        ))}
      </div>
      <Form action="/admin/customers" className="mb-5 flex gap-2">
        <input type="hidden" name="filter" value={filter} />
        <label className="relative max-w-md flex-1">
          <span className="sr-only">Хайх</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
            aria-hidden
          />
          <input name="q" defaultValue={q ?? ''} placeholder="Нэр эсвэл утас" className={cn(inputClass, 'pl-9')} />
        </label>
        <button type="submit" className={buttonClass('secondary', 'md')}>
          Хайх
        </button>
      </Form>
      {list.rows.length === 0 ? (
        <EmptyState title="Харилцагч олдсонгүй" />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Нэр</th>
              <th className={th}>Утас</th>
              <th className={cn(th, 'text-right')}>Үйлчлүүлсэн</th>
              <th className={th}>Сүүлд</th>
              <th className={th}>Дараагийн</th>
              <th className={cn(th, 'text-right')}>Цуцалсан / ирээгүй</th>
              <th className={cn(th, 'text-right')}>Төлсөн</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((c) => (
              <tr key={c.id} className="hover:bg-ivory">
                <td className={td}>
                  <Link href={`/admin/customers/${c.id}`} className="font-medium text-cocoa-900 hover:underline">
                    {c.name}
                  </Link>{' '}
                  {c.isDemo ? <DemoTag /> : null}
                </td>
                <td className={cn(td, 'tabular')}>{formatPhone(c.phone)}</td>
                <td className={cn(td, 'tabular text-right')}>{c.stats.visits}</td>
                <td className={cn(td, 'text-ink-2')}>
                  {c.stats.last_visit ? formatDateNumeric(c.stats.last_visit) : '—'}
                </td>
                <td className={cn(td, 'text-ink-2')}>
                  {c.stats.next_visit ? formatDateTime(c.stats.next_visit) : '—'}
                </td>
                <td className={cn(td, 'tabular text-right')}>
                  {c.stats.cancellations} /{' '}
                  <span className={c.stats.no_shows ? 'text-rose-700' : ''}>{c.stats.no_shows}</span>
                </td>
                <td className={cn(td, 'text-right')}>
                  <Money amount={c.stats.spent} />
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <Pager
        page={page}
        pageSize={list.pageSize}
        total={list.total}
        href={(n) => href({ page: n > 1 ? String(n) : null })}
      />
    </>
  )
}
