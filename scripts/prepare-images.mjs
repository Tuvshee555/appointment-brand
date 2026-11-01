#!/usr/bin/env node
// Downloads the licensed photographs used by the demo salon, applies one
// shared colour grade so photos from different photographers read as one
// brand, and writes optimised WebP masters to public/images/photos.
// It also writes src/lib/photo-manifest.ts (dimensions + credits) so
// next/image always receives correct width/height.
//
// All photos are from Unsplash (https://unsplash.com/license — free to use,
// no permission needed; we credit photographers on the /credits page anyway).
// Staff portraits are AI-generated images of fictional people (Canva) and
// are not processed here.
//
//   node scripts/prepare-images.mjs
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const OUT = path.join(process.cwd(), 'public', 'images', 'photos')
const CACHE = path.join(process.cwd(), '.cache', 'photos')
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(CACHE, { recursive: true })

/** name, Unsplash photo page id, image id, photographer, max width, alt text (Mongolian) */
const PHOTOS = [
  [
    'hands-fur',
    'SyCC0GQi5S4',
    '1610992015732-2449b76344bc',
    'Chelson Tamares',
    2400,
    'Нүцгэн өнгийн гель будалттай гар, зөөлөн цагаан даавуун дээр',
  ],
  [
    'nude-ring',
    'DtoWpHt2_d8',
    '1630843599725-32ead7671867',
    'Ellie Eshaghi',
    1600,
    'Сүүн нүцгэн өнгийн маникюр, нарийн алтан бөгж',
  ],
  [
    'french-daisy',
    '3AQ_VHXfjEg',
    '1762373349045-c2decd4ec3f3',
    'Anna Meshkov',
    1600,
    'Франц маникюртай гар жижиг цэцэг барьж байна',
  ],
  [
    'nude-soft',
    'vtQHwU4F13s',
    '1610992015762-45dca7fa3a85',
    'Chelson Tamares',
    1600,
    'Цайвар ягаавтар өнгийн богино маникюр',
  ],
  [
    'sheer-almond',
    'hvqHtZqNMeI',
    '1612887390768-fb02affea7a6',
    'Jodene Isakowitz',
    1600,
    'Бүйлс хэлбэрийн тунгалаг ягаавтар хумс',
  ],
  [
    'pearl-art',
    'mciNDxIq4J0',
    '1769687209448-025548dfca8b',
    'Julia Schuwer',
    1600,
    'Сувдан чимэглэлтэй сүүн өнгийн хумсны дизайн',
  ],
  [
    'mauve-glitter',
    'Y14F-1vzVds',
    '1607779097040-26e80aa78e66',
    'Patrícia Hellinger',
    1600,
    'Ягаан саарал, цагаан, мөнгөлөг гялтгар хумсны дизайн',
  ],
  [
    'tortoiseshell',
    'tXwBDZS2JxQ',
    '1604654894610-df63bc536371',
    'Bryony Elena',
    1600,
    'Хар болон яст мэлхийн хээтэй хумсны дизайн',
  ],
  [
    'gold-chrome',
    'xIpKfkVR334',
    '1770210257340-dc2b0f44642a',
    'Caroline Badran',
    1600,
    'Алтлаг хром өнгийн бүйлс хэлбэрийн хумс',
  ],
  [
    'taupe-chrome',
    'OIEU0eopPT4',
    '1736434518489-0eb84070017f',
    'Caroline Badran',
    1600,
    'Бор саарал хром өнгийн урт хумс, цэцгийн дэвсгэртэй',
  ],
  [
    'lilac-extensions',
    'GV9_jUGReBo',
    '1633955726992-2b7c0d2d2a69',
    'Alazar Kassahun',
    1600,
    'Цагаан, гялтгар хослуулсан сунгасан хумс',
  ],
  [
    'at-work',
    'gb6gtiTZKB8',
    '1632345031435-8727f6897d53',
    'Giorgio Trovato',
    1800,
    'Мастер маникюр хийж байна, хумсны кутикул арчилгаа',
  ],
  [
    'polish-wall',
    'OpjlRo-31SI',
    '1619607146034-5a05296c8f9a',
    'H&CO',
    1800,
    'Хананы тавиур дээрх гель будгийн өнгөнүүд',
  ],
  [
    'polish-editorial',
    'STW4T8mL9eE',
    '1759526997116-c8f4f2431869',
    'Maria Lupan',
    1600,
    'Чулуун дээр урсаж буй гурван өнгийн хумсны будаг',
  ],
  [
    'treatment-room',
    'JnsuyfJrxQw',
    '1787651343620-8d5303006ecb',
    'Mayur Roxan',
    1800,
    'Цонхны гэрэлтэй тайван арчилгааны өрөө',
  ],
  [
    'pedicure-spa',
    'qeuJczNo54w',
    '1519415510236-718bdfcd89c8',
    'Rune Enstad',
    1600,
    'Цэцэгтэй бүлээн усанд хөлийн арчилгаа',
  ],
  [
    'pedicure-chair',
    'op6jCTFHnuA',
    '1787651344170-c2f81514934d',
    'Mayur Roxan',
    1600,
    'Педикюрын сандал, хөлийн ванн бүхий өрөө',
  ],
  [
    'abstract-art',
    'jRXxNpA6d_k',
    '1571290274554-6a2eaa771e5f',
    'Budka Damdinsuren',
    1600,
    'Олон өнгийн хийсвэр хээтэй захиалгат хумсны дизайн',
  ],
]

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) appointment-brand image preparation'

async function download(imageId, width) {
  const file = path.join(CACHE, `${imageId}-${width}.jpg`)
  if (fs.existsSync(file)) return fs.readFileSync(file)
  const res = await fetch(`https://images.unsplash.com/photo-${imageId}?w=${width}&q=90&fm=jpg&fit=max`, {
    headers: { 'User-Agent': UA },
  })
  if (!res.ok) throw new Error(`download ${imageId}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(file, buf)
  return buf
}

const manifest = {}
for (const [name, pageId, imageId, photographer, width, alt] of PHOTOS) {
  const source = await download(imageId, width)
  // Brand grade: a little less saturation and a faint warm cast (red up, blue down).
  const out = await sharp(source)
    .rotate()
    .modulate({ saturation: 0.88 })
    .recomb([
      [1.03, 0, 0],
      [0, 1.0, 0],
      [0, 0, 0.95],
    ])
    .webp({ quality: 80, effort: 5 })
    .toBuffer({ resolveWithObject: true })
  fs.writeFileSync(path.join(OUT, `${name}.webp`), out.data)
  manifest[name] = {
    src: `/images/photos/${name}.webp`,
    width: out.info.width,
    height: out.info.height,
    alt,
    credit: { photographer, url: `https://unsplash.com/photos/${pageId}` },
  }
  console.log(`${name}: ${out.info.width}x${out.info.height} ${(out.data.length / 1024).toFixed(0)} KB`)
}

const ts = `// Generated by scripts/prepare-images.mjs — do not edit by hand.
// Licensed photographs (Unsplash License) with their real pixel sizes.
export const PHOTOS = ${JSON.stringify(manifest, null, 2)} as const

export type PhotoName = keyof typeof PHOTOS
`
fs.writeFileSync(path.join(process.cwd(), 'src', 'lib', 'photo-manifest.ts'), ts)
console.log(`Wrote ${Object.keys(manifest).length} photos and src/lib/photo-manifest.ts`)
