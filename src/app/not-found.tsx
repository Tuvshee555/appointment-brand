import Link from 'next/link'
import { Logo } from '@/components/brand/logo'
import { buttonClass } from '@/components/ui/button'

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <h1 className="display text-5xl text-cocoa-900">Хуудас олдсонгүй</h1>
      <p className="max-w-md text-ink-3">Таны хайсан хуудас байхгүй эсвэл шилжсэн байна.</p>
      <div className="flex gap-3">
        <Link href="/" className={buttonClass('primary', 'md')}>
          Нүүр хуудас
        </Link>
        <Link href="/book" className={buttonClass('secondary', 'md')}>
          Цаг захиалах
        </Link>
      </div>
    </main>
  )
}
