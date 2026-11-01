import type { Metadata } from 'next'
import { PHOTOS } from '@/lib/photo-manifest'

export const metadata: Metadata = { title: 'Зургийн эх сурвалж', robots: { index: false } }

export default function CreditsPage() {
  const byPhotographer = new Map<string, { url: string; alt: string }[]>()
  for (const p of Object.values(PHOTOS)) {
    const list = byPhotographer.get(p.credit.photographer) ?? []
    list.push({ url: p.credit.url, alt: p.alt })
    byPhotographer.set(p.credit.photographer, list)
  }
  return (
    <div className="container-page max-w-3xl pt-12 pb-24 lg:pt-16">
      <p className="eyebrow">Эх сурвалж</p>
      <h1 className="display mt-3 text-5xl text-cocoa-900">Зургийн эх сурвалж</h1>
      <p className="mt-5 text-[1.02rem] leading-relaxed text-ink-2">
        Гэрэл зургууд Unsplash-ийн лицензээр (unsplash.com/license) ашиглагдсан бөгөөд брэндийн өнгөнд тааруулж бага
        зэрэг засварласан. Эдгээр нь бодит салоны бүтээл биш. Мастеруудын хөрөг зураг нь зохиомол хүмүүсийн AI-аар
        бүтээсэн зураг.
      </p>
      <ul className="mt-10 divide-y divide-line border-y border-line">
        {[...byPhotographer.entries()].map(([name, photos]) => (
          <li key={name} className="py-4">
            <p className="font-medium text-cocoa-900">{name}</p>
            <ul className="mt-1 space-y-1 text-sm">
              {photos.map((p) => (
                <li key={p.url}>
                  <a
                    href={p.url}
                    className="text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-cocoa-900"
                    rel="noreferrer"
                    target="_blank"
                  >
                    {p.alt}
                  </a>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
