import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { ServiceForm } from '@/components/admin/catalog-forms'
import { PageHeader } from '@/components/admin/ui'
import { requireAdminPage } from '@/server/auth/current'
import { loadCatalogAdmin } from '@/server/queries/admin-catalog'

export const metadata = { title: 'Үйлчилгээ засах' }

export default async function ServiceEditPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminPage('services.view')
  await connection()
  const { id } = await params
  const catalog = await loadCatalogAdmin(session.salonId)
  const service = id === 'new' ? null : (catalog.services.find((s) => s.id === id) ?? null)
  if (id !== 'new' && !service) notFound()
  return (
    <>
      <Link
        href="/admin/services"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-cocoa-900"
      >
        <ArrowLeft className="size-4" aria-hidden /> Үйлчилгээ
      </Link>
      <PageHeader
        title={service ? service.name : 'Шинэ үйлчилгээ'}
        description="Хадгалахад сервер мастерын ур чадвар, үнэ, хугацааг шалгана."
      />
      <ServiceForm catalog={catalog} service={service} />
    </>
  )
}
