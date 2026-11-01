import type { Metadata, Viewport } from 'next'
import { Cormorant_Garamond, Golos_Text } from 'next/font/google'
import { BRAND } from '@/lib/brand'
import { siteOrigin } from '@/server/app-url'
import './globals.css'

const golos = Golos_Text({
  subsets: ['latin', 'cyrillic', 'cyrillic-ext'],
  variable: '--font-golos',
  display: 'swap',
})
const cormorant = Cormorant_Garamond({
  subsets: ['latin', 'cyrillic', 'cyrillic-ext'],
  variable: '--font-cormorant',
  weight: ['500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: {
    default: `${BRAND.name} — ${BRAND.descriptorMn} | Улаанбаатар (демо)`,
    template: `%s | ${BRAND.name} ${BRAND.descriptor}`,
  },
  description:
    'Сувд — хумс, гоо сайхны ателье (зохиомол демо брэнд). Маникюр, педикюр, хумс сунгалт, дизайн. Бодит сул цагаас онлайнаар захиална.',
  applicationName: `${BRAND.name} ${BRAND.descriptor}`,
  openGraph: { type: 'website', locale: 'mn_MN', siteName: `${BRAND.wordmark} ${BRAND.descriptor}` },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  themeColor: '#f7f2ea',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="mn" className={`${golos.variable} ${cormorant.variable}`} data-scroll-behavior="smooth">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  )
}
