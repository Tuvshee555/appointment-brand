'use client'

import { CalendarDays } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** Sticky booking call-to-action on phones (hidden inside the booking flow). */
export function MobileBookBar() {
  const pathname = usePathname()
  if (pathname.startsWith('/book') || pathname.startsWith('/booking')) return null
  return (
    <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ivory/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
      <Link
        href="/book"
        className="flex h-12 items-center justify-center gap-2 rounded-xs bg-cocoa-800 text-sm font-medium tracking-[0.08em] text-ivory uppercase active:bg-cocoa-900"
      >
        <CalendarDays className="size-4" aria-hidden />
        Цаг захиалах
      </Link>
    </div>
  )
}
