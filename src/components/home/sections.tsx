import { ArrowRight, ArrowUpRight, Gem, LayoutDashboard, Leaf, MessageCircle, ShieldCheck, Sparkles, Timer } from 'lucide-react'
import Link from 'next/link'
import { ServiceCard } from '@/components/catalog/service-card'
import { StaffCard } from '@/components/catalog/staff-card'
import { hoursLines } from '@/components/site/footer'
import { ButtonLink } from '@/components/ui/button'
import { Money } from '@/components/ui/money'
import { Photo } from '@/components/ui/photo'
import { SectionHeading } from '@/components/ui/section-heading'
import { BRAND, PORTFOLIO } from '@/lib/brand'
import { formatDateKey, formatDuration, minutesToTime } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { formatPhone, phoneHref } from '@/lib/phone'
import { PHOTOS, type PhotoName } from '@/lib/photo-manifest'
import type { PublicCatalog, PublicSalon } from '@/server/queries/public'

export function Differentiators() {
  const items = [
    { icon: ShieldCheck, title: 'Ариун цэвэр', text: 'Төмөр багаж бүрийг ариутгаж, файл, бафыг нэг удаа хэрэглэнэ.' },
    { icon: Timer, title: 'Бодит сул цаг', text: 'Хуанли мастер бүрийн хуваарьтай шууд холбоотой — давхар захиалга гарахгүй.' },
    { icon: Gem, title: 'Нэг удаад нэг хүн', text: 'Мастер таныг яаралгүй, бүрэн анхааралтай үйлчилнэ.' },
    { icon: Leaf, title: 'Тодорхой үнэ', text: 'Үнэ, үргэлжлэх хугацаа, урьдчилгааг захиалахаас өмнө харна.' },
  ]
  return (
    <section aria-label="Сувдын онцлог" className="border-y border-line bg-porcelain">
      <ul className="container-page grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-4">
            <Icon className="mt-1 size-5 shrink-0 text-blush-500" aria-hidden />
            <div>
              <h3 className="font-medium text-cocoa-900">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-3">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function FeaturedServices({ catalog }: { catalog: PublicCatalog }) {
  const featured = catalog.services.filter((s) => s.isFeatured).slice(0, 6)
  return (
    <section aria-labelledby="featured-title" className="container-page py-20 lg:py-28">
      <SectionHeading
        id="featured-title"
        eyebrow="Онцлох үйлчилгээ"
        title="Хамгийн их захиалагддаг"
        lead="Үнэ, үргэлжлэх хугацаа нь админ самбараас удирдагддаг бодит каталогоос шууд харагдана."
        action={
          <ButtonLink href="/services" variant="ghost" className="px-0 underline decoration-blush-300 underline-offset-8 hover:bg-transparent">
            Бүх үйлчилгээ <ArrowRight className="size-4" aria-hidden />
          </ButtonLink>
        }
      />
      <div className="mt-12 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
        {featured.map((s, i) => (
          <ServiceCard key={s.id} service={s} priority={i < 2} />
        ))}
      </div>
    </section>
  )
}

export function Categories({ catalog }: { catalog: PublicCatalog }) {
  return (
    <section aria-labelledby="categories-title" className="bg-sand/60 py-20 lg:py-28">
      <div className="container-page">
        <SectionHeading id="categories-title" eyebrow="Ангилал" title="Танд юу хэрэгтэй вэ?" />
        <ul className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {catalog.categories.map((c, i) => (
            <li key={c.id} className={i === 0 ? 'col-span-2 md:col-span-1' : ''}>
              <Link href={`/services?category=${c.slug}`} className="group relative block aspect-[3/4] overflow-hidden rounded-xs bg-cocoa-100">
                {c.imageUrl ? (
                  <Photo
                    src={c.imageUrl}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 18vw, (min-width: 768px) 30vw, 50vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                  />
                ) : null}
                <div className="absolute inset-0 bg-gradient-to-t from-cocoa-900/75 via-cocoa-900/10 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-4 text-ivory">
                  <h3 className="font-display text-2xl leading-tight">{c.name}</h3>
                  <p className="mt-1 text-xs text-ivory/80">
                    {c.serviceCount} үйлчилгээ · {formatMoney(c.minPrice)}-өөс
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function PriceList({ catalog }: { catalog: PublicCatalog }) {
  return (
    <section id="prices" aria-labelledby="prices-title" className="container-page scroll-mt-24 py-20 lg:py-28">
      <SectionHeading
        id="prices-title"
        eyebrow="Үнийн жагсаалт"
        title="Үнэ, хугацаа"
        lead="«-өөс» гэсэн үнэ дизайны нарийн түвшнээс хамаарч салонд тохирно. Бүх үнэ жишээ (зохиомол) бөгөөд эзэмшигч админ самбараас өөрчилнө."
      />
      <div className="mt-12 grid gap-x-16 gap-y-12 lg:grid-cols-2">
        {catalog.categories.map((c) => (
          <div key={c.id}>
            <h3 className="font-display text-[1.7rem] text-cocoa-900">{c.name}</h3>
            <ul className="mt-4 divide-y divide-line border-t border-line">
              {catalog.services
                .filter((s) => s.categoryId === c.id)
                .map((s) => (
                  <li key={s.id}>
                    <Link href={`/book?service=${s.slug}`} className="group flex items-baseline gap-3 py-3.5">
                      <span className="text-[0.98rem] text-ink group-hover:text-cocoa-700">{s.name}</span>
                      <span className="leader" aria-hidden />
                      <span className="shrink-0 text-xs text-ink-3">{formatDuration(s.durationMinutes)}</span>
                      <Money amount={s.price} from={s.priceType === 'from'} className="w-28 shrink-0 text-right font-medium text-cocoa-900" />
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        ))}
        <div>
          <h3 className="font-display text-[1.7rem] text-cocoa-900">Нэмэлт сонголтууд</h3>
          <p className="mt-1 text-sm text-ink-3">Үндсэн үйлчилгээн дээр нэмж сонгоно. Нэмэлт үнэ, хугацаа захиалгын нийлбэрт шууд нэмэгдэнэ.</p>
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {catalog.addons.map((a) => (
              <li key={a.id} className="flex items-baseline gap-3 py-3.5">
                <span className="text-[0.98rem] text-ink">{a.name}</span>
                <span className="leader" aria-hidden />
                <span className="shrink-0 text-xs text-ink-3">+{formatDuration(a.durationMinutes)}</span>
                <span className="w-28 shrink-0 text-right font-medium text-cocoa-900">
                  +<Money amount={a.price} from={a.priceType === 'from'} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

export function StaffSection({ catalog }: { catalog: PublicCatalog }) {
  return (
    <section aria-labelledby="staff-title" className="bg-porcelain py-20 lg:py-28">
      <div className="container-page">
        <SectionHeading
          id="staff-title"
          eyebrow="Мастерууд"
          title="Таны гарт итгэл хүлээлгэх хүмүүс"
          lead="Мастер бүр зөвхөн өөрийн мэргэшсэн үйлчилгээг хийнэ. Зураг нь зохиомол хүмүүсийн AI-аар бүтээсэн хөрөг."
          action={
            <ButtonLink href="/staff" variant="ghost" className="px-0 underline decoration-blush-300 underline-offset-8 hover:bg-transparent">
              Танилцуулга <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
          }
        />
        <div className="no-scrollbar -mx-4 mt-12 flex snap-x snap-mandatory gap-6 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-5">
          {catalog.staff.map((s) => (
            <div key={s.id} className="w-[72%] shrink-0 snap-start sm:w-auto">
              <StaffCard staff={s} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const GALLERY: { photo: PhotoName; caption: string; span?: string }[] = [
  { photo: 'pearl-art', caption: 'Сувдан чимэглэл', span: 'row-span-2' },
  { photo: 'tortoiseshell', caption: 'Яст мэлхийн хээ' },
  { photo: 'french-daisy', caption: 'Сонгодог франц' },
  { photo: 'gold-chrome', caption: 'Алтлаг хром', span: 'row-span-2' },
  { photo: 'mauve-glitter', caption: 'Пастел, гялтгар' },
  { photo: 'lilac-extensions', caption: 'Сунгалт' },
  { photo: 'abstract-art', caption: 'Захиалгат дизайн', span: 'row-span-2' },
  { photo: 'taupe-chrome', caption: 'Бор саарал хром' },
  { photo: 'sheer-almond', caption: 'Бүйлс, тунгалаг' },
]

export function Gallery() {
  return (
    <section id="gallery" aria-labelledby="gallery-title" className="container-page scroll-mt-24 py-20 lg:py-28">
      <SectionHeading id="gallery-title" eyebrow="Галерей" title="Бидний ажлын өнгө төрх" lead="Лицензтэй (Unsplash) гэрэл зураг — бодит салоны ажил биш, брэндийн чиглэлийг харуулна." />
      <ul className="mt-12 grid auto-rows-[11rem] grid-cols-2 gap-3 sm:auto-rows-[14rem] md:grid-cols-3 lg:auto-rows-[15rem] lg:grid-cols-4">
        {GALLERY.map((g) => {
          const p = PHOTOS[g.photo]
          return (
            <li key={g.photo} className={`group relative overflow-hidden rounded-xs bg-sand ${g.span ?? ''}`}>
              <Photo src={p.src} alt={p.alt} fill loading="lazy" sizes="(min-width: 1024px) 24vw, (min-width: 768px) 32vw, 50vw" className="object-cover transition-transform duration-700 group-hover:scale-[1.04]" />
              <span className="absolute bottom-2 left-2 rounded-xs bg-ivory/90 px-2 py-1 text-[0.72rem] text-cocoa-800 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                {g.caption}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function Experience({ salon }: { salon: PublicSalon }) {
  const steps = [
    { title: 'Онлайнаар захиална', text: 'Үйлчилгээ, мастер, бодит сул цагаа сонгоод захиалгын дугаараа шууд авна.' },
    { title: 'Хүсэлтээ ярилцана', text: 'Мастер хэлбэр, өнгө, уртыг тань асууж, гарт тань тохирохыг зөвлөнө.' },
    { title: 'Нямбай гүйцэтгэнэ', text: 'Ариутгасан багаж, баталгаатай материалаар, яаралгүй хийнэ.' },
    { title: 'Арчилгааны зөвлөгөө', text: 'Гэртээ хэрхэн арчлах, дараагийн нөхөлтийн хугацааг хэлж өгнө.' },
  ]
  const p = PHOTOS['at-work']
  return (
    <section aria-labelledby="experience-title" className="bg-cocoa-900 py-20 text-ivory lg:py-28">
      <div className="container-page grid gap-14 lg:grid-cols-[1fr_1.1fr] lg:items-center">
        <div className="relative aspect-[3/2] overflow-hidden rounded-xs">
          <Photo src={p.src} alt={p.alt} fill loading="lazy" sizes="(min-width: 1024px) 45vw, 100vw" className="object-cover" />
        </div>
        <div>
          <p className="eyebrow !text-blush-300">Үйлчлүүлэгчийн туршлага</p>
          <h2 id="experience-title" className="display mt-3 text-[2.4rem] sm:text-5xl">
            Ирэхээс эхлээд гарах хүртэл
          </h2>
          <ol className="mt-10 space-y-7">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-5">
                <span className="font-display text-3xl text-blush-300 tabular">0{i + 1}</span>
                <div>
                  <h3 className="font-medium">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-cocoa-200">{s.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-10 border-t border-white/10 pt-6 text-sm text-cocoa-200">
            {salon.rules.lateArrivalMinutes} минутаас дээш хоцорвол үйлчилгээ богиносох эсвэл өөр цаг санал болгож болно.
          </p>
        </div>
      </div>
    </section>
  )
}

export function About({ salon }: { salon: PublicSalon }) {
  const p = PHOTOS['treatment-room']
  return (
    <section id="about" aria-labelledby="about-title" className="container-page scroll-mt-24 py-20 lg:py-28">
      <div className="grid gap-14 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <p className="eyebrow">Бидний тухай</p>
          <h2 id="about-title" className="display mt-3 text-[2.4rem] text-cocoa-900 sm:text-5xl">
            {salon.name} — {BRAND.descriptorMn.toLowerCase()}
          </h2>
          <p className="mt-6 text-[1.04rem] leading-relaxed text-ink-2">{salon.about}</p>
          <blockquote className="mt-8 border-l-2 border-blush-300 pl-5 font-display text-[1.6rem] leading-snug text-cocoa-700 italic">
            {BRAND.story}
          </blockquote>
        </div>
        <div className="relative aspect-[4/5] overflow-hidden rounded-xs bg-sand lg:aspect-[5/6]">
          <Photo src={p.src} alt={p.alt} fill loading="lazy" sizes="(min-width: 1024px) 42vw, 100vw" className="object-cover" />
        </div>
      </div>
    </section>
  )
}

export function Faq({ salon, catalog }: { salon: PublicSalon; catalog: PublicCatalog }) {
  const removal = catalog.addons.find((a) => a.slug === 'gel-removal-addon')
  const gel = catalog.services.find((s) => s.slug === 'gel-polish')
  const items = [
    {
      q: 'Гель будалт хэр удаан тогтох вэ?',
      a: `Зөв арчилбал гарт 3 долоо хоног, хөлд 4 долоо хоног хүртэл тогтоно.${gel ? ` Гель будалт ${formatMoney(gel.price)}, ${formatDuration(gel.durationMinutes)} үргэлжилнэ.` : ''}`,
    },
    {
      q: 'Захиалгаа хэрхэн цуцлах, өөр цаг руу шилжүүлэх вэ?',
      a: `«Миний захиалга» хэсэгт захиалгын дугаар, утсаараа орж цуцлах эсвэл өөр сул цаг сонгоно. ${salon.cancellationPolicy}`,
    },
    { q: 'Урьдчилгаа яагаад авдаг вэ?', a: salon.depositPolicy || 'Энэ салон урьдчилгаа авдаггүй.' },
    {
      q: 'Өөр газар хийлгэсэн гелээ авахуулж болох уу?',
      a: removal
        ? `Болно. Захиалахдаа «${removal.name}» нэмэлтийг сонгоно уу (${formatMoney(removal.price)}, ${formatDuration(removal.durationMinutes)}).`
        : 'Болно. Захиалгын тэмдэглэлд бичнэ үү.',
    },
    {
      q: 'Мастераа өөрөө сонгож болох уу?',
      a: '«Аль ч мастер» сонговол тухайн цагт сул, сонгосон бүх үйлчилгээг хийдэг мастерыг систем автоматаар сонгоно. Хүссэн мастераа сонговол зөвхөн түүний сул цаг харагдана.',
    },
    {
      q: 'Арьс, хумс мэдрэг бол яах вэ?',
      a: 'Захиалгын тэмдэглэлд бичээрэй — мастер гипоаллерген материал бэлдэнэ. Бид эмнэлгийн оношилгоо, эмчилгээ хийдэггүй.',
    },
    {
      q: 'Ямар төлбөрийн хэрэгсэл авдаг вэ?',
      a: 'Карт, бэлэн мөнгө, QPay. Онлайн урьдчилгааг QPay-ээр төлнө. Энэ демод төлбөр бодитоор хийгдэхгүй — туршилтын төлбөр ашиглана.',
    },
    {
      q: 'Чатбот надад цаг захиалж өгч чадах уу?',
      a: 'Чадна. Туслах үйлчилгээ, үнэ, сул цагийг салоны системээс шалгаж, захиалгын мэдээллээ хураангуйлан харуулна. Та «Баталгаажуулах» дарсны дараа л захиалга үүснэ.',
    },
  ]
  return (
    <section aria-labelledby="faq-title" className="bg-sand/60 py-20 lg:py-28">
      <div className="container-page grid gap-12 lg:grid-cols-[1fr_1.6fr]">
        <div className="self-start lg:sticky lg:top-28">
          <SectionHeading id="faq-title" eyebrow="Түгээмэл асуулт" title="Асуулт, хариулт" lead="Хариултгүй асуулт байвал баруун доод буланд байгаа туслахаас асуугаарай." />
        </div>
        <div className="divide-y divide-line-strong/60 border-y border-line-strong/60">
          {items.map((item) => (
            <details key={item.q} className="group py-5">
              <summary className="flex items-start justify-between gap-6 text-[1.02rem] font-medium text-cocoa-900">
                {item.q}
                <span className="mt-1 text-xl leading-none text-blush-500 transition-transform group-open:rotate-45" aria-hidden>
                  +
                </span>
              </summary>
              <p className="mt-3 max-w-2xl text-[0.95rem] leading-relaxed text-ink-2">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

function MapPlaceholder() {
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-xs border border-line bg-[#efe7dc]" role="img" aria-label="Зохиомол байршлын газрын зураг (демо)">
      <svg viewBox="0 0 400 300" className="absolute inset-0 size-full" aria-hidden>
        <rect width="400" height="300" fill="#efe7dc" />
        <path d="M0 210 L400 170" stroke="#fcfaf6" strokeWidth="18" />
        <path d="M120 0 L160 300" stroke="#fcfaf6" strokeWidth="14" />
        <path d="M0 90 L400 70" stroke="#fcfaf6" strokeWidth="9" />
        <path d="M300 0 L280 300" stroke="#fcfaf6" strokeWidth="9" />
        <rect x="175" y="95" width="80" height="55" fill="#e3d8ca" />
        <rect x="30" y="110" width="70" height="70" fill="#dfe6da" />
        <rect x="310" y="190" width="70" height="80" fill="#e3d8ca" />
        <circle cx="215" cy="120" r="36" fill="#d7ae9f" opacity="0.25" />
      </svg>
      <div className="absolute top-[33%] left-[54%] -translate-x-1/2 -translate-y-full">
        <div className="flex flex-col items-center">
          <span className="rounded-xs bg-cocoa-900 px-2.5 py-1 text-xs font-medium text-ivory shadow-soft">Сувд</span>
          <span className="h-3 w-px bg-cocoa-900" />
          <span className="size-2.5 rounded-full border-2 border-ivory bg-cocoa-900" />
        </div>
      </div>
      <p className="absolute right-3 bottom-3 rounded-xs bg-ivory/90 px-2 py-1 text-[0.7rem] text-ink-3">Газрын зураг — демо (байршил зохиомол)</p>
    </div>
  )
}

export function Location({ salon }: { salon: PublicSalon }) {
  return (
    <section id="contact" aria-labelledby="contact-title" className="container-page scroll-mt-24 py-20 lg:py-28">
      <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr]">
        <MapPlaceholder />
        <div>
          <p className="eyebrow">Байршил, холбоо барих</p>
          <h2 id="contact-title" className="display mt-3 text-[2.4rem] text-cocoa-900 sm:text-5xl">
            Биднийг олох
          </h2>
          <p className="mt-5 text-[1.02rem] text-ink-2">{salon.addressLine}</p>
          {salon.addressNote ? <p className="mt-1 text-sm text-ink-3">{salon.addressNote}</p> : null}
          <h3 className="mt-8 text-sm font-medium text-cocoa-900">Цагийн хуваарь</h3>
          <ul className="mt-3 space-y-2 text-sm">
            {hoursLines(salon.hours).map((l) => (
              <li key={l.days} className="flex max-w-sm justify-between gap-4 border-b border-line pb-2">
                <span className="text-ink-2">{l.days}</span>
                <span className="tabular text-ink">{l.text}</span>
              </li>
            ))}
          </ul>
          {salon.specialDays.length ? (
            <div className="mt-6 rounded-xs bg-blush-50 p-4">
              <h3 className="text-sm font-medium text-cocoa-900">Онцгой өдрүүд</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-ink-2">
                {salon.specialDays.slice(0, 4).map((d) => (
                  <li key={d.date}>
                    <span className="font-medium">{formatDateKey(d.date)}</span> —{' '}
                    {d.kind === 'closed' ? 'амарна' : `${minutesToTime(d.opensAt!)}–${minutesToTime(d.closesAt!)}`} · {d.label}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={phoneHref(salon.phone)} className="inline-flex h-11 items-center gap-2 rounded-xs border border-cocoa-800/60 px-4 text-sm text-cocoa-900 hover:bg-cocoa-900 hover:text-ivory">
              {formatPhone(salon.phone)}
            </a>
            <Link href="/book" className="inline-flex h-11 items-center gap-2 rounded-xs bg-cocoa-800 px-5 text-sm text-ivory hover:bg-cocoa-900">
              Цаг захиалах
            </Link>
          </div>
          <ul className="mt-6 space-y-1 text-sm text-ink-3">
            {salon.email ? <li>И-мэйл: {salon.email}</li> : null}
            {salon.instagram ? <li>Instagram: {salon.instagram}</li> : null}
            {salon.facebook ? <li>Facebook: {salon.facebook}</li> : null}
            <li className="flex items-center gap-1.5">
              <MessageCircle className="size-4" aria-hidden /> Чат туслах — баруун доод буланд
            </li>
          </ul>
        </div>
      </div>
    </section>
  )
}

export function DemoAdminCta() {
  return (
    <section aria-labelledby="demo-title" className="border-t border-line bg-porcelain">
      <div className="container-page grid gap-8 py-16 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div>
          <p className="eyebrow flex items-center gap-2">
            <Sparkles className="size-3.5" aria-hidden /> {PORTFOLIO.agency} · дотоод демо
          </p>
          <h2 id="demo-title" className="display mt-3 text-[2rem] text-cocoa-900 sm:text-[2.6rem]">
            Салоны эзэн бол — удирдлагын самбарыг үзээрэй
          </h2>
          <p className="mt-4 max-w-2xl text-[0.98rem] leading-relaxed text-ink-3">
            Энэ хуудсаар хийсэн захиалга таны хөтөч дээр хадгалагдаад зогсохгүй, салоны өгөгдлийн санд бичигдэж, самбарын хуанли,
            захиалгын жагсаалтад шууд харагдана. Самбар зохиомол өгөгдөлтэй, уншихад зориулагдсан: та зөвхөн өөрийн үүсгэсэн туршилтын
            захиалгыг баталгаажуулж, цуцалж чадна.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
          <ButtonLink href="/admin" size="lg">
            <LayoutDashboard className="size-4" aria-hidden />
            Админ самбар үзэх
          </ButtonLink>
          <a href={PORTFOLIO.portfolioUrl} className="inline-flex h-13 items-center justify-center gap-2 rounded-xs px-5 text-sm text-ink-2 hover:bg-sand">
            Портфолио <ArrowUpRight className="size-4" aria-hidden />
          </a>
        </div>
      </div>
    </section>
  )
}
