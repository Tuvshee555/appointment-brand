import Link from 'next/link'
import { Photo } from '@/components/ui/photo'
import type { PublicStaff } from '@/server/queries/public'

export function StaffAvatar({
  staff,
  size = 56,
  className = '',
}: {
  staff: Pick<PublicStaff, 'photoUrl' | 'photoAlt' | 'displayName'>
  size?: number
  className?: string
}) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-cocoa-100 font-display text-cocoa-700 ring-2 ring-ivory ${className}`}
      style={{ width: size, height: size }}
    >
      {staff.photoUrl ? (
        <Photo
          src={staff.photoUrl}
          alt={staff.photoAlt ?? staff.displayName}
          fill
          sizes={`${size}px`}
          className="object-cover object-top"
        />
      ) : (
        <span className="text-lg">{staff.displayName.slice(0, 1)}</span>
      )}
    </span>
  )
}

export function StaffCard({ staff }: { staff: PublicStaff }) {
  return (
    <article className="group flex flex-col">
      <div className="relative aspect-[3/4] overflow-hidden rounded-xs bg-sand">
        {staff.coverUrl ? (
          <Photo
            src={staff.coverUrl}
            alt={`${staff.displayName} мастерын хийсэн ажлын жишээ`}
            fill
            sizes="(min-width: 1024px) 19vw, (min-width: 640px) 30vw, 80vw"
            className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
          />
        ) : null}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-cocoa-900/45 to-transparent" />
        <div className="absolute bottom-4 left-4">
          <StaffAvatar staff={staff} size={64} />
        </div>
      </div>
      <div className="mt-4">
        <h3 className="font-display text-2xl text-cocoa-900">{staff.displayName}</h3>
        <p className="text-sm text-ink-3">{staff.title}</p>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {staff.specialties.map((s) => (
            <li key={s} className="rounded-xs border border-line px-2 py-0.5 text-xs text-ink-2">
              {s}
            </li>
          ))}
        </ul>
        <Link
          href={`/book?staff=${staff.slug}`}
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-cocoa-800 underline decoration-blush-300 underline-offset-4 hover:decoration-cocoa-700"
        >
          {staff.displayName}-д цаг захиалах
        </Link>
      </div>
    </article>
  )
}
