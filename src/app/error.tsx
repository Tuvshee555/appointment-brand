'use client'

import Link from 'next/link'
import { buttonClass } from '@/components/ui/button'

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-5 px-6 text-center">
      <h1 className="display text-4xl text-cocoa-900">Алдаа гарлаа</h1>
      <p className="max-w-md text-ink-3">Түр зуурын алдаа гарсан байна. Дахин оролдоно уу.</p>
      <div className="flex gap-3">
        <button type="button" onClick={reset} className={buttonClass('primary', 'md')}>
          Дахин оролдох
        </button>
        <Link href="/" className={buttonClass('secondary', 'md')}>
          Нүүр хуудас
        </Link>
      </div>
    </main>
  )
}
