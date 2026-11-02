// How customers name Сувд's services, beyond the catalogue names themselves. Matching is
// typo-tolerant and works in Latin letters (engine/vocab.ts), so only genuinely different words
// are listed here. Services the owner adds later are still found by their catalogue name.
import type { VocabEntry } from '../engine/vocab'

/** Extra names per service slug (Mongolian, Latin-script and English). */
export const SERVICE_ALIASES: Record<string, string[]> = {
  'basic-manicure': ['энгийн маникюр', 'basic manicure', 'хямд маникюр'],
  'classic-manicure': ['сонгодог маникюр', 'classic manicure'],
  'mens-manicure': ['эрэгтэй маникюр', 'эрэгтэй хүний маникюр', 'men manicure', 'эрэгтэй'],
  'gel-polish': ['гель будалт', 'гель лак', 'гель будах', 'гелэн будалт', 'gel polish', 'gel manicure', 'shellac'],
  'gel-polish-renewal': ['гель авч шинээр будах', 'гель авч будах', 'гель солих', 'шинээр будах', 'gel refresh'],
  'french-manicure': ['франц маникюр', 'french manicure'],
  'nail-strengthening': ['хумс бэхжүүлэлт', 'бэхжүүлэлт', 'бэхжүүлэх', 'strengthening', 'biab'],
  'nail-extensions': ['типс', 'типсээр сунгах', 'типс сунгалт', 'tips extension'],
  'gel-extensions': ['гель сунгалт', 'гелээр сунгах', 'gel extension'],
  'acrylic-extensions': ['акрил сунгалт', 'акрил', 'acrylic extension'],
  'nail-refill': ['сунгалтын нөхөлт', 'нөхөлт', 'нөхүүлэх', 'refill'],
  'nail-repair': ['хумс засвар', 'засвар', 'засуулах', 'хугарсан хумс', 'nail repair'],
  'simple-nail-art': ['энгийн гар зураг', 'энгийн зураг', 'simple nail art'],
  'premium-nail-art': ['премиум гар зураг', 'премиум зураг', 'хром', 'нарийн зураг', 'chrome nails'],
  'french-design': ['франц дизайн', 'french design'],
  'custom-design': ['захиалгат дизайн', 'өөрийн дизайн', 'custom design'],
  'decorative-design': ['чулуун чимэглэл', 'сувдан чимэглэл', 'чулуу наах', 'rhinestones'],
  'basic-pedicure': ['энгийн педикюр', 'basic pedicure'],
  'gel-pedicure': ['гель педикюр', 'хөлийн гель', 'gel pedicure'],
  'premium-pedicure': ['премиум педикюр', 'аппарат педикюр', 'spa pedicure'],
  'gel-removal': ['гель авалт', 'гель авах', 'гелээ авах', 'гель авахуулах', 'gel removal'],
  'extension-removal': ['сунгалт авалт', 'сунгалт авах', 'сунгалтаа авах', 'extension removal'],
  'hand-care': ['гарын парафин арчилгаа', 'парафин', 'гарын арчилгаа', 'paraffin'],
  'nail-care': ['хумсны арчилгаа', 'витамин арчилгаа', 'nail care'],
}

/** Generic words → the services they may mean, with the usual meaning when there is one. */
export const GENERIC_TERMS: { key: string; label: string; phrases: string[]; slugs: string[]; canonical: string | null }[] = [
  {
    key: 'manicure',
    label: 'Маникюр',
    phrases: ['маникюр', 'manicure', 'гарын хумс'],
    slugs: ['basic-manicure', 'classic-manicure', 'mens-manicure', 'gel-polish', 'french-manicure', 'nail-strengthening'],
    canonical: 'classic-manicure',
  },
  {
    key: 'pedicure',
    label: 'Педикюр',
    phrases: ['педикюр', 'pedicure', 'хөлийн хумс'],
    slugs: ['basic-pedicure', 'gel-pedicure', 'premium-pedicure'],
    canonical: 'basic-pedicure',
  },
  {
    key: 'gel',
    label: 'Гель',
    phrases: ['гель', 'gel'],
    slugs: ['gel-polish', 'gel-polish-renewal', 'gel-pedicure', 'gel-extensions', 'gel-removal'],
    canonical: 'gel-polish',
  },
  {
    key: 'extensions',
    label: 'Хумс сунгалт',
    phrases: ['сунгалт', 'хумс сунгалт', 'хумс сунгах', 'extensions'],
    slugs: ['nail-extensions', 'gel-extensions', 'acrylic-extensions'],
    canonical: null,
  },
  {
    key: 'design',
    label: 'Хумсны дизайн',
    phrases: ['дизайн', 'гар зураг', 'зураг', 'хумсны зураг', 'nail art'],
    slugs: ['simple-nail-art', 'premium-nail-art', 'french-design', 'custom-design', 'decorative-design'],
    canonical: null,
  },
  {
    key: 'french',
    label: 'Франц',
    phrases: ['франц', 'french'],
    slugs: ['french-manicure', 'french-design'],
    canonical: 'french-manicure',
  },
  {
    key: 'removal',
    label: 'Авалт',
    phrases: ['авалт', 'removal'],
    slugs: ['gel-removal', 'extension-removal'],
    canonical: null,
  },
  {
    key: 'care',
    label: 'Арчилгаа',
    phrases: ['арчилгаа', 'care'],
    slugs: ['hand-care', 'nail-care'],
    canonical: null,
  },
]

/** Beauty services Сувд does not offer: answered honestly, never matched to a nail service. */
export const OUTSIDE_PHRASES = [
  'сормос',
  'сормос сунгалт',
  'eyelash',
  'lash',
  'lashes',
  'хөмсөг',
  'eyebrow',
  'brow',
  'үс засалт',
  'үс засуулах',
  'үс будах',
  'haircut',
  'hair',
  'нүүр будалт',
  'makeup',
  'нүүрний арчилгаа',
  'facial',
  'вакс',
  'wax',
  'waxing',
  'шивээс',
  'tattoo',
]

/** "Any specialist" in customers' words. */
export const ANY_STAFF_PHRASES = [
  'аль ч мастер',
  'хэн ч хамаагүй',
  'хамаагүй',
  'хэн нь ч болно',
  'аль нь ч болно',
  'сул байгаа нь',
  'any',
  'anyone',
  'no preference',
]

export function serviceVocabulary(services: { id: string; slug: string; name: string }[]): VocabEntry[] {
  return services.map((s) => ({ id: s.id, kind: 'service', phrases: [s.name, ...(SERVICE_ALIASES[s.slug] ?? [])] }))
}
