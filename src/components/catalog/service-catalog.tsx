'use client'

import { Clock, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { StaffAvatar } from '@/components/catalog/staff-card'
import { buttonClass } from '@/components/ui/button'
import { Money } from '@/components/ui/money'
import { Photo } from '@/components/ui/photo'
import { formatDuration } from '@/lib/datetime'
import { cn } from '@/lib/cn'
import type { PublicCatalog } from '@/server/queries/public'

export function ServiceCatalog({ catalog }: { catalog: PublicCatalog }) {
  const params = useSearchParams()
  const router = useRouter()
  const requested = params.get('category')
  const active = catalog.categories.some((c) => c.slug === requested) ? requested : null
  const addonById = new Map(catalog.addons.map((a) => [a.id, a]))
  const staffById = new Map(catalog.staff.map((s) => [s.id, s]))
  const visible = catalog.categories.filter((c) => !active || c.slug === active)

  const select = (slug: string | null) => router.replace(slug ? `/services?category=${slug}` : '/services', { scroll: false })

  return (
    <div>
      <div className="sticky top-[4.5rem] z-20 -mx-4 border-b border-line bg-ivory/95 px-4 py-3 backdrop-blur sm:mx-0 sm:px-0">
        <div role="tablist" aria-label="Үйлчилгээний ангилал" className="no-scrollbar flex gap-2 overflow-x-auto">
          {[{ slug: null, name: 'Бүгд' }, ...catalog.categories].map((c) => (
            <button
              key={c.slug ?? 'all'}
              type="button"
              role="tab"
              aria-selected={active === c.slug}
              onClick={() => select(c.slug)}
              className={cn(
                'shrink-0 rounded-full border px-4 py-2 text-sm transition-colors',
                active === c.slug ? 'border-cocoa-800 bg-cocoa-800 text-ivory' : 'border-line-strong text-ink-2 hover:border-cocoa-600',
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {visible.map((category) => (
        <section key={category.id} aria-labelledby={`cat-${category.slug}`} className="py-12 first:pt-10">
          <div className="max-w-2xl">
            <h2 id={`cat-${category.slug}`} className="display text-4xl text-cocoa-900">
              {category.name}
            </h2>
            <p className="mt-2 text-ink-3">{category.description}</p>
          </div>
          <ul className="mt-8 grid gap-6 lg:grid-cols-2">
            {catalog.services
              .filter((s) => s.categoryId === category.id)
              .map((s) => (
                <li key={s.id} className="surface flex flex-col overflow-hidden sm:flex-row">
                  <div className="relative aspect-[16/10] w-full shrink-0 bg-sand sm:aspect-auto sm:w-44">
                    {s.imageUrl ? (
                      <Photo src={s.imageUrl} alt={s.imageAlt ?? s.name} fill loading="lazy" sizes="(min-width: 640px) 176px, 100vw" className="object-cover" />
                    ) : null}
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="font-display text-[1.55rem] leading-tight text-cocoa-900">{s.name}</h3>
                      <Money amount={s.price} from={s.priceType === 'from'} className="pt-1 text-[1.05rem] font-medium text-cocoa-900" />
                    </div>
                    <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-ink-3">
                      <Clock className="size-4" aria-hidden /> {formatDuration(s.durationMinutes)}
                    </p>
                    <p className="mt-3 text-[0.93rem] leading-relaxed text-ink-2">{s.description}</p>
                    {s.addonIds.length ? (
                      <div className="mt-4">
                        <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">Нэмэлт сонголт</p>
                        <ul className="mt-2 space-y-1 text-sm">
                          {s.addonIds.map((id) => {
                            const a = addonById.get(id)!
                            return (
                              <li key={id} className="flex items-baseline gap-2 text-ink-2">
                                <Plus className="size-3 shrink-0 text-blush-500" aria-hidden />
                                <span>{a.name}</span>
                                <span className="leader" aria-hidden />
                                <span className="shrink-0 text-xs text-ink-3">+{formatDuration(a.durationMinutes)}</span>
                                <span className="shrink-0 tabular">
                                  +<Money amount={a.price} from={a.priceType === 'from'} />
                                </span>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    ) : null}
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                      <div className="flex items-center gap-2">
                        <div className="flex -space-x-2">
                          {s.staffIds.slice(0, 4).map((id) => {
                            const st = staffById.get(id)
                            return st ? <StaffAvatar key={id} staff={st} size={30} /> : null
                          })}
                        </div>
                        <span className="text-xs text-ink-3">
                          {s.staffIds
                            .map((id) => staffById.get(id)?.displayName)
                            .filter(Boolean)
                            .join(', ')}
                        </span>
                      </div>
                      {s.onlineBookable ? (
                        <Link href={`/book?service=${s.slug}`} className={buttonClass('primary', 'sm')}>
                          Захиалах
                        </Link>
                      ) : (
                        <span className="text-xs text-ink-3">Утсаар захиална</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
