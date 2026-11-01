import Link from 'next/link'
import { Logo } from '@/components/brand/logo'
import { PORTFOLIO } from '@/lib/brand'
import { minutesToTime, WEEKDAYS_MN } from '@/lib/datetime'
import { formatPhone, phoneHref } from '@/lib/phone'
import type { PublicSalon } from '@/server/queries/public'

export function hoursLines(hours: PublicSalon['hours']) {
  // Groups consecutive weekdays with identical hours: "Мягмар–Баасан 10:00–20:00".
  const groups: { from: number; to: number; text: string }[] = []
  for (const h of hours) {
    const text = h.isClosed ? 'Амарна' : `${minutesToTime(h.opensAt)}–${minutesToTime(h.closesAt)}`
    const last = groups[groups.length - 1]
    if (last && last.text === text && last.to === h.weekday - 1) last.to = h.weekday
    else groups.push({ from: h.weekday, to: h.weekday, text })
  }
  return groups.map((g) => ({
    days: g.from === g.to ? WEEKDAYS_MN[g.from - 1] : `${WEEKDAYS_MN[g.from - 1]}–${WEEKDAYS_MN[g.to - 1]}`,
    text: g.text,
  }))
}

export function Footer({ salon }: { salon: PublicSalon }) {
  return (
    <footer className="bg-cocoa-900 pb-24 text-cocoa-200 sm:pb-0">
      <div className="container-page grid gap-12 py-16 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="space-y-5">
          <Logo tone="light" />
          <p className="max-w-xs text-sm leading-relaxed text-cocoa-200/90">{salon.tagline}.</p>
          <p className="max-w-xs text-xs leading-relaxed text-cocoa-300">{PORTFOLIO.note}</p>
        </div>
        <div>
          <h2 className="eyebrow !text-blush-300">Салон</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li>
              <Link href="/services" className="hover:text-ivory">
                Үйлчилгээ, үнэ
              </Link>
            </li>
            <li>
              <Link href="/staff" className="hover:text-ivory">
                Мастерууд
              </Link>
            </li>
            <li>
              <Link href="/book" className="hover:text-ivory">
                Цаг захиалах
              </Link>
            </li>
            <li>
              <Link href="/booking" className="hover:text-ivory">
                Миний захиалга
              </Link>
            </li>
            <li>
              <Link href="/policies" className="hover:text-ivory">
                Нөхцөл, бодлого
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <h2 className="eyebrow !text-blush-300">Цагийн хуваарь</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {hoursLines(salon.hours).map((l) => (
              <li key={l.days} className="flex justify-between gap-4">
                <span>{l.days}</span>
                <span className="tabular text-ivory/90">{l.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="eyebrow !text-blush-300">Холбоо барих</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li>
              <a href={phoneHref(salon.phone)} className="tabular hover:text-ivory">
                {formatPhone(salon.phone)}
              </a>
            </li>
            {salon.email ? <li>{salon.email}</li> : null}
            <li className="leading-relaxed">{salon.addressLine}</li>
            {salon.addressNote ? <li className="text-xs text-cocoa-300">{salon.addressNote}</li> : null}
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="container-page flex flex-col gap-3 py-6 text-xs text-cocoa-300 sm:flex-row sm:items-center sm:justify-between">
          <p>© {salon.name} · зохиомол брэнд. Бүх нэр, утас, захиалга жишээ өгөгдөл.</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/credits" className="hover:text-ivory">
              Зургийн эх сурвалж
            </Link>
            <Link href="/admin" className="hover:text-ivory">
              Админ самбар үзэх
            </Link>
            <a href={PORTFOLIO.portfolioUrl} className="hover:text-ivory">
              {PORTFOLIO.agency} портфолио
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
