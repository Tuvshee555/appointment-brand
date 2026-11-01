import type { ReactNode } from 'react'
import { STATUS_SHORT, STATUS_TONES, type AppointmentStatus, type StatusTone } from '@/lib/booking/status'
import { cn } from '@/lib/cn'

const tones: Record<StatusTone, string> = {
  neutral: 'bg-cocoa-50 text-cocoa-700 ring-cocoa-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-600/25',
  success: 'bg-sage-50 text-sage-700 ring-sage-600/25',
  warning: 'bg-amber-50 text-amber-700 ring-amber-600/25',
  danger: 'bg-rose-50 text-rose-700 ring-rose-600/25',
  muted: 'bg-sand text-ink-3 ring-line-strong',
}

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: StatusTone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-xs px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function StatusBadge({
  status,
  className,
  label,
}: {
  status: AppointmentStatus
  className?: string
  label?: string
}) {
  return (
    <Badge tone={STATUS_TONES[status]} className={className}>
      <span aria-hidden className="size-1.5 rounded-full bg-current opacity-70" />
      {label ?? STATUS_SHORT[status]}
    </Badge>
  )
}

/** Marks sample data wherever it appears. */
export function DemoTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-xs bg-blush-100 px-1.5 py-0.5 text-[0.68rem] font-semibold tracking-wide text-blush-700 uppercase',
        className,
      )}
    >
      Жишээ
    </span>
  )
}
