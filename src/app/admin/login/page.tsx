import { ArrowLeft, ShieldCheck } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Logo } from '@/components/brand/logo'
import { DemoEntry, LoginForm } from '@/components/admin/login-forms'
import { PORTFOLIO } from '@/lib/brand'

export const metadata: Metadata = { title: 'Админ самбар', robots: { index: false } }

export default function AdminLoginPage() {
  const demo = process.env.DEMO_MODE === 'true'
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="hidden flex-col justify-between bg-cocoa-900 p-12 text-ivory lg:flex">
        <Logo tone="light" />
        <div className="max-w-md">
          <p className="eyebrow !text-blush-300">Салоны удирдлагын самбар</p>
          <h1 className="display mt-4 text-5xl">Цаг захиалга, мастер, орлогоо нэг дороос</h1>
          <p className="mt-5 text-cocoa-200">
            Хуанли, захиалгын хүсэлт, үйлчилгээ, үнэ, ажилтны хуваарь, харилцагч, төлбөр, тайлан — бүгд нэг өгөгдлийн санд.
          </p>
        </div>
        <p className="text-xs text-cocoa-300">{PORTFOLIO.note}</p>
      </div>
      <div className="flex flex-col justify-center px-5 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-cocoa-900">
            <ArrowLeft className="size-4" aria-hidden /> Салоны вэбсайт
          </Link>
          <div className="mt-8 lg:hidden">
            <Logo />
          </div>
          {demo ? (
            <section aria-labelledby="demo-title" className="mt-8">
              <h2 id="demo-title" className="display text-4xl text-cocoa-900">
                Демо самбар
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-3">
                Нууц үггүйгээр зохиомол салоны самбарыг 60 минут үзнэ. Өөрчлөлтийг сервер шалгаад хадгалахгүй — зөвхөн энэ хөтчөөс үүсгэсэн
                туршилтын захиалгаа жинхэнээр баталгаажуулж, цуцалж чадна.
              </p>
              <div className="mt-6">
                <DemoEntry enabled={demo} />
              </div>
              <p className="mt-4 flex items-start gap-2 text-xs text-ink-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                Эрхийг сервер шалгадаг: товч нуух биш, хүсэлт бүрийг хянана. Бодит салоны өгөгдөлд хандах боломжгүй.
              </p>
            </section>
          ) : null}
          <section aria-labelledby="staff-login" className={demo ? 'mt-10 border-t border-line pt-8' : 'mt-8'}>
            <h2 id="staff-login" className="text-sm font-medium text-cocoa-900">
              Ажилтны нэвтрэлт
            </h2>
            <div className="mt-4">
              <LoginForm />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
