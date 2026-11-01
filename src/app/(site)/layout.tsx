import { Suspense } from 'react'
import { ChatWidget } from '@/components/assistant/chat-widget'
import { DemoRibbon } from '@/components/site/demo-ribbon'
import { Footer } from '@/components/site/footer'
import { Header } from '@/components/site/header'
import { MobileBookBar } from '@/components/site/mobile-book-bar'
import { getPublicSalon } from '@/server/queries/public'

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const salon = await getPublicSalon()
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-ivory focus:px-4 focus:py-2"
      >
        Үндсэн агуулга руу шилжих
      </a>
      <DemoRibbon />
      <Header phone={salon.phone} announcement={salon.announcement} />
      <main id="main">{children}</main>
      <Footer salon={salon} />
      {/* Reads the path to hide itself in the booking flow, so it streams on dynamic routes. */}
      <Suspense fallback={null}>
        <MobileBookBar />
      </Suspense>
      <ChatWidget salonName={salon.name} />
    </>
  )
}
