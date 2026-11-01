import Link from 'next/link'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'blush' | 'danger' | 'light'
type Size = 'sm' | 'md' | 'lg'

const base =
  'inline-flex items-center justify-center gap-2 rounded-xs font-medium transition-colors focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-50 select-none whitespace-nowrap'

const variants: Record<Variant, string> = {
  primary: 'bg-cocoa-800 text-ivory hover:bg-cocoa-900 active:bg-cocoa-900',
  secondary: 'border border-cocoa-800/70 text-cocoa-900 hover:bg-cocoa-900 hover:text-ivory',
  ghost: 'text-ink-2 hover:bg-sand',
  blush: 'bg-blush-200 text-cocoa-900 hover:bg-blush-300',
  danger: 'border border-rose-600/40 text-rose-700 hover:bg-rose-50',
  light: 'bg-ivory text-cocoa-900 hover:bg-porcelain',
}

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-5 text-[0.95rem]',
  lg: 'h-13 px-7 text-[0.95rem] tracking-[0.06em] uppercase',
}

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', className?: string) {
  return cn(base, variants[variant], sizes[size], className)
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />
}
