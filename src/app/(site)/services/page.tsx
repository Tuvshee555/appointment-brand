import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ServiceCatalog } from '@/components/catalog/service-catalog'
import { getPublicCatalog } from '@/server/queries/public'

export const metadata: Metadata = {
  title: 'Үйлчилгээ, үнэ',
  description:
    'Маникюр, хумс сунгалт, дизайн, педикюр, нэмэлт үйлчилгээний бүрэн жагсаалт — үнэ, үргэлжлэх хугацаа, нэмэлт сонголттой.',
}

export default async function ServicesPage() {
  const catalog = await getPublicCatalog()
  return (
    <div className="container-page pb-24">
      <header className="pt-12 pb-8 lg:pt-16">
        <p className="eyebrow">Үйлчилгээ</p>
        <h1 className="display mt-3 text-5xl text-cocoa-900 sm:text-6xl">Үйлчилгээ, үнэ</h1>
        <p className="mt-4 max-w-2xl text-[1.04rem] leading-relaxed text-ink-3">
          {catalog.services.length} үйлчилгээ, {catalog.addons.length} нэмэлт сонголт. Үнэ, хугацаа нь салоны системээс
          шууд харагдах тул захиалах үед ч яг ийм байна. Бүх үнэ жишээ (зохиомол).
        </p>
      </header>
      <Suspense fallback={<div className="h-96" aria-hidden />}>
        <ServiceCatalog catalog={catalog} />
      </Suspense>
    </div>
  )
}
