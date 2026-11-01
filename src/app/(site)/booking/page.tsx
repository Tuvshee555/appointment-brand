import type { Metadata } from 'next'
import { Suspense } from 'react'
import { LookupForm } from '@/components/booking/lookup-form'

export const metadata: Metadata = { title: 'Миний захиалга', description: 'Захиалгын дугаар, утсаараа захиалгаа харах, цуцлах, цаг өөрчлөх.' }

export default function LookupPage() {
  return (
    <div className="container-page grid gap-12 pt-12 pb-24 lg:grid-cols-[1fr_1fr] lg:pt-16">
      <div>
        <p className="eyebrow">Миний захиалга</p>
        <h1 className="display mt-3 text-5xl text-cocoa-900 sm:text-6xl">Захиалгаа удирдах</h1>
        <p className="mt-4 max-w-md text-[1.02rem] leading-relaxed text-ink-3">
          Захиалгын дугаар, захиалахдаа өгсөн утасны дугаараа оруулаад захиалгынхаа төлөвийг харж, цуцлах эсвэл өөр цаг руу шилжүүлнэ.
        </p>
      </div>
      <div className="surface p-6 sm:p-8">
        <Suspense fallback={null}>
          <LookupForm />
        </Suspense>
      </div>
    </div>
  )
}
