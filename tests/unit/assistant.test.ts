import { describe, expect, it } from 'vitest'
import { ungroundedValues } from '@/server/assistant/llm'
import { matchService, normalize, parseDateWord } from '@/server/assistant/rules'

type Index = Parameters<typeof matchService>[0]

const services = [
  { id: '1', slug: 'gel-polish', name: 'Гель будалт' },
  { id: '2', slug: 'gel-pedicure', name: 'Гель педикюр' },
  { id: '3', slug: 'nail-extensions', name: 'Хумс сунгалт (типс)' },
  { id: '4', slug: 'basic-pedicure', name: 'Энгийн педикюр' },
  { id: '5', slug: 'classic-manicure', name: 'Сонгодог маникюр' },
]
const index = { services, staff: [], staffServices: [] } as unknown as Index
const match = (text: string) => matchService(index, normalize(text))?.slug ?? null

describe('rule-based assistant', () => {
  it('normalises Latin-script Mongolian', () => {
    const s = normalize('Gel une hed ve?')
    expect(s).toContain('гель')
    expect(s).toContain('үнэ')
    expect(s).toContain('хэд')
  })

  it('matches the most specific service phrase', () => {
    expect(match('гель будалт хийлгэмээр байна')).toBe('gel-polish')
    expect(match('гель педикюр хэд вэ')).toBe('gel-pedicure')
    expect(match('педикюр')).toBe('basic-pedicure')
    expect(match('хумс сунгуулах')).toBe('nail-extensions')
    expect(match('manicure une')).toBe('classic-manicure')
    expect(match('сайн байна уу')).toBeNull()
  })

  it('understands relative and explicit dates', () => {
    const today = '2026-11-12' // Thursday
    expect(parseDateWord('өнөөдөр', today)).toBe(today)
    expect(parseDateWord('маргааш', today)).toBe('2026-11-13')
    expect(parseDateWord('нөгөөдөр', today)).toBe('2026-11-14')
    expect(parseDateWord('баасан гарагт', today)).toBe('2026-11-13')
    expect(parseDateWord('пүрэв', today)).toBe(today)
    expect(parseDateWord('12 сарын 3', today)).toBe('2026-12-03')
    expect(parseDateWord('11/5', today)).toBe('2027-11-05') // already passed this year
    expect(parseDateWord('2026-12-24', today)).toBe('2026-12-24')
    expect(parseDateWord('удахгүй', today)).toBeNull()
  })
})

describe('reply guard', () => {
  const evidence = 'Гель будалт 65000 төгрөг. Сул цаг: 10:00, 10:15, 14:30'

  it('accepts prices and times that come from the tools', () => {
    expect(ungroundedValues('Гель будалт 65,000₮. 10:00 эсвэл 14:30 цаг сул.', evidence, [65_000])).toEqual([])
  })

  it('flags invented prices and times', () => {
    expect(ungroundedValues('Үнэ нь 55,000₮.', evidence, [65_000])).toEqual(['55,000₮'])
    expect(ungroundedValues('16:45 цаг сул байна.', evidence, [])).toEqual(['16:45'])
  })

  it('treats 9:00 and 09:00 as the same time', () => {
    expect(ungroundedValues('09:00-д ирээрэй', 'Сул цаг: 9:00', [])).toEqual([])
  })
})
