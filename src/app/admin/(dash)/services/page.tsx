import { Pencil, Plus } from 'lucide-react'
import Link from 'next/link'
import { connection } from 'next/server'
import { ActionButton } from '@/components/admin/action-button'
import { AddonRow, CategoryRow } from '@/components/admin/catalog-forms'
import { Card, PageHeader, TableWrap, td, th } from '@/components/admin/ui'
import { buttonClass } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Money } from '@/components/ui/money'
import { Photo } from '@/components/ui/photo'
import { formatDuration } from '@/lib/datetime'
import { cn } from '@/lib/cn'
import { toggleServiceAction } from '@/server/actions/admin-catalog'
import { requireAdminPage } from '@/server/auth/current'
import { loadCatalogAdmin } from '@/server/queries/admin-catalog'

export const metadata = { title: 'Үйлчилгээ, үнэ' }

export default async function ServicesAdminPage() {
  const session = await requireAdminPage('services.view')
  await connection()
  const catalog = await loadCatalogAdmin(session.salonId)
  const canEdit = session.permissions.includes('services.manage') || session.isDemo
  const staffName = new Map(catalog.staff.map((s) => [s.id, s.name]))
  return (
    <>
      <PageHeader
        title="Үйлчилгээ, үнэ"
        description="Үнэ, хугацаа, нэмэлт, мастерын хуваарилалтыг эндээс өөрчилнө. Вэбсайт, захиалгын хуанли, AI туслах бүгд энэ мэдээллийг ашиглана."
        actions={
          canEdit ? (
            <Link href="/admin/services/new" className={buttonClass('primary', 'md')}>
              <Plus className="size-4" aria-hidden /> Үйлчилгээ нэмэх
            </Link>
          ) : null
        }
      />
      <div className="space-y-8">
        {catalog.categories.map((c) => {
          const rows = catalog.services.filter((s) => s.categoryId === c.id)
          return (
            <section key={c.id} aria-labelledby={`cat-${c.id}`}>
              <h2 id={`cat-${c.id}`} className="mb-3 flex items-center gap-2 font-display text-2xl text-cocoa-900">
                {c.name} {!c.isActive ? <Badge tone="muted">идэвхгүй</Badge> : null}
              </h2>
              <ul className="surface divide-y divide-line sm:hidden">
                {rows.map((s) => {
                  const body = (
                    <>
                      <span className="relative size-12 shrink-0 overflow-hidden rounded-xs bg-sand">
                        {s.imageUrl ? (
                          <Photo src={s.imageUrl} alt="" fill sizes="48px" className="object-cover" />
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className="font-medium text-ink">{s.name}</span>
                          <span className="shrink-0 text-sm">
                            <Money amount={s.price} from={s.priceType === 'from'} />
                          </span>
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-3">
                          {formatDuration(s.durationMinutes)} ·{' '}
                          {s.staffIds.map((id) => staffName.get(id)).join(', ') || 'мастер оноогоогүй'}
                        </span>
                        <span className="mt-1.5 flex flex-wrap gap-1.5">
                          {s.isActive ? <Badge tone="success">Идэвхтэй</Badge> : <Badge tone="muted">Идэвхгүй</Badge>}
                          {s.isFeatured ? <Badge tone="info">Онцлох</Badge> : null}
                        </span>
                      </span>
                    </>
                  )
                  return (
                    <li key={s.id} className={cn(!s.isActive && 'opacity-60')}>
                      {canEdit ? (
                        <Link href={`/admin/services/${s.id}`} className="flex gap-3 px-4 py-3.5 hover:bg-ivory">
                          {body}
                        </Link>
                      ) : (
                        <div className="flex gap-3 px-4 py-3.5">{body}</div>
                      )}
                    </li>
                  )
                })}
              </ul>
              <div className="max-sm:hidden">
                <TableWrap>
                  <thead>
                    <tr>
                      <th className={th}>Үйлчилгээ</th>
                      <th className={th}>Хугацаа</th>
                      <th className={cn(th, 'text-right')}>Үнэ</th>
                      <th className={th}>Мастер</th>
                      <th className={th}>Төлөв</th>
                      <th className={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.id} className={cn('hover:bg-ivory', !s.isActive && 'opacity-60')}>
                        <td className={td}>
                          <div className="flex items-center gap-3">
                            <span className="relative size-11 shrink-0 overflow-hidden rounded-xs bg-sand">
                              {s.imageUrl ? (
                                <Photo src={s.imageUrl} alt="" fill sizes="44px" className="object-cover" />
                              ) : null}
                            </span>
                            <span>
                              <span className="block font-medium text-ink">{s.name}</span>
                              <span className="block text-xs text-ink-3">
                                {s.addonIds.length} нэмэлт · {s.onlineBookable ? 'онлайнаар захиална' : 'зөвхөн утсаар'}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td className={cn(td, 'whitespace-nowrap')}>
                          {formatDuration(s.durationMinutes)}
                          {s.bufferMinutes !== null ? (
                            <span className="block text-xs text-ink-3">+{s.bufferMinutes} мин бэлтгэл</span>
                          ) : null}
                        </td>
                        <td className={cn(td, 'text-right')}>
                          <Money amount={s.price} from={s.priceType === 'from'} />
                        </td>
                        <td className={cn(td, 'max-w-52 text-xs text-ink-2')}>
                          {s.staffIds.map((id) => staffName.get(id)).join(', ') || (
                            <span className="text-rose-700">Мастер оноогоогүй</span>
                          )}
                        </td>
                        <td className={td}>
                          <div className="flex flex-col gap-1.5">
                            {s.isActive ? <Badge tone="success">Идэвхтэй</Badge> : <Badge tone="muted">Идэвхгүй</Badge>}
                            {s.isFeatured ? <Badge tone="info">Онцлох</Badge> : null}
                          </div>
                        </td>
                        <td className={cn(td, 'text-right whitespace-nowrap')}>
                          {canEdit ? (
                            <div className="flex items-start justify-end gap-1">
                              <ActionButton
                                action={toggleServiceAction.bind(null, {
                                  id: s.id,
                                  field: 'isActive',
                                  value: !s.isActive,
                                })}
                                variant="ghost"
                              >
                                {s.isActive ? 'Идэвхгүй болгох' : 'Идэвхжүүлэх'}
                              </ActionButton>
                              <Link href={`/admin/services/${s.id}`} className={buttonClass('secondary', 'sm')}>
                                <Pencil className="size-3.5" aria-hidden /> Засах
                              </Link>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              </div>
            </section>
          )
        })}
      </div>

      <div className="mt-10 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card title="Нэмэлт сонголтууд (add-on)">
          {canEdit ? (
            <>
              {catalog.addons.map((a) => (
                <AddonRow key={a.id} addon={a} />
              ))}
              <AddonRow addon={null} />
            </>
          ) : (
            <ul className="space-y-1 text-sm">
              {catalog.addons.map((a) => (
                <li key={a.id}>
                  {a.name} · <Money amount={a.price} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Ангилал">
          {canEdit ? (
            <>
              {catalog.categories.map((c) => (
                <CategoryRow key={c.id} category={c} />
              ))}
              <CategoryRow category={null} />
            </>
          ) : (
            <ul className="text-sm">
              {catalog.categories.map((c) => (
                <li key={c.id}>{c.name}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
