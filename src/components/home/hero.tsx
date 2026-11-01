import { ArrowRight, CalendarCheck2, Clock3, MapPin } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'
import { ButtonLink } from '@/components/ui/button'
import { Photo } from '@/components/ui/photo'
import { dateKeyOf, minutesToTime, relativeDayLabel } from '@/lib/datetime'
import { PHOTOS } from '@/lib/photo-manifest'
import type { PublicSalon } from '@/server/queries/public'
import { getNextOpenings } from '@/server/queries/live'

function openingSummary(hours: PublicSalon['hours']) {
  const open = hours.filter((h) => !h.isClosed)
  const earliest = Math.min(...open.map((h) => h.opensAt))
  const closed = hours.filter((h) => h.isClosed).length
  return `${minutesToTime(earliest)}-аас нээнэ${closed ? ' · Даваа амарна' : ''}`
}

async function NextOpening() {
  const result = await getNextOpenings('gel-polish', 3)
  if (!result) return null
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium tracking-[0.14em] text-cocoa-500 uppercase">
        Хамгийн ойрын сул цаг · {result.serviceName}
      </p>
      {result.slots.length === 0 ? (
        <p className="text-sm text-ink-3">Ойрын 10 хоногт сул цаг алга. Өөр үйлчилгээ сонгоод шалгана уу.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {result.slots.map((s) => (
            <li key={s.startsAt}>
              <Link
                href={`/book?service=${result.serviceSlug}&date=${s.date}&time=${minutesToTime(s.start)}`}
                className="inline-flex flex-col rounded-xs border border-line bg-porcelain px-3 py-2 text-left transition-colors hover:border-cocoa-600"
              >
                <span className="text-[0.7rem] text-ink-3">
                  {relativeDayLabel(s.date, dateKeyOf(new Date(result.checkedAt)))}
                </span>
                <span className="tabular font-display text-xl text-cocoa-900">{minutesToTime(s.start)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[0.7rem] text-ink-3">Мастеруудын хуваарь, захиалгаас шууд тооцоолсон.</p>
    </div>
  )
}

function NextOpeningFallback() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="h-3 w-48 animate-pulse rounded-xs bg-sand" />
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 w-20 animate-pulse rounded-xs bg-sand" />
        ))}
      </div>
    </div>
  )
}

export function Hero({
  salon,
  serviceCount,
  staffCount,
}: {
  salon: PublicSalon
  serviceCount: number
  staffCount: number
}) {
  const photo = PHOTOS['pearl-art']
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden">
      <div className="container-page grid items-center gap-10 pt-10 pb-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pt-16 lg:pb-24">
        <div className="animate-fade-in">
          <p className="eyebrow">Улаанбаатар · Хумс, гоо сайхны ателье</p>
          <h1 id="hero-title" className="display mt-5 text-[3.1rem] text-cocoa-900 sm:text-[4.2rem] xl:text-[5.1rem]">
            Хумсны нарийн урлал,
            <span className="block text-cocoa-600 italic"> тайван орчинд</span>
          </h1>
          <p className="mt-6 max-w-xl text-[1.06rem] leading-relaxed text-ink-2">
            Маникюр, педикюр, хумс сунгалт, гар зургийн дизайныг ариутгасан багаж, баталгаат материалаар хийнэ. Мастер,
            бодит сул цагаа өөрөө сонгоод хэдхэн алхмаар захиална.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/book" size="lg">
              Цаг захиалах
            </ButtonLink>
            <ButtonLink href="/services" size="lg" variant="secondary">
              Үйлчилгээ харах
            </ButtonLink>
          </div>
          <dl className="mt-10 grid gap-4 border-t border-line pt-6 text-sm sm:grid-cols-3">
            <div className="flex gap-2.5">
              <MapPin className="mt-0.5 size-4 shrink-0 text-blush-500" aria-hidden />
              <div>
                <dt className="font-medium text-ink">Сүхбаатар дүүрэг</dt>
                <dd className="text-ink-3">{salon.addressNote ?? salon.addressLine}</dd>
              </div>
            </div>
            <div className="flex gap-2.5">
              <Clock3 className="mt-0.5 size-4 shrink-0 text-blush-500" aria-hidden />
              <div>
                <dt className="font-medium text-ink">{openingSummary(salon.hours)}</dt>
                <dd className="text-ink-3">Онлайн захиалга 24/7</dd>
              </div>
            </div>
            <div className="flex gap-2.5">
              <CalendarCheck2 className="mt-0.5 size-4 shrink-0 text-blush-500" aria-hidden />
              <div>
                <dt className="font-medium text-ink">
                  {serviceCount} үйлчилгээ · {staffCount} мастер
                </dt>
                <dd className="text-ink-3">Давхар захиалга гарахгүй</dd>
              </div>
            </div>
          </dl>
        </div>

        <div className="relative">
          <div className="relative aspect-[4/5] overflow-hidden rounded-xs bg-sand lg:aspect-[5/6]">
            <Photo
              src={photo.src}
              alt={photo.alt}
              fill
              priority
              sizes="(min-width: 1024px) 46vw, 100vw"
              className="object-cover"
            />
          </div>
          <div className="surface relative z-10 mx-4 -mt-16 p-5 shadow-lift sm:mx-8 lg:absolute lg:bottom-8 lg:-left-12 lg:mx-0 lg:mt-0 lg:w-[22rem]">
            <Suspense fallback={<NextOpeningFallback />}>
              <NextOpening />
            </Suspense>
            <Link
              href="/book"
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-cocoa-800 hover:text-cocoa-900"
            >
              Бүх сул цаг харах <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
