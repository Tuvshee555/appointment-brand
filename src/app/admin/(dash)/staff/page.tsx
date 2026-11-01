import { Plus } from 'lucide-react'
import Link from 'next/link'
import { connection } from 'next/server'
import { PageHeader } from '@/components/admin/ui'
import { StaffAvatar } from '@/components/catalog/staff-card'
import { buttonClass } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { WEEKDAYS_SHORT_MN } from '@/lib/datetime'
import { requireAdminPage } from '@/server/auth/current'
import { listStaffAdmin } from '@/server/queries/admin-staff'

export const metadata = { title: 'Ажилтан, хуваарь' }

export default async function StaffAdminPage() {
  const session = await requireAdminPage('staff.view')
  await connection()
  const staff = await listStaffAdmin(session.salonId, new Date())
  const visible = session.role === 'specialist' ? staff.filter((s) => s.id === session.staffId) : staff
  return (
    <>
      <PageHeader
        title="Ажилтан, хуваарь"
        description="Ажлын хуваарь, завсарлага, чөлөө, ур чадвар нь онлайн сул цагийг шууд тодорхойлно."
        actions={
          (session.permissions.includes('staff.manage') || session.isDemo) && session.role !== 'specialist' ? (
            <Link href="/admin/staff/new" className={buttonClass('primary', 'md')}>
              <Plus className="size-4" aria-hidden /> Ажилтан нэмэх
            </Link>
          ) : null
        }
      />
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((s) => (
          <li key={s.id}>
            <Link
              href={`/admin/staff/${s.id}`}
              className="surface flex h-full flex-col gap-4 p-5 transition-shadow hover:shadow-soft"
            >
              <div className="flex items-center gap-3">
                <StaffAvatar staff={s} size={56} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{s.name}</p>
                  <p className="truncate text-sm text-ink-3">{s.title}</p>
                </div>
                <span className="size-3 rounded-full" style={{ background: s.calendarColor }} aria-hidden />
              </div>
              <div className="flex gap-1">
                {WEEKDAYS_SHORT_MN.map((w, i) => (
                  <span
                    key={w}
                    className={`flex-1 rounded-[3px] py-1 text-center text-[0.68rem] ${s.workDays.includes(i + 1) ? 'bg-cocoa-100 text-cocoa-800' : 'bg-sand text-ink-3/50'}`}
                  >
                    {w}
                  </span>
                ))}
              </div>
              <div className="mt-auto flex flex-wrap gap-1.5 text-xs">
                {s.isActive ? <Badge tone="success">Идэвхтэй</Badge> : <Badge tone="muted">Идэвхгүй</Badge>}
                {!s.acceptsOnlineBookings ? <Badge tone="warning">Онлайн захиалга хаалттай</Badge> : null}
                <Badge>{s.serviceCount} үйлчилгээ</Badge>
                <Badge tone="info">Өнөөдөр {s.today}</Badge>
                <Badge>Ирэх {s.upcoming}</Badge>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
