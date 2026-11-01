import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="display mt-1 text-[2.3rem] text-cocoa-900 sm:text-[2.6rem]">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm text-ink-3">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}

export function Card({ title, action, children, className, bodyClassName }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn('surface', className)}>
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-[0.95rem] font-medium text-cocoa-900">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  )
}

export function StatCard({ label, value, hint, tone = 'default' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'accent' | 'warning' | 'danger' }) {
  return (
    <div
      className={cn(
        'surface p-4',
        tone === 'accent' && 'border-cocoa-300 bg-cocoa-50',
        tone === 'warning' && 'border-amber-600/30 bg-amber-50',
        tone === 'danger' && 'border-rose-600/25 bg-rose-50',
      )}
    >
      <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">{label}</p>
      <p className="mt-2 font-display text-[2rem] leading-none text-cocoa-900 tabular">{value}</p>
      {hint ? <p className="mt-2 text-xs text-ink-3">{hint}</p> : null}
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="font-medium text-cocoa-900">{title}</p>
      {children ? <div className="mt-2 text-sm text-ink-3">{children}</div> : null}
    </div>
  )
}

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="surface overflow-x-auto">
      <table className="w-full min-w-[44rem] text-left text-sm">{children}</table>
    </div>
  )
}

export const th = 'border-b border-line bg-porcelain px-4 py-3 text-xs font-medium tracking-wide whitespace-nowrap text-ink-3 uppercase'
export const td = 'border-b border-line px-4 py-3 align-top'

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-xs bg-sand px-2 py-0.5 text-xs text-ink-2', className)}>{children}</span>
}
