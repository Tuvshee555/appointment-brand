// Launch catalogue for the fictional salon. Read once by the seed; afterwards
// the owner edits everything in /admin. Prices are fictional demonstration
// prices in tögrög, not verified market averages.
import type { PhotoName } from '@/lib/photo-manifest'

export const SKILLS = [
  { key: 'manicure', name: 'Маникюр', description: 'Хэлбэр засалт, кутикул арчилгаа, будалт' },
  { key: 'gel', name: 'Гель будалт', description: 'Гель бэлтгэл, будалт, гэрэлд хатаалт' },
  { key: 'extensions', name: 'Хумс сунгалт', description: 'Типс, форм, гель сунгалт, нөхөлт' },
  { key: 'acrylic', name: 'Акрил', description: 'Акрил нунтагаар сунгалт' },
  { key: 'design', name: 'Гар зураг', description: 'Франц, энгийн зураг, чимэглэл' },
  { key: 'design_senior', name: 'Нарийн дизайн', description: 'Хром, 3D, захиалгат бүтэн дизайн' },
  { key: 'pedicure', name: 'Педикюр', description: 'Хөлийн арчилгаа, гель педикюр' },
  { key: 'care', name: 'Арчилгаа', description: 'Парафин, массаж, хумсны арчилгаа' },
] as const

export type SkillKey = (typeof SKILLS)[number]['key']

export const CATEGORIES = [
  {
    slug: 'manicure',
    name: 'Маникюр',
    description: 'Хумсны хэлбэр засалт, кутикул арчилгаа, сонгодог ба гель будалт.',
    image: 'sheer-almond',
  },
  {
    slug: 'extensions',
    name: 'Хумс сунгалт, засвар',
    description: 'Типс, гель, акрил сунгалт, нөхөлт, хугарсан хумсны засвар.',
    image: 'lilac-extensions',
  },
  {
    slug: 'design',
    name: 'Хумсны дизайн',
    description: 'Франц, гар зураг, сувдан чимэглэл, таны санаагаар хийх захиалгат дизайн.',
    image: 'pearl-art',
  },
  {
    slug: 'pedicure',
    name: 'Педикюр',
    description: 'Хөлийн ванн, өсгийн арчилгаа, гель будалттай педикюр.',
    image: 'pedicure-spa',
  },
  {
    slug: 'care',
    name: 'Нэмэлт үйлчилгээ',
    description: 'Гель авалт, сунгалт авалт, гарын болон хумсны арчилгаа.',
    image: 'treatment-room',
  },
] as const satisfies readonly { slug: string; name: string; description: string; image: PhotoName }[]

export type CategorySlug = (typeof CATEGORIES)[number]['slug']

export const ADDONS = [
  {
    slug: 'gel-removal-addon',
    name: 'Хуучин гель авах',
    description: 'Өмнөх гель будалтыг хумс гэмтээлгүй авна.',
    price: 10_000,
    priceType: 'fixed',
    durationMinutes: 15,
  },
  {
    slug: 'french-tip',
    name: 'Франц үзүүр',
    description: 'Сонгодог цагаан эсвэл өнгөт нарийн үзүүр.',
    price: 15_000,
    priceType: 'fixed',
    durationMinutes: 15,
  },
  {
    slug: 'simple-art-addon',
    name: 'Энгийн зураг (2–4 хумс)',
    description: 'Цэг, зураас, жижиг хээ — 2–4 хумсанд.',
    price: 15_000,
    priceType: 'from',
    durationMinutes: 20,
  },
  {
    slug: 'premium-art-addon',
    name: 'Нарийн зураг, хром',
    description: 'Хром, мөнгөлөг, нарийн гар зураг — бүх хумсанд.',
    price: 35_000,
    priceType: 'from',
    durationMinutes: 40,
  },
  {
    slug: 'repair-addon',
    name: 'Хумс засвар (1 хумс)',
    description: 'Хугарсан, цуурсан нэг хумсыг сэргээнэ.',
    price: 10_000,
    priceType: 'fixed',
    durationMinutes: 10,
  },
  {
    slug: 'paraffin-addon',
    name: 'Парафин маск',
    description: 'Гар эсвэл хөлийн арьсыг гүн чийгшүүлэх парафин.',
    price: 15_000,
    priceType: 'fixed',
    durationMinutes: 15,
  },
  {
    slug: 'pearl-decor',
    name: 'Сувдан чимэглэл',
    description: 'Сувд, жижиг кристаллаар 10 хумс хүртэл чимэглэнэ.',
    price: 12_000,
    priceType: 'from',
    durationMinutes: 15,
  },
] as const

export type AddonSlug = (typeof ADDONS)[number]['slug']

export interface ServiceSeed {
  slug: string
  category: CategorySlug
  name: string
  shortDescription: string
  description: string
  durationMinutes: number
  price: number
  priceType: 'fixed' | 'from'
  bufferMinutes?: number
  image: PhotoName
  skills: SkillKey[]
  addons: AddonSlug[]
  featured?: boolean
}

export const SERVICES: ServiceSeed[] = [
  // ---- Маникюр
  {
    slug: 'basic-manicure',
    category: 'manicure',
    name: 'Энгийн маникюр',
    shortDescription: 'Хэлбэр засалт, кутикул арчилгаа, тосолгоо. Будалтгүй.',
    description:
      'Хумсны урт, хэлбэрийг засаж, кутикулыг зөөлөн арчилна. Төгсгөлд нь витаминт тосоор тосолж, байгалийн цэвэрхэн харагдац үлдээнэ. Будалт ороогүй.',
    durationMinutes: 45,
    price: 35_000,
    priceType: 'fixed',
    image: 'nude-ring',
    skills: ['manicure'],
    addons: ['paraffin-addon', 'repair-addon'],
  },
  {
    slug: 'classic-manicure',
    category: 'manicure',
    name: 'Сонгодог маникюр',
    shortDescription: 'Гарын ванн, кутикул арчилгаа, энгийн лак будалт.',
    description:
      'Бүлээн ванн, кутикул арчилгаа, хэлбэр засалтын дараа энгийн лакаар будна. Лак 5–7 хоног тогтоно. Богино хугацаанд цэвэрхэн харагдах хүсэлтэй хүнд тохиромжтой.',
    durationMinutes: 60,
    price: 45_000,
    priceType: 'fixed',
    image: 'nude-soft',
    skills: ['manicure'],
    addons: ['paraffin-addon', 'french-tip'],
  },
  {
    slug: 'mens-manicure',
    category: 'manicure',
    name: 'Эрэгтэй маникюр',
    shortDescription: 'Богино цэвэрхэн хэлбэр, кутикул, гарын тос. Будалтгүй.',
    description:
      'Хумсыг богино, жигд хэлбэрт оруулж, кутикул болон хатуурсан арьсыг арчилна. Гялалзуулахгүй, байгалийн матт төгсгөлтэй.',
    durationMinutes: 45,
    price: 40_000,
    priceType: 'fixed',
    image: 'at-work',
    skills: ['manicure'],
    addons: ['paraffin-addon'],
  },
  {
    slug: 'gel-polish',
    category: 'manicure',
    name: 'Гель будалт',
    shortDescription: 'Маникюр + 3 долоо хоног гялалзаж тогтох гель будалт.',
    description:
      'Хумс бэлтгэл, маникюрын дараа гель будгаар 2 давхар будаж, гэрэлд хатаана. 200 гаруй өнгөнөөс сонгоно. Зөв арчилбал 3 долоо хоног гялалзсан хэвээр тогтоно.',
    durationMinutes: 90,
    price: 65_000,
    priceType: 'fixed',
    image: 'sheer-almond',
    skills: ['manicure', 'gel'],
    addons: ['gel-removal-addon', 'french-tip', 'simple-art-addon', 'premium-art-addon', 'pearl-decor', 'repair-addon'],
    featured: true,
  },
  {
    slug: 'gel-polish-renewal',
    category: 'manicure',
    name: 'Гель авч, шинээр будах',
    shortDescription: 'Хуучин гелийг авч, маникюр хийгээд шинээр гель будна.',
    description:
      'Өмнөх гель будалтыг зөөлөн авч, хумсны гадаргууг сэргээн маникюр хийнэ. Дараа нь шинэ өнгөөр гель будна. Хуучин гель авалт үнэд багтсан.',
    durationMinutes: 105,
    price: 75_000,
    priceType: 'fixed',
    image: 'hands-fur',
    skills: ['manicure', 'gel'],
    addons: ['french-tip', 'simple-art-addon', 'pearl-decor'],
  },
  {
    slug: 'french-manicure',
    category: 'manicure',
    name: 'Франц маникюр',
    shortDescription: 'Байгалийн суурь өнгө, нарийн цагаан үзүүр, гель будалтаар.',
    description:
      'Байгалийн ягаавтар эсвэл сүүн суурь өнгө дээр нарийн жигд франц үзүүр гаргана. Гель будалтаар хийдэг тул 3 долоо хоног тогтоно.',
    durationMinutes: 100,
    price: 75_000,
    priceType: 'fixed',
    image: 'french-daisy',
    skills: ['manicure', 'gel', 'design'],
    addons: ['gel-removal-addon', 'pearl-decor'],
    featured: true,
  },
  {
    slug: 'nail-strengthening',
    category: 'manicure',
    name: 'Хумс бэхжүүлэлт',
    shortDescription: 'Сул, хугардаг хумсанд биогель бэхжүүлэлт, байгалийн уртаар.',
    description:
      'Нимгэн, амархан хугардаг хумсыг биогель давхаргаар бэхжүүлж, байгалийн уртаар нь хадгална. Дээрээс нь нүцгэн эсвэл сонгосон өнгөөр будна.',
    durationMinutes: 90,
    price: 85_000,
    priceType: 'fixed',
    image: 'nude-soft',
    skills: ['manicure', 'gel'],
    addons: ['gel-removal-addon', 'french-tip'],
  },
  // ---- Хумс сунгалт, засвар
  {
    slug: 'nail-extensions',
    category: 'extensions',
    name: 'Хумс сунгалт (типс)',
    shortDescription: 'Типсээр хүссэн урт, хэлбэрт сунгаж, нэг өнгөөр будна.',
    description:
      'Типс ашиглан бүйлс, дөрвөлжин, зууван зэрэг хэлбэрээр сунгаж, гель будалтаар нэг өнгөөр будна. Анх удаа сунгуулж буй бол мастер таны гарт тохирох уртыг зөвлөнө.',
    durationMinutes: 150,
    price: 120_000,
    priceType: 'fixed',
    bufferMinutes: 15,
    image: 'lilac-extensions',
    skills: ['extensions'],
    addons: ['gel-removal-addon', 'french-tip', 'simple-art-addon', 'premium-art-addon', 'pearl-decor'],
  },
  {
    slug: 'gel-extensions',
    category: 'extensions',
    name: 'Гель сунгалт',
    shortDescription: 'Форм дээр гель сунгалт — хөнгөн, байгалийн, бат бөх.',
    description:
      'Доод форм дээр гелээр барьж сунгадаг тул хумс хөнгөн, байгалийн харагдацтай, бат бөх болно. Нөхөлтийг 3–4 долоо хоног тутам хийхийг зөвлөнө.',
    durationMinutes: 165,
    price: 140_000,
    priceType: 'fixed',
    bufferMinutes: 15,
    image: 'taupe-chrome',
    skills: ['extensions', 'gel'],
    addons: ['gel-removal-addon', 'french-tip', 'simple-art-addon', 'premium-art-addon', 'pearl-decor'],
    featured: true,
  },
  {
    slug: 'acrylic-extensions',
    category: 'extensions',
    name: 'Акрил сунгалт',
    shortDescription: 'Акрил нунтагаар бат бөх сунгалт, урт хэлбэрт тохиромжтой.',
    description:
      'Акрил нунтаг, шингэнээр урт, бат бөх хумс бүтээнэ. Урт хэлбэр, идэвхтэй хэрэглээнд тэсвэртэй. Гель будалт үнэд багтсан.',
    durationMinutes: 170,
    price: 150_000,
    priceType: 'fixed',
    bufferMinutes: 15,
    image: 'gold-chrome',
    skills: ['extensions', 'acrylic'],
    addons: ['french-tip', 'premium-art-addon', 'pearl-decor'],
  },
  {
    slug: 'nail-refill',
    category: 'extensions',
    name: 'Сунгалтын нөхөлт',
    shortDescription: 'Ургасан хэсгийг нөхөж, хэлбэр, өнгийг шинэчилнэ.',
    description:
      'Сунгалт хийснээс 3–4 долоо хоногийн дараа ургасан хэсгийг нөхөж, хэлбэрийг засаад, өнгийг шинэчилнэ. Өөр газар хийсэн сунгалтыг мастер үзээд нөхөх эсэхийг зөвлөнө.',
    durationMinutes: 120,
    price: 90_000,
    priceType: 'fixed',
    bufferMinutes: 15,
    image: 'polish-wall',
    skills: ['extensions'],
    addons: ['french-tip', 'simple-art-addon', 'premium-art-addon', 'repair-addon', 'pearl-decor'],
    featured: true,
  },
  {
    slug: 'nail-repair',
    category: 'extensions',
    name: 'Хумс засвар',
    shortDescription: 'Хугарсан эсвэл цуурсан хумсыг сэргээнэ (1–2 хумс).',
    description:
      'Хугарсан, цуурсан сунгалт эсвэл байгалийн хумсыг сэргээж, бусад хумстай нь ижил хэлбэр, өнгөнд оруулна.',
    durationMinutes: 30,
    price: 15_000,
    priceType: 'from',
    image: 'at-work',
    skills: ['extensions'],
    addons: [],
  },
  // ---- Хумсны дизайн
  {
    slug: 'simple-nail-art',
    category: 'design',
    name: 'Энгийн гар зураг',
    shortDescription: '2–4 хумсанд цэг, зураас, жижиг хээ.',
    description:
      'Гель будалт эсвэл сунгалтын дээр 2–4 хумсанд энгийн хээ, цэг, зураас зурна. Ихэвчлэн өөр үйлчилгээтэй хамт захиалдаг.',
    durationMinutes: 20,
    price: 15_000,
    priceType: 'from',
    image: 'mauve-glitter',
    skills: ['design'],
    addons: ['pearl-decor'],
  },
  {
    slug: 'premium-nail-art',
    category: 'design',
    name: 'Премиум гар зураг',
    shortDescription: 'Бүх хумсанд нарийн зураг, хром, мөнгөлөг, 3D элемент.',
    description:
      'Бүх хумсанд нарийн гар зураг, хром нунтаг, мөнгөлөг шугам, 3D гель элемент хослуулна. Эцсийн үнэ дизайны нарийн түвшнээс хамаарч салонд тохирно.',
    durationMinutes: 45,
    price: 35_000,
    priceType: 'from',
    image: 'tortoiseshell',
    skills: ['design', 'design_senior'],
    addons: ['pearl-decor'],
    featured: true,
  },
  {
    slug: 'french-design',
    category: 'design',
    name: 'Франц дизайн',
    shortDescription: 'Сонгодог, өнгөт эсвэл микро франц үзүүр.',
    description:
      'Гель будалт эсвэл сунгалтын дээр сонгодог цагаан, өнгөт, микро франц эсвэл давхар шугамтай франц хийнэ.',
    durationMinutes: 25,
    price: 20_000,
    priceType: 'fixed',
    image: 'french-daisy',
    skills: ['design'],
    addons: [],
  },
  {
    slug: 'custom-design',
    category: 'design',
    name: 'Захиалгат дизайн',
    shortDescription: 'Таны зураг, санаагаар бүх хумсанд бүтээх дизайн.',
    description:
      'Таны авчирсан зураг эсвэл санаагаар бүх хумсанд захиалгат дизайн бүтээнэ. Захиалгын тэмдэглэлд санаагаа бичвэл мастер урьдчилан бэлтгэнэ.',
    durationMinutes: 60,
    price: 50_000,
    priceType: 'from',
    image: 'abstract-art',
    skills: ['design', 'design_senior'],
    addons: ['pearl-decor'],
  },
  {
    slug: 'decorative-design',
    category: 'design',
    name: 'Сувд, чулуун чимэглэл',
    shortDescription: 'Сувд, кристалл, металл чимэглэл — 10 хумс хүртэл.',
    description:
      'Жижиг сувд, кристалл, алтлаг металл элементээр хумсыг чимэглэнэ. Арчилгаа, хадгалалтын зөвлөгөө өгнө.',
    durationMinutes: 30,
    price: 25_000,
    priceType: 'from',
    image: 'pearl-art',
    skills: ['design'],
    addons: [],
  },
  // ---- Педикюр
  {
    slug: 'basic-pedicure',
    category: 'pedicure',
    name: 'Энгийн педикюр',
    shortDescription: 'Хөлийн ванн, хумс засалт, өсгий зөөлрүүлэх, тосолгоо.',
    description:
      'Бүлээн хөлийн ванн, хумсны хэлбэр засалт, кутикул арчилгаа, өсгийн хатуурсан арьсыг зөөлрүүлж, тосолгоо хийнэ. Будалтгүй.',
    durationMinutes: 60,
    price: 65_000,
    priceType: 'fixed',
    bufferMinutes: 15,
    image: 'pedicure-spa',
    skills: ['pedicure'],
    addons: ['paraffin-addon'],
  },
  {
    slug: 'gel-pedicure',
    category: 'pedicure',
    name: 'Гель педикюр',
    shortDescription: 'Педикюр + 3–4 долоо хоног тогтох гель будалт.',
    description:
      'Бүрэн педикюрын дараа хөлийн хумсыг гель будгаар будна. Гель будалт хөлийн хумсанд 4 долоо хоног хүртэл тогтоно.',
    durationMinutes: 90,
    price: 95_000,
    priceType: 'fixed',
    bufferMinutes: 15,
    image: 'pedicure-chair',
    skills: ['pedicure', 'gel'],
    addons: ['gel-removal-addon', 'french-tip', 'paraffin-addon'],
    featured: true,
  },
  {
    slug: 'premium-pedicure',
    category: 'pedicure',
    name: 'Премиум педикюр',
    shortDescription: 'Аппарат педикюр, гүн арчилгаа, парафин, массаж, гель будалт.',
    description:
      'Аппарат педикюраар өсгий, хурууны арьсыг гүн арчилж, парафин маск, хөлийн массаж хийгээд гель будалтаар төгсгөнө. Удаан сунжирсан арчилгааг тайван орчинд мэдрэх хүнд.',
    durationMinutes: 110,
    price: 125_000,
    priceType: 'fixed',
    bufferMinutes: 15,
    image: 'treatment-room',
    skills: ['pedicure', 'care'],
    addons: ['french-tip'],
  },
  // ---- Нэмэлт үйлчилгээ
  {
    slug: 'gel-removal',
    category: 'care',
    name: 'Гель авалт',
    shortDescription: 'Гель будалтыг хумс гэмтээлгүй авч, тосолно.',
    description:
      'Гель будалтыг хумсны гадаргууг гэмтээлгүй авч, хэлбэрийг засаад тосоор тосолно. Шинээр будахгүй үед сонгоно.',
    durationMinutes: 20,
    price: 15_000,
    priceType: 'fixed',
    image: 'polish-editorial',
    skills: ['manicure'],
    addons: [],
  },
  {
    slug: 'extension-removal',
    category: 'care',
    name: 'Сунгалт авалт',
    shortDescription: 'Сунгалтыг аюулгүй авч, байгалийн хумсыг сэргээнэ.',
    description: 'Гель эсвэл акрил сунгалтыг байгалийн хумс гэмтээлгүй авч, тэгшилж, бэхжүүлэх тос түрхэнэ.',
    durationMinutes: 40,
    price: 25_000,
    priceType: 'fixed',
    image: 'at-work',
    skills: ['extensions'],
    addons: [],
  },
  {
    slug: 'hand-care',
    category: 'care',
    name: 'Гарын парафин арчилгаа',
    shortDescription: 'Скраб, парафин маск, чийгшүүлэх массаж.',
    description: 'Гарын арьсыг скрабаар цэвэрлэж, бүлээн парафин маскаар гүн чийгшүүлээд, зөөлөн массажаар төгсгөнө.',
    durationMinutes: 30,
    price: 30_000,
    priceType: 'fixed',
    image: 'hands-fur',
    skills: ['care'],
    addons: [],
  },
  {
    slug: 'nail-care',
    category: 'care',
    name: 'Хумсны арчилгаа',
    shortDescription: 'Хуурай кутикул, сул хумсанд витаминт тос, бэхжүүлэгч.',
    description:
      'Хуурай кутикул, хуйхлах хумсанд витаминт тос, бэхжүүлэгч түрхэж, гэртээ хэрхэн арчлах зөвлөгөө өгнө. Эмнэлгийн эмчилгээ биш.',
    durationMinutes: 30,
    price: 25_000,
    priceType: 'fixed',
    image: 'nude-ring',
    skills: ['care'],
    addons: [],
  },
]

export interface StaffSeed {
  slug: string
  name: string
  displayName: string
  title: string
  bio: string
  experienceYears: number
  experienceText: string
  specialties: string[]
  photo: string
  cover: PhotoName
  color: string
  skills: { key: SkillKey; level: 'standard' | 'senior' }[]
  services: string[]
  /** weekday -> [start, end] in minutes; missing weekday = day off. */
  schedule: Partial<Record<1 | 2 | 3 | 4 | 5 | 6 | 7, [number, number]>>
  breaks: { weekday: number | null; startsAt: number; endsAt: number; label: string }[]
}

const h = (hours: number, minutes = 0) => hours * 60 + minutes

export const STAFF: StaffSeed[] = [
  {
    slug: 'solongo',
    name: 'Б. Солонго',
    displayName: 'Солонго',
    title: 'Ахлах мастер, үүсгэн байгуулагч',
    bio: 'Хумсны салбарт 11 жил ажиллаж, гель сунгалт, нарийн гар зургаар мэргэшсэн. Сувдын мастеруудыг сургаж, ажлын стандартыг хариуцдаг.',
    experienceYears: 11,
    experienceText: '11 жилийн туршлага · олон улсын гель сунгалтын сертификаттай (зохиомол)',
    specialties: ['Гель сунгалт', 'Нарийн гар зураг', 'Франц'],
    photo: 'solongo',
    cover: 'taupe-chrome',
    color: '#7a5240',
    skills: [
      { key: 'manicure', level: 'senior' },
      { key: 'gel', level: 'senior' },
      { key: 'extensions', level: 'senior' },
      { key: 'acrylic', level: 'senior' },
      { key: 'design', level: 'senior' },
      { key: 'design_senior', level: 'senior' },
    ],
    services: [
      'classic-manicure',
      'gel-polish',
      'gel-polish-renewal',
      'french-manicure',
      'nail-strengthening',
      'nail-extensions',
      'gel-extensions',
      'acrylic-extensions',
      'nail-refill',
      'nail-repair',
      'simple-nail-art',
      'premium-nail-art',
      'french-design',
      'custom-design',
      'decorative-design',
      'gel-removal',
      'extension-removal',
    ],
    schedule: { 2: [h(10), h(18)], 3: [h(10), h(18)], 4: [h(10), h(18)], 5: [h(10), h(18)], 6: [h(10), h(18)] },
    breaks: [{ weekday: null, startsAt: h(13), endsAt: h(13, 30), label: 'Үдийн завсарлага' }],
  },
  {
    slug: 'nomin',
    name: 'Э. Номин',
    displayName: 'Номин',
    title: 'Маникюр, гель будалтын мастер',
    bio: 'Цэвэрхэн, нямбай гель будалт, франц маникюраараа үйлчлүүлэгчдийн дунд нэртэй. Хумс бэхжүүлэлт, гарын арчилгааг бас хийдэг.',
    experienceYears: 6,
    experienceText: '6 жилийн туршлага',
    specialties: ['Гель будалт', 'Франц маникюр', 'Хумс бэхжүүлэлт'],
    photo: 'nomin',
    cover: 'sheer-almond',
    color: '#a2786a',
    skills: [
      { key: 'manicure', level: 'senior' },
      { key: 'gel', level: 'senior' },
      { key: 'design', level: 'standard' },
      { key: 'care', level: 'standard' },
    ],
    services: [
      'basic-manicure',
      'classic-manicure',
      'mens-manicure',
      'gel-polish',
      'gel-polish-renewal',
      'french-manicure',
      'nail-strengthening',
      'simple-nail-art',
      'french-design',
      'decorative-design',
      'gel-removal',
      'hand-care',
      'nail-care',
    ],
    schedule: { 2: [h(11), h(20)], 3: [h(11), h(20)], 4: [h(11), h(20)], 5: [h(11), h(20)], 7: [h(10), h(18)] },
    breaks: [{ weekday: null, startsAt: h(14, 30), endsAt: h(15), label: 'Завсарлага' }],
  },
  {
    slug: 'anu',
    name: 'Д. Ану',
    displayName: 'Ану',
    title: 'Хумсны дизайнер',
    bio: 'Захиалгат дизайн, хром, сувдан чимэглэлд дуртай. Үйлчлүүлэгчийн санааг хумсан дээр бодит болгохыг эрхэмлэдэг.',
    experienceYears: 5,
    experienceText: '5 жилийн туршлага · хумсны урлагийн уралдаанд оролцсон (зохиомол)',
    specialties: ['Захиалгат дизайн', 'Хром', 'Сувдан чимэглэл'],
    photo: 'anu',
    cover: 'pearl-art',
    color: '#8c6f8a',
    skills: [
      { key: 'manicure', level: 'standard' },
      { key: 'gel', level: 'senior' },
      { key: 'extensions', level: 'senior' },
      { key: 'acrylic', level: 'standard' },
      { key: 'design', level: 'senior' },
      { key: 'design_senior', level: 'senior' },
    ],
    services: [
      'gel-polish',
      'gel-polish-renewal',
      'nail-extensions',
      'gel-extensions',
      'acrylic-extensions',
      'nail-refill',
      'nail-repair',
      'simple-nail-art',
      'premium-nail-art',
      'french-design',
      'custom-design',
      'decorative-design',
      'gel-removal',
      'extension-removal',
    ],
    schedule: { 3: [h(12), h(20)], 4: [h(12), h(20)], 5: [h(12), h(20)], 6: [h(10), h(18)], 7: [h(10), h(18)] },
    breaks: [
      { weekday: 3, startsAt: h(15), endsAt: h(15, 30), label: 'Завсарлага' },
      { weekday: 4, startsAt: h(15), endsAt: h(15, 30), label: 'Завсарлага' },
      { weekday: 5, startsAt: h(15), endsAt: h(15, 30), label: 'Завсарлага' },
      { weekday: 6, startsAt: h(13, 30), endsAt: h(14), label: 'Үдийн завсарлага' },
      { weekday: 7, startsAt: h(13, 30), endsAt: h(14), label: 'Үдийн завсарлага' },
    ],
  },
  {
    slug: 'khulan',
    name: 'Г. Хулан',
    displayName: 'Хулан',
    title: 'Педикюр, арчилгааны ахлах мастер',
    bio: 'Педикюр, хөлийн арьсны арчилгаанд 8 жил ажилласан. Тайван, анхааралтай үйлчилгээгээрээ байнгын үйлчлүүлэгчидтэй.',
    experienceYears: 8,
    experienceText: '8 жилийн туршлага',
    specialties: ['Премиум педикюр', 'Парафин арчилгаа', 'Аппарат педикюр'],
    photo: 'khulan',
    cover: 'pedicure-chair',
    color: '#6f7d68',
    skills: [
      { key: 'pedicure', level: 'senior' },
      { key: 'care', level: 'senior' },
      { key: 'manicure', level: 'standard' },
      { key: 'gel', level: 'standard' },
    ],
    services: [
      'basic-manicure',
      'classic-manicure',
      'mens-manicure',
      'basic-pedicure',
      'gel-pedicure',
      'premium-pedicure',
      'gel-removal',
      'hand-care',
      'nail-care',
    ],
    schedule: { 2: [h(10), h(19)], 3: [h(10), h(19)], 4: [h(10), h(19)], 5: [h(10), h(19)], 6: [h(10), h(18)] },
    breaks: [{ weekday: null, startsAt: h(13, 30), endsAt: h(14, 15), label: 'Үдийн завсарлага' }],
  },
  {
    slug: 'munkhzul',
    name: 'Ц. Мөнхзул',
    displayName: 'Мөнхзул',
    title: 'Маникюр, педикюрын мастер',
    bio: 'Сувдын сургалтын хөтөлбөрөөр бэлтгэгдсэн залуу мастер. Өдөр тутмын маникюр, гель будалт, педикюрыг хурдан, нямбай хийдэг.',
    experienceYears: 2,
    experienceText: '2 жилийн туршлага',
    specialties: ['Гель будалт', 'Гель педикюр', 'Эрэгтэй маникюр'],
    photo: 'munkhzul',
    cover: 'nude-ring',
    color: '#b08d6e',
    skills: [
      { key: 'manicure', level: 'standard' },
      { key: 'gel', level: 'standard' },
      { key: 'pedicure', level: 'standard' },
      { key: 'care', level: 'standard' },
      { key: 'design', level: 'standard' },
    ],
    services: [
      'basic-manicure',
      'classic-manicure',
      'mens-manicure',
      'gel-polish',
      'simple-nail-art',
      'basic-pedicure',
      'gel-pedicure',
      'gel-removal',
      'hand-care',
    ],
    schedule: { 2: [h(10), h(19)], 3: [h(10), h(19)], 4: [h(10), h(19)], 6: [h(10), h(18)], 7: [h(10), h(18)] },
    breaks: [{ weekday: null, startsAt: h(14), endsAt: h(14, 30), label: 'Завсарлага' }],
  },
]

/** Salon opening hours: closed on Mondays (ISO weekday 1). */
export const OPENING_HOURS = [
  { weekday: 1, isClosed: true, opensAt: h(10), closesAt: h(20) },
  { weekday: 2, isClosed: false, opensAt: h(10), closesAt: h(20) },
  { weekday: 3, isClosed: false, opensAt: h(10), closesAt: h(20) },
  { weekday: 4, isClosed: false, opensAt: h(10), closesAt: h(20) },
  { weekday: 5, isClosed: false, opensAt: h(10), closesAt: h(20) },
  { weekday: 6, isClosed: false, opensAt: h(10), closesAt: h(18) },
  { weekday: 7, isClosed: false, opensAt: h(10), closesAt: h(18) },
]

/** Mongolian public holidays with fixed dates (the lunar Tsagaan Sar is added by the owner). */
export function fixedHolidays(year: number) {
  return [
    { date: `${year}-01-01`, kind: 'closed' as const, label: 'Шинэ жил' },
    {
      date: `${year}-03-08`,
      kind: 'special_hours' as const,
      opensAt: h(9),
      closesAt: h(21),
      label: 'Олон улсын эмэгтэйчүүдийн өдөр — сунгасан цаг',
    },
    { date: `${year}-06-01`, kind: 'closed' as const, label: 'Хүүхдийн баяр' },
    { date: `${year}-07-11`, kind: 'closed' as const, label: 'Үндэсний их баяр наадам' },
    { date: `${year}-07-12`, kind: 'closed' as const, label: 'Үндэсний их баяр наадам' },
    { date: `${year}-07-13`, kind: 'closed' as const, label: 'Үндэсний их баяр наадам' },
    { date: `${year}-11-26`, kind: 'closed' as const, label: 'Бүгд Найрамдах Улс тунхагласан өдөр' },
    { date: `${year}-12-29`, kind: 'closed' as const, label: 'Үндэсний эрх чөлөө, тусгаар тогтнолоо сэргээсний баяр' },
    {
      date: `${year}-12-31`,
      kind: 'special_hours' as const,
      opensAt: h(10),
      closesAt: h(15),
      label: 'Шинэ жилийн өмнөх өдөр — богиносгосон цаг',
    },
  ]
}

export const SETTINGS_DEFAULTS = {
  slotIntervalMinutes: 15,
  minAdvanceMinutes: 120,
  maxAdvanceDays: 60,
  defaultBufferMinutes: 10,
  maxServicesPerBooking: 3,
  cancellationNoticeHours: 12,
  rescheduleNoticeHours: 12,
  confirmationMode: 'manual' as const,
  depositMode: 'fixed' as const,
  depositFixedAmount: 20_000,
  depositPercentBps: 3000,
  depositMinTotal: 100_000,
  holdMinutes: 20,
  lateArrivalMinutes: 15,
  reminderHoursBefore: 24,
  cancellationPolicy:
    'Цагаа эхлэхээс 12 цагийн өмнө цуцалбал урьдчилгааг бүтэн буцаана. 12 цагаас бага хугацаанд цуцалбал эсвэл ирээгүй тохиолдолд урьдчилгаа буцаагдахгүй. 15 минутаас дээш хоцорвол үйлчилгээг богиносгох эсвэл өөр цаг санал болгож болно.',
  depositPolicy:
    '100,000₮-өөс дээш үнийн дүнтэй захиалгад 20,000₮ урьдчилгаа авна. Урьдчилгааг QPay-ээр 20 минутын дотор төлөхөд цаг баталгаажна. Урьдчилгаа нийт үнээс хасагдана.',
}
