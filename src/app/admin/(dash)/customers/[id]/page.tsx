import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { CustomerNotesForm } from '@/components/admin/customer-form'
import { Card, PageHeader, StatCard } from '@/components/admin/ui'
import { DemoTag, StatusBadge } from '@/components/ui/badge'
import { Money } from '@/components/ui/money'
import { formatDateNumeric, formatDateTime } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { formatPhone } from '@/lib/phone'
import { requireAdminPage } from '@/server/auth/current'
import { loadCustomer } from '@/server/queries/admin-customers'

export const metadata = { title: 'Харилцагч' }

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminPage('customers.view')
  await connection()
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const data = await loadCustomer(session, id)
  if (!data) notFound()
  const { customer } = data
  return (
    <>
      <Link
        href="/admin/customers"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-cocoa-900"
      >
        <ArrowLeft className="size-4" aria-hidden /> Харилцагч
      </Link>
      <PageHeader
        title={customer.name}
        description={
          <>
            <span className="tabular">{formatPhone(customer.phone)}</span>
            {customer.email ? ` · ${customer.email}` : ''} · бүртгэгдсэн {formatDateNumeric(customer.createdAt)}{' '}
            {customer.isDemo ? <DemoTag className="ml-1" /> : null}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Үйлчлүүлсэн" value={data.visits} hint="дууссан захиалга" />
        <StatCard label="Нийт төлсөн" value={formatMoney(data.spent)} />
        <StatCard label="Цуцалсан" value={data.cancellations.length} />
        <StatCard label="Ирээгүй" value={data.noShows} tone={data.noShows ? 'danger' : 'default'} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card title="Захиалгын түүх" bodyClassName="p-0">
          <ul className="divide-y divide-line">
            {data.appointments.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/admin/appointments/${a.id}`}
                  className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-ivory"
                >
                  <span className="tabular w-40 shrink-0">{formatDateTime(a.startsAt)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {a.services} <span className="text-ink-3">· {a.staffName}</span>
                  </span>
                  <Money amount={a.total} from={a.hasFromPrice} className="hidden text-ink-2 sm:inline" />
                  <StatusBadge status={a.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <div className="space-y-6">
          <Card title="Тэмдэглэл, сонголт">
            {session.permissions.includes('customers.manage') || session.isDemo ? (
              <CustomerNotesForm
                id={customer.id}
                notes={customer.notes}
                preferences={customer.preferences}
                marketingOptIn={customer.marketingOptIn}
              />
            ) : (
              <p className="text-sm text-ink-2">{customer.preferences ?? '—'}</p>
            )}
          </Card>
          <Card title="Цуцлалтын түүх">
            {data.cancellations.length ? (
              <ul className="space-y-2 text-sm">
                {data.cancellations.map((c, i) => (
                  <li key={i}>
                    {c.reference} · {formatDateTime(c.createdAt)} · {c.noticeHours} цагийн өмнө ·{' '}
                    {c.withinPolicy ? 'бодлогын дагуу' : 'хоцорсон'}
                    {c.reasonText ? <span className="block text-xs text-ink-3">«{c.reasonText}»</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-3">Цуцлалт алга.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  )
}
