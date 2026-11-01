import Link from 'next/link'
import { connection } from 'next/server'
import { EmptyState, PageHeader, Pager, StatCard, TableWrap, td, th } from '@/components/admin/ui'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/cn'
import { requireAdminPage } from '@/server/auth/current'
import { paymentMode } from '@/server/payments'
import { loadPayments, PAYMENTS_PAGE_SIZE, type PaymentFilter } from '@/server/queries/admin-reports'

export const metadata = { title: 'Төлбөр, орлого' }

const FILTERS: Record<PaymentFilter, string> = {
  all: 'Бүгд',
  paid: 'Төлөгдсөн',
  pending: 'Хүлээгдэж буй',
  refunded: 'Буцаасан',
  outstanding: 'Үлдэгдэлтэй',
}
const METHOD: Record<string, string> = { qpay: 'QPay', cash: 'Бэлэн', card: 'Карт', bank_transfer: 'Дансаар' }
const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'muted' | 'danger' | 'info' }> = {
  paid: { label: 'Төлөгдсөн', tone: 'success' },
  pending: { label: 'Хүлээгдэж буй', tone: 'warning' },
  refunded: { label: 'Буцаасан', tone: 'info' },
  expired: { label: 'Хугацаа дууссан', tone: 'muted' },
  cancelled: { label: 'Цуцлагдсан', tone: 'muted' },
  failed: { label: 'Амжилтгүй', tone: 'danger' },
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>
}) {
  const session = await requireAdminPage('payments.view')
  await connection()
  const sp = await searchParams
  const filter: PaymentFilter = sp.filter && sp.filter in FILTERS ? (sp.filter as PaymentFilter) : 'all'
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1)
  const data = await loadPayments(session.salonId, filter, new Date(), page)
  const mode = paymentMode()
  const href = (f: PaymentFilter, n = 1) => {
    const p = new URLSearchParams()
    if (f !== 'all') p.set('filter', f)
    if (n > 1) p.set('page', String(n))
    const qs = p.toString()
    return qs ? `/admin/payments?${qs}` : '/admin/payments'
  }
  return (
    <>
      <PageHeader
        title="Төлбөр, орлого"
        description="Төлбөр «төлөгдсөн» болохын тулд төлбөрийн системийн шалгалт (QPay) эсвэл ажилтны хүлээн авсан бүртгэл шаардлагатай — хөтчөөс ирсэн мэдэгдлээр төлөв өөрчлөгдөхгүй."
      />
      <div className="mb-6 rounded-xs border border-line bg-porcelain px-4 py-3 text-sm text-ink-2">
        QPay горим:{' '}
        <strong>
          {mode === 'mock'
            ? 'симуляц (демо — мөнгө шилжихгүй)'
            : mode === 'sandbox'
              ? 'sandbox (туршилт)'
              : 'production'}
        </strong>
        . QPay-ийн гүйлгээний шимтгэлийг QPay тооцдог бөгөөд Ursgal Digital-ын холболтын үйлчилгээний төлбөрөөс тусдаа.
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Энэ сарын орлого"
          value={formatMoney(data.summary.paidMonth)}
          hint={
            data.methods.length
              ? data.methods.map((m) => `${METHOD[m.method]} ${formatMoney(m.total)}`).join(' · ')
              : 'энэ сард төлбөр алга'
          }
        />
        <StatCard
          label="Хүлээгдэж буй урьдчилгаа"
          value={formatMoney(data.summary.pendingDeposits)}
          hint={`${data.summary.pendingCount} нэхэмжлэх`}
          tone={data.summary.pendingCount ? 'warning' : 'default'}
        />
        <StatCard label="Буцаасан (энэ сар)" value={formatMoney(data.summary.refundedMonth)} />
        <StatCard label="Нийт хүлээн авсан урьдчилгаа" value={formatMoney(data.summary.depositsHeld)} />
      </div>
      <div className="mt-6">
        <div className="mb-3 flex flex-wrap gap-1">
          {(Object.keys(FILTERS) as PaymentFilter[]).map((f) => (
            <Link
              key={f}
              href={href(f)}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-sm',
                filter === f ? 'bg-cocoa-800 text-ivory' : 'text-ink-2 hover:bg-sand',
              )}
            >
              {FILTERS[f]}
            </Link>
          ))}
        </div>
        {filter === 'outstanding' ? (
          data.outstanding.length ? (
            <TableWrap>
              <thead>
                <tr>
                  <th className={th}>Захиалга</th>
                  <th className={th}>Огноо</th>
                  <th className={cn(th, 'text-right')}>Үнэ</th>
                  <th className={cn(th, 'text-right')}>Төлсөн</th>
                  <th className={cn(th, 'text-right')}>Үлдэгдэл</th>
                </tr>
              </thead>
              <tbody>
                {data.outstanding.map((o) => (
                  <tr key={o.id}>
                    <td className={td}>
                      <Link href={`/admin/appointments/${o.id}`} className="font-medium hover:underline">
                        {o.reference}
                      </Link>
                      <div className="text-xs text-ink-3">{o.customer_name}</div>
                    </td>
                    <td className={td}>{formatDateTime(o.starts_at)}</td>
                    <td className={cn(td, 'tabular text-right')}>{formatMoney(Number(o.total))}</td>
                    <td className={cn(td, 'tabular text-right')}>{formatMoney(Number(o.paid))}</td>
                    <td className={cn(td, 'tabular text-right font-medium text-amber-700')}>
                      {formatMoney(Number(o.total) - Number(o.paid))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : (
            <EmptyState title="Үлдэгдэлтэй захиалга алга" />
          )
        ) : data.rows.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Огноо</th>
                <th className={th}>Захиалга</th>
                <th className={th}>Төрөл</th>
                <th className={th}>Төлөв</th>
                <th className={th}>Баталгаажуулалт</th>
                <th className={cn(th, 'text-right')}>Дүн</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((p) => (
                <tr key={p.id}>
                  <td className={cn(td, 'whitespace-nowrap')}>{formatDateTime(p.paidAt ?? p.createdAt)}</td>
                  <td className={td}>
                    <Link href={`/admin/appointments/${p.appointmentId}`} className="font-medium hover:underline">
                      {p.reference}
                    </Link>
                    <div className="text-xs text-ink-3">{p.customerName}</div>
                  </td>
                  <td className={td}>
                    {p.kind === 'deposit'
                      ? 'Урьдчилгаа'
                      : p.kind === 'balance'
                        ? 'Үлдэгдэл'
                        : p.kind === 'refund'
                          ? 'Буцаалт'
                          : 'Бүтэн'}{' '}
                    · {METHOD[p.method]}
                    {p.provider === 'simulated' ? (
                      <span className="block text-xs text-blush-700">туршилтын</span>
                    ) : null}
                  </td>
                  <td className={td}>
                    <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                  </td>
                  <td className={cn(td, 'text-xs text-ink-3')}>
                    {p.verifiedBy === 'provider_check'
                      ? 'Төлбөрийн систем'
                      : p.verifiedBy === 'staff_record'
                        ? 'Ажилтан хүлээн авсан'
                        : '—'}
                  </td>
                  <td className={cn(td, 'tabular text-right')}>{formatMoney(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyState title="Төлбөр алга" />
        )}
        {filter !== 'outstanding' ? (
          <Pager
            page={page}
            pageSize={PAYMENTS_PAGE_SIZE}
            total={data.rowCount}
            href={(n) => href(filter, n)}
            unit="гүйлгээ"
          />
        ) : null}
      </div>
    </>
  )
}
