'use client'

import { Menu, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { formatPhone, phoneHref } from '@/lib/phone'
import { NAV_LINKS } from './nav-links'

export function MobileNav({ phone }: { phone: string }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  // Close when navigating.
  const [lastPath, setLastPath] = useState(pathname)
  if (pathname !== lastPath) {
    setLastPath(pathname)
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex size-11 items-center justify-center rounded-xs text-cocoa-900 hover:bg-sand lg:hidden"
        aria-label="Цэс нээх"
        aria-expanded={open}
      >
        <Menu className="size-6" />
      </button>
      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === dialogRef.current) setOpen(false)
        }}
        className="m-0 ml-auto h-dvh max-h-dvh w-[min(22rem,88vw)] max-w-none bg-ivory p-0 text-ink"
        aria-label="Цэс"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <span className="eyebrow">Цэс</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex size-11 items-center justify-center rounded-xs hover:bg-sand"
              aria-label="Цэс хаах"
            >
              <X className="size-6" />
            </button>
          </div>
          <nav aria-label="Гар утасны цэс" className="flex-1 overflow-y-auto px-5 py-4">
            <ul className="space-y-1">
              <li>
                <Link href="/" className="block rounded-xs px-2 py-3 font-display text-2xl hover:bg-sand">
                  Нүүр
                </Link>
              </li>
              {NAV_LINKS.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="block rounded-xs px-2 py-3 font-display text-2xl hover:bg-sand"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/booking" className="block rounded-xs px-2 py-3 font-display text-2xl hover:bg-sand">
                  Миний захиалга
                </Link>
              </li>
            </ul>
          </nav>
          <div className="space-y-3 border-t border-line px-5 py-5">
            <Link
              href="/book"
              className="flex h-13 items-center justify-center rounded-xs bg-cocoa-800 text-sm font-medium tracking-[0.08em] text-ivory uppercase"
            >
              Цаг захиалах
            </Link>
            <a href={phoneHref(phone)} className="tabular block text-center text-sm text-ink-2">
              {formatPhone(phone)} (демо дугаар)
            </a>
          </div>
        </div>
      </dialog>
    </>
  )
}
