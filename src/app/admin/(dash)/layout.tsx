import { and, eq, inArray } from 'drizzle-orm'
import { Info } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { AdminSidebar } from '@/components/admin/nav'
import { formatTime } from '@/lib/datetime'
import { getSessionActor } from '@/server/auth/session'
import { db } from '@/server/db'
import * as t from '@/server/db/schema'

export const metadata: Metadata = {
  title: { default: 'Самбар', template: '%s · Сувд самбар' },
  robots: { index: false },
}

// Every admin page authorizes itself and streams behind loading.tsx.
export const instant = false

async function Sidebar() {
  const session = await getSessionActor()
  if (!session) return null
  const [salon] = await db.select({ name: t.salons.name }).from(t.salons).where(eq(t.salons.id, session.salonId))
  const pending = await db.$count(
    t.appointments,
    and(
      eq(t.appointments.salonId, session.salonId),
      inArray(t.appointments.status, ['pending', 'awaiting_deposit']),
      session.role === 'specialist' && session.staffId ? eq(t.appointments.staffId, session.staffId) : undefined,
    ),
  )
  return (
    <AdminSidebar
      permissions={session.permissions}
      pending={pending}
      user={{ name: session.name, roleName: session.roleName, isDemo: session.isDemo }}
      salonName={salon?.name ?? 'Салон'}
    />
  )
}

async function DemoBanner() {
  const session = await getSessionActor()
  if (!session?.isDemo) return null
  return (
    <div className="flex items-start gap-3 border-b border-blush-200 bg-blush-50 px-4 py-2.5 text-[0.82rem] text-blush-700 sm:px-6 lg:px-10">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex flex-1 flex-col gap-1 md:flex-row md:items-center md:justify-between md:gap-4">
        <p>
          <span className="font-semibold">Демо горим.</span> Зохиомол салон, жишээ өгөгдөл. Өөрчлөлтийг сервер шалгаад
          хадгалахгүй — зөвхөн өөрийн туршилтын захиалгыг өөрчилнө. Хандалт {formatTime(session.expiresAt)}-д дуусна.
        </p>
        <Link href="/book" className="shrink-0 font-medium underline underline-offset-4">
          Туршилтын захиалга үүсгэх
        </Link>
      </div>
    </div>
  )
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-ivory lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <div className="bg-cocoa-900 lg:min-h-dvh">
        <Suspense fallback={<div className="h-16 lg:h-dvh" />}>
          <Sidebar />
        </Suspense>
      </div>
      <div className="min-w-0">
        <Suspense fallback={null}>
          <DemoBanner />
        </Suspense>
        <main id="main" className="px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  )
}
