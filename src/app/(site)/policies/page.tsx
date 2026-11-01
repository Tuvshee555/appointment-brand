import type { Metadata } from 'next'
import { PORTFOLIO } from '@/lib/brand'
import { formatMoney } from '@/lib/money'
import { getPublicSalon } from '@/server/queries/public'

export const metadata: Metadata = {
  title: 'Нөхцөл, бодлого',
  description: 'Захиалга, цуцлалт, урьдчилгаа, хувийн мэдээллийн бодлого.',
}

export default async function PoliciesPage() {
  const salon = await getPublicSalon()
  const r = salon.rules
  const sections = [
    {
      title: 'Цаг захиалга',
      body: [
        `Онлайнаар цаг эхлэхээс дор хаяж ${r.minAdvanceMinutes / 60} цагийн өмнө, ${r.maxAdvanceDays} хоногийн дотор захиална.`,
        r.confirmationMode === 'manual'
          ? 'Урьдчилгаагүй захиалга эхлээд «хүсэлт» төлөвтэй бүртгэгдэж, салон баталгаажуулах хүртэл цаг таны нэр дээр хадгалагдана.'
          : 'Урьдчилгаагүй захиалга шууд баталгаажна.',
        'Сул цаг мастер бүрийн ажлын хуваарь, завсарлага, чөлөө, одоо байгаа захиалга, захиалга хоорондын бэлтгэлийн хугацааг тооцож гардаг. Нэг мастерт нэг цагт хоёр захиалга орохгүй.',
      ],
    },
    {
      title: 'Урьдчилгаа',
      body: [
        salon.depositPolicy || 'Урьдчилгаа авдаггүй.',
        r.depositMode !== 'none'
          ? `Урьдчилгаа төлөгдөхийг ${r.holdMinutes} минут хүлээнэ; төлөгдөөгүй бол цаг чөлөөлөгдөнө. Төлбөр зөвхөн төлбөрийн систем баталгаажуулсны дараа «төлөгдсөн» болно.`
          : '',
        r.depositMode === 'fixed'
          ? `Одоогийн дүн: ${formatMoney(r.depositFixedAmount)} (${formatMoney(r.depositMinTotal)}-өөс дээш захиалгад).`
          : '',
      ].filter(Boolean),
    },
    {
      title: 'Цуцлалт, цаг өөрчлөх',
      body: [
        salon.cancellationPolicy,
        `Онлайнаар цаг өөрчлөх боломж цаг эхлэхээс ${r.rescheduleNoticeHours} цагийн өмнө хаагдана.`,
      ],
    },
    {
      title: 'Хувийн мэдээлэл',
      body: [
        'Захиалгад зөвхөн нэр, утас, (сонгосон бол) и-мэйл, таны бичсэн тэмдэглэлийг ашиглана. Мэдээллийг зөвхөн салоны ажилтан харна.',
        'IP хаягийг хадгалдаггүй — хүсэлтийн хязгаарт зөвхөн нэг талын хэш ашиглана.',
        'Энэ демо сайт дээр бодит хувийн мэдээлэл бүү оруулна уу. Демо өгөгдөл өдөр бүр шинэчлэгддэг.',
      ],
    },
    {
      title: 'Демо',
      body: [PORTFOLIO.note, 'QPay төлбөр симуляц горимд ажиллана — мөнгө шилжихгүй. SMS, мессеж гадагш илгээгдэхгүй.'],
    },
  ]
  return (
    <div className="container-page max-w-3xl pt-12 pb-24 lg:pt-16">
      <p className="eyebrow">Нөхцөл</p>
      <h1 className="display mt-3 text-5xl text-cocoa-900">Нөхцөл, бодлого</h1>
      <div className="mt-10 space-y-10">
        {sections.map((s) => (
          <section key={s.title}>
            <h2 className="font-display text-2xl text-cocoa-900">{s.title}</h2>
            <div className="mt-3 space-y-3 text-[0.98rem] leading-relaxed text-ink-2">
              {s.body.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
