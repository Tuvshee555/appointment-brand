import type { Metadata } from 'next'
import { Suspense } from 'react'
import { BookingWizard } from '@/components/booking/booking-wizard'
import { getPublicCatalog, getPublicSalon } from '@/server/queries/public'

export const metadata: Metadata = {
  title: 'Цаг захиалах',
  description: 'Үйлчилгээ, мастер, бодит сул цагаа сонгоод онлайнаар цаг захиална.',
}

export default async function BookPage() {
  const [catalog, salon] = await Promise.all([getPublicCatalog(), getPublicSalon()])
  return (
    <div className="container-page pt-10 pb-32 lg:pt-14 lg:pb-24">
      <Suspense fallback={<div className="h-[60vh]" aria-hidden />}>
        <BookingWizard catalog={catalog} rules={salon.rules} />
      </Suspense>
    </div>
  )
}
