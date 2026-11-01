import { connection } from 'next/server'
import { NewAppointmentForm } from '@/components/admin/new-appointment'
import { PageHeader } from '@/components/admin/ui'
import { dateKeyOf, isDateKey } from '@/lib/datetime'
import { requireAdminPage } from '@/server/auth/current'
import { getPublicCatalog } from '@/server/queries/public'

export const metadata = { title: 'Шинэ захиалга' }

export default async function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; staff?: string }>
}) {
  await requireAdminPage('appointments.view')
  await connection()
  const [sp, catalog] = await Promise.all([searchParams, getPublicCatalog()])
  const date = sp.date && isDateKey(sp.date) ? sp.date : dateKeyOf(new Date())
  const staff = sp.staff && catalog.staff.some((s) => s.id === sp.staff) ? sp.staff : null
  return (
    <>
      <PageHeader
        title="Шинэ захиалга"
        description="Утсаар болон шууд ирсэн үйлчлүүлэгчийн захиалга. Цаг бүрийг ажлын хуваарь, давхцалтай тулгаж шалгана."
      />
      <NewAppointmentForm catalog={catalog} initialDate={date} initialStaff={staff} />
    </>
  )
}
