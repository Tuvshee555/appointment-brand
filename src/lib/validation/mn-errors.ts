// Mongolian messages for every validation error that has no message of its own.
// Zod ships no Mongolian locale, and its English defaults must never reach a
// form, so this replaces the locale globally. Imported for its side effect by
// `common.ts` (and so by every schema) and by the server action runner.
import { z } from 'zod'

type Issue = z.core.$ZodRawIssue

function bound(issue: Issue, which: 'minimum' | 'maximum'): string {
  const value = (issue as unknown as Record<string, unknown>)[which]
  return typeof value === 'bigint' || typeof value === 'number' ? Number(value).toLocaleString('en-US') : String(value ?? '')
}

export function mongolianError(issue: Issue): string {
  const origin = 'origin' in issue ? issue.origin : undefined
  switch (issue.code) {
    case 'invalid_type': {
      if (issue.input === undefined || issue.input === null || issue.input === '') return 'Заавал бөглөнө үү.'
      if (issue.expected === 'int') return 'Бүхэл тоо оруулна уу.'
      if (issue.expected === 'number' || issue.expected === 'bigint') return 'Тоо оруулна уу.'
      if (issue.expected === 'boolean') return 'Сонголт хийнэ үү.'
      if (issue.expected === 'date') return 'Огноо оруулна уу.'
      return 'Утга буруу байна.'
    }
    case 'too_small':
      if (origin === 'string') return Number(bound(issue, 'minimum')) <= 1 ? 'Заавал бөглөнө үү.' : `Хамгийн багадаа ${bound(issue, 'minimum')} тэмдэгт оруулна уу.`
      if (origin === 'array' || origin === 'set') return `Дор хаяж ${bound(issue, 'minimum')}-ийг сонгоно уу.`
      return `${bound(issue, 'minimum')}-аас бага байж болохгүй.`
    case 'too_big':
      if (origin === 'string') return `Хамгийн ихдээ ${bound(issue, 'maximum')} тэмдэгт.`
      if (origin === 'array' || origin === 'set') return `Хамгийн ихдээ ${bound(issue, 'maximum')} байна.`
      if (origin === 'file') return 'Файлын хэмжээ хэт их байна.'
      return `${bound(issue, 'maximum')}-аас их байж болохгүй.`
    case 'invalid_format':
      switch (issue.format) {
        case 'email':
          return 'И-мэйл хаяг буруу байна.'
        case 'url':
          return 'Холбоос буруу байна.'
        case 'datetime':
        case 'date':
        case 'time':
          return 'Огноо, цаг буруу байна.'
        case 'uuid':
        case 'guid':
          return 'Буруу дугаар.'
        default:
          return 'Хэлбэр буруу байна.'
      }
    case 'invalid_value':
      return 'Жагсаалтаас сонгоно уу.'
    case 'not_multiple_of':
      return 'Утга буруу байна.'
    default:
      return 'Мэдээллээ шалгана уу.'
  }
}

z.config({ localeError: mongolianError })
