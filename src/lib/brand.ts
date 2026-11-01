// The salon's brand identity in one place. Operational details that the owner
// edits (salon name shown on the site, phone, address, hours, policies) live
// in the database (business_settings) and are seeded from DEMO_SALON below.
//
// SUVD («Сувд», pearl) is a fictional brand created for the Ursgal Digital
// portfolio. It is not a registered business; every record is sample data.

export const BRAND = {
  /** Wordmark (Latin) and the Mongolian name. */
  wordmark: 'SUVD',
  name: 'Сувд',
  descriptor: 'Nail & Beauty Atelier',
  descriptorMn: 'Хумс, гоо сайхны ателье',
  tagline: 'Хумсны нарийн урлал, тайван орчинд',
  /** Why "Сувд": a pearl forms slowly, layer by layer — like careful nail work. */
  story:
    'Сувд давхарга давхаргаар, цаг хугацаа зарцуулж бүрэлддэг. Бид хумсны ажлыг яг тийм нямбай, яаралгүй хийхийг эрхэмлэдэг.',
  voice: [
    'Тайван, найрсаг',
    'Товч, тодорхой',
    'Үйлчлүүлэгчийн цагийг хүндэлсэн',
    'Хэтрүүлэггүй — шагнал, тоо зохиохгүй',
  ],
  /** Brand palette (mirrors the CSS tokens in globals.css). */
  colors: {
    ivory: '#F7F2EA',
    porcelain: '#FCFAF6',
    sand: '#EDE4D8',
    blush: '#D7AE9F',
    blushDeep: '#B98474',
    cocoa: '#4A362C',
    espresso: '#241A15',
    ink: '#1A1512',
  },
  fonts: { display: 'Cormorant Garamond', text: 'Golos Text' },
  /** Internal demonstration label shown wherever sample data appears. */
  demoLabel: 'Жишээ',
} as const

/** Ursgal Digital portfolio links (the salon is one zone of the Ursgal site). */
export const PORTFOLIO = {
  agency: 'Ursgal Digital',
  /** Absolute so it also works when the salon runs on its own domain. */
  portfolioUrl: process.env.NEXT_PUBLIC_PORTFOLIO_URL || 'https://ursgal-digital.vercel.app/#demos',
  note: 'Ursgal Digital-ын дотоод демо. Салон, ажилтан, үйлчлүүлэгч, захиалга бүгд зохиомол.',
} as const

/**
 * Launch values for the fictional salon. The seed writes these into the
 * database once; afterwards the owner edits them in /admin/settings.
 * Contact details are deliberately non-working (reserved `.example` domain,
 * 5000-prefixed phone numbers that no Mongolian operator issues).
 */
export const DEMO_SALON = {
  slug: 'suvd',
  name: 'Сувд',
  tagline: BRAND.tagline,
  about:
    'Сувд бол хумсны арчилгаа, дизайнд төвлөрсөн жижиг ателье. Бид нэг удаад нэг үйлчлүүлэгчид бүрэн анхаарч, багаж бүрийг ариутгаж, баталгаатай материал ашигладаг. Маникюр, педикюр, хумс сунгалт, гар зургийн дизайныг таны хүссэн хэлбэр, өнгөөр хийнэ.',
  announcement: 'Зохиомол демо салон · Шинэ үйлчлүүлэгчдэд гарын парафин арчилгаа бэлэг',
  phone: '50000100',
  email: 'hello@suvd.example',
  addressLine: 'Сүхбаатар дүүрэг, 1-р хороо, Жишээ гудамж 12, 2 давхар',
  addressNote: 'Зохиомол хаяг — демо зорилгоор',
  instagram: '@suvd.atelier (зохиомол)',
  facebook: 'Suvd Atelier (зохиомол)',
} as const
