// Sample verified answers for the fictional demo salon's assistant (Admin → AI туслах → Мэдлэг).
// Business facts that live in the settings (hours, address, policies) are read from there, not
// repeated here; answers never contain prices (those come from the catalogue).
import { eq } from 'drizzle-orm'
import type { Database } from '@/server/db/client'
import * as t from '@/server/db/schema'

export const KNOWLEDGE_SEED: { topic: string; question: string; answer: string; keywords: string }[] = [
  {
    topic: 'preparation',
    question: 'Үйлчилгээнд ирэхийн өмнө юу хийх вэ?',
    answer:
      'Хумсаа урьдчилж будах, тос түрхэх шаардлагагүй. Хуучин гель эсвэл сунгалттай бол захиалахдаа «Гель авалт» эсвэл «Сунгалт авалт»-ыг нэмээрэй. Цагаасаа 5 минутын өмнө ирвэл тохиромжтой.',
    keywords: 'өмнө, бэлтгэл, бэлдэх, prepare, before',
  },
  {
    topic: 'aftercare',
    question: 'Гель будалт, сунгалтаа хэрхэн арчлах вэ?',
    answer:
      'Эхний 24 цагт халуун ус, саунаас аль болох зайлсхийгээрэй. Гэрийн ажил хийхдээ бээлий өмсөөрэй. Ховхорвол өөрөө хуулалгүй салонд ирж засуулаарай.',
    keywords: 'арчлах, арчилгаа, тогтох, ховхор, aftercare',
  },
  {
    topic: 'payment',
    question: 'Ямар хэлбэрээр төлж болох вэ?',
    answer: 'Салонд карт, бэлэн мөнгө, QPay-ээр төлнө. Онлайн захиалгын урьдчилгааг QPay-ээр төлнө.',
    keywords: 'карт, бэлэн, qpay, төлбөр, данс',
  },
  {
    topic: 'parking',
    question: 'Зогсоол байгаа юу?',
    answer: 'Барилгын урд талд үйлчлүүлэгчийн зогсоол бий. (Зохиомол демо салоны мэдээлэл.)',
    keywords: 'зогсоол, машин, parking',
  },
  {
    topic: 'general',
    question: 'Захиалгагүй шууд ирж болох уу?',
    answer:
      'Сул цаг байвал шууд ирсэн үйлчлүүлэгчид үйлчилнэ, гэхдээ урьдчилж захиалбал найдвартай. Сул цагийг энд шалгаж, шууд захиалж болно.',
    keywords: 'шууд ирэх, захиалгагүй, walk-in',
  },
  {
    topic: 'policy',
    question: 'Хоцорвол яах вэ?',
    answer: '15 минутаас дээш хоцорвол үйлчилгээг богиносгох эсвэл өөр цаг санал болгож болно. Хоцрохоор бол салон руу урьдчилж мэдэгдээрэй.',
    keywords: 'хоцрох, хоцорвол, late',
  },
]

/** Adds the sample answers once (only when the salon has no knowledge yet). */
export async function seedKnowledge(db: Database, salonId: string, now: Date): Promise<number> {
  const existing = await db.$count(t.assistantKnowledge, eq(t.assistantKnowledge.salonId, salonId))
  if (existing) return 0
  await db.insert(t.assistantKnowledge).values(
    KNOWLEDGE_SEED.map((k, i) => ({ salonId, ...k, isActive: true, verifiedAt: now, sortOrder: i, createdAt: now, updatedAt: now })),
  )
  return KNOWLEDGE_SEED.length
}
