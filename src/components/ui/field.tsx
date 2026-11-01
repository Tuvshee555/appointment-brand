import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { minutesToTime } from '@/lib/datetime'

export const inputClass =
  'block w-full rounded-xs border border-line-strong bg-porcelain px-3.5 py-2.5 text-[0.95rem] text-ink placeholder:text-ink-3/70 transition-colors focus:border-cocoa-600 focus:outline-none focus:ring-2 focus:ring-cocoa-600/15 disabled:bg-sand aria-[invalid=true]:border-rose-600'

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
  optional,
}: {
  label: string
  htmlFor: string
  hint?: ReactNode
  error?: string
  children: ReactNode
  className?: string
  optional?: boolean
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="flex items-baseline justify-between gap-2 text-sm font-medium text-ink-2">
        <span>{label}</span>
        {optional && <span className="text-xs font-normal text-ink-3">заавал биш</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm text-rose-700" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(inputClass, className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(inputClass, 'min-h-24 resize-y', className)} {...props} />
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(inputClass, 'appearance-auto pr-8', className)} {...props} />
}

const QUARTER_HOURS = Array.from({ length: 96 }, (_, i) => minutesToTime(i * 15))

/** 24-hour time in 15-minute steps. Native time inputs follow the browser locale and can show AM/PM. */
export function TimeSelect({
  value,
  ...props
}: Omit<ComponentProps<'select'>, 'value' | 'children'> & { value: string }) {
  const options = QUARTER_HOURS.includes(value) ? QUARTER_HOURS : [...QUARTER_HOURS, value].sort()
  return (
    <Select value={value} {...props}>
      {options.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </Select>
  )
}

export function Checkbox({ label, className, ...props }: ComponentProps<'input'> & { label: ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5 text-sm text-ink-2', className)}>
      <input type="checkbox" className="mt-0.5 size-4 accent-cocoa-700" {...props} />
      <span>{label}</span>
    </label>
  )
}
