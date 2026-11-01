import Link from 'next/link'
import { Logo } from '@/components/brand/logo'
import { ButtonLink } from '@/components/ui/button'
import { formatPhone, phoneHref } from '@/lib/phone'
import { MobileNav } from './mobile-nav'
import { NAV_LINKS } from './nav-links'

export function Header({ phone, announcement }: { phone: string; announcement: string | null }) {
  return (
    <>
      {announcement ? (
        <div className="bg-sand text-center text-[0.8rem] text-ink-2">
          <p className="container-page py-2">{announcement}</p>
        </div>
      ) : null}
      <header className="sticky top-0 z-40 border-b border-line/80 bg-ivory/95 backdrop-blur supports-[backdrop-filter]:bg-ivory/85">
        <div className="container-page flex h-[4.5rem] items-center justify-between gap-6">
          <Link href="/" aria-label="Сувд — нүүр хуудас" className="shrink-0">
            <Logo />
          </Link>
          <nav aria-label="Үндсэн цэс" className="hidden lg:block">
            <ul className="flex items-center gap-7 text-[0.92rem] text-ink-2">
              {NAV_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="py-2 transition-colors hover:text-cocoa-900">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center gap-3">
            <a href={phoneHref(phone)} className="tabular hidden text-sm text-ink-2 hover:text-cocoa-900 xl:inline">
              {formatPhone(phone)}
            </a>
            <ButtonLink href="/book" size="md" className="tracking-[0.08em] uppercase max-sm:hidden">
              Цаг захиалах
            </ButtonLink>
            <MobileNav phone={phone} />
          </div>
        </div>
      </header>
    </>
  )
}
