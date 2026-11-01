import { ArrowLeft } from 'lucide-react'
import { PORTFOLIO } from '@/lib/brand'

/** Subtle, always-visible note that this is an Ursgal Digital demo with fictional data. */
export function DemoRibbon() {
  return (
    <div className="no-print bg-cocoa-900 text-[0.72rem] text-cocoa-200">
      <div className="container-page flex min-h-8 items-center justify-between gap-3 py-1">
        <a href={PORTFOLIO.portfolioUrl} className="inline-flex items-center gap-1.5 hover:text-ivory">
          <ArrowLeft className="size-3.5" aria-hidden />
          <span>
            <span className="hidden sm:inline">{PORTFOLIO.agency} · </span>Портфолио
          </span>
        </a>
        <p className="truncate text-right">
          <span className="font-semibold text-blush-200">Демо</span>
          <span className="hidden sm:inline"> · Зохиомол салон, жишээ өгөгдөл — бодит төлбөр, мессеж илгээгдэхгүй</span>
          <span className="sm:hidden"> · Зохиомол салон</span>
        </p>
      </div>
    </div>
  )
}
