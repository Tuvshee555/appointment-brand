import type { Metadata } from 'next'
import Link from 'next/link'
import { StaffAvatar } from '@/components/catalog/staff-card'
import { buttonClass } from '@/components/ui/button'
import { Money } from '@/components/ui/money'
import { Photo } from '@/components/ui/photo'
import { minutesToTime, WEEKDAYS_SHORT_MN } from '@/lib/datetime'
import { getPublicCatalog } from '@/server/queries/public'

export const metadata: Metadata = {
  title: 'Мастерууд',
  description:
    'Сувдын мастерууд: мэргэшил, туршлага, хийдэг үйлчилгээ, ажлын өдрүүд. Хүссэн мастертаа шууд цаг захиална.',
}

export default async function StaffPage() {
  const catalog = await getPublicCatalog()
  const serviceById = new Map(catalog.services.map((s) => [s.id, s]))
  return (
    <div className="container-page pb-24">
      <header className="pt-12 pb-6 lg:pt-16">
        <p className="eyebrow">Мастерууд</p>
        <h1 className="display mt-3 text-5xl text-cocoa-900 sm:text-6xl">Танилцаарай</h1>
        <p className="mt-4 max-w-2xl text-[1.04rem] leading-relaxed text-ink-3">
          Мастер бүр зөвхөн өөрийн мэргэшсэн үйлчилгээг хийдэг — захиалгын үед зөвхөн тухайн үйлчилгээг хийдэг мастерууд
          харагдана. Хөрөг зургууд нь зохиомол хүмүүсийн AI-аар бүтээсэн зураг, нэрс зохиомол.
        </p>
      </header>
      <div className="divide-y divide-line">
        {catalog.staff.map((s, i) => (
          <article
            key={s.id}
            id={s.slug}
            aria-labelledby={`staff-${s.slug}`}
            className="grid scroll-mt-28 gap-8 py-12 lg:grid-cols-[22rem_1fr] lg:gap-14"
          >
            <div className="relative aspect-[4/5] overflow-hidden rounded-xs bg-sand lg:aspect-[4/5]">
              {s.coverUrl ? (
                <Photo
                  src={s.coverUrl}
                  alt={`${s.displayName} мастерын ажлын жишээ`}
                  fill
                  priority={i === 0}
                  sizes="(min-width: 1024px) 22rem, 100vw"
                  className="object-cover"
                />
              ) : null}
            </div>
            <div>
              <div className="flex items-center gap-4">
                <StaffAvatar staff={s} size={72} />
                <div>
                  <h2 id={`staff-${s.slug}`} className="display text-4xl text-cocoa-900">
                    {s.name}
                  </h2>
                  <p className="text-ink-3">{s.title}</p>
                </div>
              </div>
              <p className="mt-6 max-w-2xl text-[1.02rem] leading-relaxed text-ink-2">{s.bio}</p>
              <p className="mt-3 text-sm text-ink-3">{s.experienceText}</p>
              <dl className="mt-8 grid gap-8 sm:grid-cols-2">
                <div>
                  <dt className="eyebrow">Мэргэшил</dt>
                  <dd className="mt-3 flex flex-wrap gap-1.5">
                    {s.specialties.map((sp) => (
                      <span key={sp} className="rounded-xs border border-line px-2.5 py-1 text-sm text-ink-2">
                        {sp}
                      </span>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">Ажлын өдөр</dt>
                  <dd className="mt-3 flex flex-wrap gap-1.5">
                    {[1, 2, 3, 4, 5, 6, 7].map((wd) => {
                      const day = s.workDays.find((d) => d.weekday === wd)
                      return (
                        <span
                          key={wd}
                          title={day ? `${minutesToTime(day.startsAt)}–${minutesToTime(day.endsAt)}` : 'Амарна'}
                          className={`inline-flex w-10 flex-col items-center rounded-xs border py-1 text-xs ${day ? 'border-cocoa-300 text-cocoa-900' : 'border-line text-ink-3/60 line-through'}`}
                        >
                          {WEEKDAYS_SHORT_MN[wd - 1]}
                        </span>
                      )
                    })}
                  </dd>
                </div>
              </dl>
              <div className="mt-8">
                <p className="eyebrow">Хийдэг үйлчилгээ ({s.serviceIds.length})</p>
                <ul className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                  {s.serviceIds.map((id) => {
                    const svc = serviceById.get(id)
                    if (!svc) return null
                    return (
                      <li key={id} className="flex items-baseline gap-2">
                        <Link
                          href={`/book?service=${svc.slug}&staff=${s.slug}`}
                          className="text-ink-2 hover:text-cocoa-900"
                        >
                          {svc.name}
                        </Link>
                        <span className="leader" aria-hidden />
                        <Money amount={svc.price} from={svc.priceType === 'from'} className="text-ink-3" />
                      </li>
                    )
                  })}
                </ul>
              </div>
              <Link href={`/book?staff=${s.slug}`} className={`${buttonClass('primary', 'md')} mt-8`}>
                {s.displayName}-д цаг захиалах
              </Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
