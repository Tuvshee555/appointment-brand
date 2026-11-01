import { Clock } from 'lucide-react'
import Link from 'next/link'
import { Money } from '@/components/ui/money'
import { Photo } from '@/components/ui/photo'
import { formatDuration } from '@/lib/datetime'
import type { PublicService } from '@/server/queries/public'

export function ServiceCard({ service, priority = false }: { service: PublicService; priority?: boolean }) {
  return (
    <article className="group flex flex-col">
      <Link
        href={`/book?service=${service.slug}`}
        className="relative block aspect-[4/5] overflow-hidden rounded-xs bg-sand"
      >
        {service.imageUrl ? (
          <Photo
            src={service.imageUrl}
            alt={service.imageAlt ?? service.name}
            fill
            priority={priority}
            sizes="(min-width: 1024px) 24vw, (min-width: 640px) 45vw, 90vw"
            className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
          />
        ) : null}
        <span className="absolute top-3 left-3 rounded-xs bg-ivory/90 px-2 py-1 text-[0.7rem] font-medium tracking-wide text-cocoa-800">
          {service.categoryName}
        </span>
      </Link>
      <div className="mt-4 flex flex-1 flex-col">
        <h3 className="font-display text-[1.45rem] leading-tight text-cocoa-900">{service.name}</h3>
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-3">{service.shortDescription}</p>
        <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-sm">
          <span className="inline-flex items-center gap-1.5 text-ink-3">
            <Clock className="size-4" aria-hidden />
            {formatDuration(service.durationMinutes)}
          </span>
          <Money amount={service.price} from={service.priceType === 'from'} className="font-medium text-cocoa-900" />
        </div>
      </div>
    </article>
  )
}
