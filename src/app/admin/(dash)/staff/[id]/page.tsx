import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { connection } from 'next/server'
import { BreaksForm, ScheduleForm, SkillsForm, StaffProfileForm, TimeOffForm } from '@/components/admin/staff-forms'
import { Card, EmptyState, PageHeader } from '@/components/admin/ui'
import { StaffAvatar } from '@/components/catalog/staff-card'
import { StatusBadge } from '@/components/ui/badge'
import { dateKeyOf, formatDateTime, formatTimeRange } from '@/lib/datetime'
import { requireAdminPage } from '@/server/auth/current'
import { loadStaffAdmin } from '@/server/queries/admin-staff'

export const metadata = { title: 'Ажилтан' }

export default async function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminPage('staff.view')
  await connection()
  const { id } = await params
  const now = new Date()
  if (id === 'new') {
    if (session.role === 'specialist') redirect('/admin/staff')
    return (
      <>
        <Link
          href="/admin/staff"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-cocoa-900"
        >
          <ArrowLeft className="size-4" aria-hidden /> Ажилтан
        </Link>
        <PageHeader title="Шинэ ажилтан" description="Хадгалсны дараа ур чадвар, үйлчилгээ, хуваарийг тохируулна." />
        <Card>
          <StaffProfileForm staff={null} />
        </Card>
      </>
    )
  }
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  if (session.role === 'specialist' && session.staffId !== id) redirect('/admin/staff')
  const data = await loadStaffAdmin(session.salonId, id, now)
  if (!data) notFound()
  const canEdit = (session.permissions.includes('staff.manage') || session.isDemo) && session.role !== 'specialist'

  return (
    <>
      <Link
        href="/admin/staff"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-cocoa-900"
      >
        <ArrowLeft className="size-4" aria-hidden /> Ажилтан
      </Link>
      <div className="mb-8 flex items-center gap-4">
        <StaffAvatar staff={data.staff} size={72} />
        <div>
          <h1 className="display text-4xl text-cocoa-900">{data.staff.name}</h1>
          <p className="text-ink-3">{data.staff.title}</p>
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Ирэх 14 хоногийн хуваарь" bodyClassName="p-0">
          {data.appointments.length ? (
            <ul className="divide-y divide-line">
              {data.appointments.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/admin/appointments/${a.id}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm hover:bg-ivory sm:flex-nowrap"
                  >
                    <span className="tabular shrink-0 sm:w-44">
                      {dateKeyOf(a.startsAt) === dateKeyOf(now)
                        ? `Өнөөдөр ${formatTimeRange(a.startsAt, a.endsAt)}`
                        : formatDateTime(a.startsAt)}
                    </span>
                    <span className="order-last w-full min-w-0 truncate sm:order-none sm:w-auto sm:flex-1">
                      {a.customerName} · <span className="text-ink-3">{a.services}</span>
                    </span>
                    <span className="ml-auto">
                      <StatusBadge status={a.status} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-5">
              <EmptyState title="Ирэх захиалга алга" />
            </div>
          )}
        </Card>
        {canEdit ? (
          <>
            <Card title="Долоо хоногийн ажлын хуваарь">
              <ScheduleForm data={data} />
            </Card>
            <Card title="Профайл">
              <StaffProfileForm staff={data.staff} />
            </Card>
            <Card title="Ур чадвар, үйлчилгээ">
              <SkillsForm data={data} />
            </Card>
            <Card title="Завсарлага">
              <BreaksForm data={data} />
            </Card>
            <Card title="Чөлөө, амралт">
              <TimeOffForm data={data} today={dateKeyOf(now)} />
            </Card>
          </>
        ) : (
          <Card title="Профайл">
            <p className="text-sm text-ink-2">{data.staff.bio}</p>
          </Card>
        )}
      </div>
    </>
  )
}
