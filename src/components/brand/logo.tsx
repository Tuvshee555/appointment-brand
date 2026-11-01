import { BRAND } from '@/lib/brand'
import { cn } from '@/lib/cn'

/** The pearl mark: a single pearl with a soft nacre highlight. */
export function PearlMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden className={cn('size-8', className)}>
      <circle cx="20" cy="20" r="17" fill="currentColor" opacity="0.1" />
      <circle cx="20" cy="20" r="11.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M14.2 17.2a6.8 6.8 0 0 1 5.6-4.3"
        fill="none"
        stroke="var(--color-blush-400)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Wordmark lockup: pearl + SUVD + descriptor. */
export function Logo({
  tone = 'dark',
  compact = false,
  className,
}: {
  tone?: 'dark' | 'light'
  compact?: boolean
  className?: string
}) {
  return (
    <span
      className={cn('inline-flex items-center gap-2.5', tone === 'dark' ? 'text-cocoa-900' : 'text-ivory', className)}
    >
      <PearlMark className="size-9 shrink-0" />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[1.65rem] font-semibold tracking-[0.32em]">{BRAND.wordmark}</span>
        {!compact && (
          <span
            className={cn(
              'mt-1 text-[0.6rem] font-medium tracking-[0.28em] uppercase',
              tone === 'dark' ? 'text-cocoa-500' : 'text-blush-200',
            )}
          >
            {BRAND.descriptor}
          </span>
        )}
      </span>
    </span>
  )
}
