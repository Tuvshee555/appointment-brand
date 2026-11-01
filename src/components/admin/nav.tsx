'use client'

import {
  BarChart3,
  Bell,
  BotMessageSquare,
  CalendarDays,
  CreditCard,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Scissors,
  Settings,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Logo } from '@/components/brand/logo'
import { cn } from '@/lib/cn'
import { logoutAction } from '@/server/actions/auth'

export const ADMIN_NAV = [
  { href: '/admin', label: 'Тойм', icon: LayoutDashboard, permission: 'dashboard.view' },
  { href: '/admin/calendar', label: 'Хуанли', icon: CalendarDays, permission: 'appointments.view' },
  {
    href: '/admin/appointments',
    label: 'Захиалгууд',
    icon: ListChecks,
    permission: 'appointments.view',
    badge: 'pending',
  },
  { href: '/admin/services', label: 'Үйлчилгээ, үнэ', icon: Scissors, permission: 'services.view' },
  { href: '/admin/staff', label: 'Ажилтан, хуваарь', icon: UserRound, permission: 'staff.view' },
  { href: '/admin/customers', label: 'Харилцагч', icon: Users, permission: 'customers.view' },
  { href: '/admin/payments', label: 'Төлбөр, орлого', icon: CreditCard, permission: 'payments.view' },
  { href: '/admin/reports', label: 'Тайлан', icon: BarChart3, permission: 'reports.view' },
  { href: '/admin/assistant', label: 'AI туслах', icon: BotMessageSquare, permission: 'assistant.view' },
  { href: '/admin/notifications', label: 'Мэдэгдэл', icon: Bell, permission: 'notifications.view' },
  { href: '/admin/settings', label: 'Тохиргоо', icon: Settings, permission: 'settings.view' },
] as const

function NavList({
  permissions,
  pending,
  onNavigate,
}: {
  permissions: string[]
  pending: number
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  return (
    <ul className="space-y-0.5">
      {ADMIN_NAV.filter((i) => permissions.includes(i.permission)).map((item) => {
        const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href)
        const Icon = item.icon
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-xs px-3 py-2.5 text-[0.92rem] transition-colors',
                active ? 'bg-cocoa-800 text-ivory' : 'text-cocoa-200 hover:bg-white/5 hover:text-ivory',
              )}
            >
              <Icon className="size-[1.1rem] shrink-0" aria-hidden />
              <span className="flex-1">{item.label}</span>
              {'badge' in item && pending > 0 ? (
                <span
                  className="tabular rounded-full bg-blush-300 px-1.5 text-[0.7rem] font-semibold text-cocoa-900"
                  aria-label={`${pending} хүсэлт хүлээгдэж байна`}
                >
                  {pending}
                </span>
              ) : null}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

export function AdminSidebar({
  permissions,
  pending,
  user,
  salonName,
}: {
  permissions: string[]
  pending: number
  user: { name: string; roleName: string; isDemo: boolean }
  salonName: string
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [lastPath, setLastPath] = useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    setOpen(false)
  }
  useEffect(() => {
    const d = dialogRef.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  const footer = (
    <div className="border-t border-white/10 px-4 py-4">
      <p className="text-sm text-ivory">{user.name}</p>
      <p className="text-xs text-cocoa-300">
        {user.roleName}
        {user.isDemo ? ' · демо' : ''}
      </p>
      <form action={logoutAction} className="mt-3">
        <button type="submit" className="inline-flex items-center gap-2 text-xs text-cocoa-200 hover:text-ivory">
          <LogOut className="size-3.5" aria-hidden /> Гарах
        </button>
      </form>
    </div>
  )

  return (
    <>
      {/* Desktop */}
      <aside className="sticky top-0 hidden h-dvh flex-col bg-cocoa-900 lg:flex">
        <div className="px-5 pt-6 pb-5">
          <Link href="/admin" aria-label={`${salonName} — самбар`}>
            <Logo tone="light" compact />
          </Link>
          <p className="mt-2 text-[0.7rem] tracking-[0.18em] text-cocoa-300 uppercase">Удирдлагын самбар</p>
        </div>
        <nav aria-label="Самбарын цэс" className="flex-1 overflow-y-auto px-3">
          <NavList permissions={permissions} pending={pending} />
        </nav>
        <div className="px-5 pb-3">
          <Link href="/" className="text-xs text-cocoa-300 hover:text-ivory">
            ← Салоны вэбсайт
          </Link>
        </div>
        {footer}
      </aside>

      {/* Mobile */}
      <div className="sticky top-0 z-30 flex items-center justify-between bg-cocoa-900 px-4 py-3 lg:hidden">
        <Link href="/admin" aria-label="Самбар">
          <Logo tone="light" compact />
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex size-11 items-center justify-center rounded-xs text-ivory"
          aria-label="Цэс нээх"
        >
          <Menu className="size-6" />
          {pending > 0 ? (
            <span className="absolute top-3 right-3 size-2 rounded-full bg-blush-300" aria-hidden />
          ) : null}
        </button>
      </div>
      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === dialogRef.current && setOpen(false)}
        className="m-0 h-dvh max-h-dvh w-[min(20rem,86vw)] max-w-none bg-cocoa-900 p-0"
        aria-label="Самбарын цэс"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-4 py-3">
            <Logo tone="light" compact />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex size-11 items-center justify-center text-ivory"
              aria-label="Цэс хаах"
            >
              <X className="size-6" />
            </button>
          </div>
          <nav aria-label="Самбарын цэс (гар утас)" className="flex-1 overflow-y-auto px-3">
            <NavList permissions={permissions} pending={pending} onNavigate={() => setOpen(false)} />
          </nav>
          {footer}
        </div>
      </dialog>
    </>
  )
}
