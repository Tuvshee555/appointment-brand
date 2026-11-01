import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = 'left',
  action,
  className,
  id,
}: {
  eyebrow?: string
  title: ReactNode
  lead?: ReactNode
  align?: 'left' | 'center'
  action?: ReactNode
  className?: string
  id?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-6 md:flex-row md:items-end md:justify-between',
        align === 'center' && 'items-center text-center md:flex-col md:items-center',
        className,
      )}
    >
      <div className={cn('max-w-2xl', align === 'center' && 'mx-auto')}>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 id={id} className="display mt-3 text-[2.4rem] text-cocoa-900 sm:text-5xl">
          {title}
        </h2>
        {lead ? <p className="mt-4 text-[1.02rem] leading-relaxed text-ink-3">{lead}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
