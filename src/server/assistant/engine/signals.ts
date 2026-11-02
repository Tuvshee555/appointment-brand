// Short answers inside a conversation: yes/no, a numbered pick, a phone number, a booking
// reference, a name. Each reads the raw text and its normText() form. Business-agnostic.
import { normalizePhone } from '@/lib/phone'
import { normText } from './text'

const YES =
  /^(?:тийм|за|зүгээр|болно|ок|ok|okay|okey|oki|sure|зөв|тэгье|тэгнэ|тэгээрэй|тэгвэл|баталгаажуул[а-яөүё]*|confirm[a-z]*|сайн|good|great|perfect|done|go\s+ahead|of\s+course|👍)(?=\s|$|[.!,])/u
const NO =
  /^(?:үгүй|болих|болиулах|битгий|хэрэггүй|no|not\s+now|nevermind|never\s+mind|байз|дараа\s+(?:болъё|болно|хийнэ)|цуцал(?:ъя|ая))(?=\s|$|[.!,])/u

/** "тийм", "za bolno", "ok", "yes" — an agreement with nothing contradicting it. */
export function isYes(norm: string, raw: string): boolean {
  const s = norm.trim()
  if (NO.test(s) || /(?:^|\s)(?:биш|үгүй|битгий)(?:\s|$)/.test(s)) return false
  return YES.test(s) || YES.test(raw.trim().toLowerCase())
}

export function isNo(norm: string, raw: string): boolean {
  const s = norm.trim()
  return NO.test(s) || /^no\b/i.test(raw.trim()) || /^(?:болих|болиул)/.test(s)
}

const ORDINALS: [RegExp, number][] = [
  [/^(?:эхн|нэгд|нэгдүгээр|first|1st)/, 0],
  [/^(?:хоёрд|хоёрдугаар|second|2nd)/, 1],
  [/^(?:гуравд|гуравдугаар|third|3rd)/, 2],
  [/^(?:дөрөвд|дөрөвдүгээр|fourth|4th)/, 3],
]

/** A pick from a numbered list: "2", "2-р", "хоёрдугаарх", "the first one". Zero-based. */
export function numberChoice(norm: string): number | undefined {
  const s = norm.trim().replace(/^(?:the\s+)/, '')
  const digit = /^([1-9])(?:\s*(?:р|-р|дугаар\w*|dahi|dah|-?ыг|-?ийг))?(?:\s+(?:нь|ni|one))?\s*$/u.exec(s)
  if (digit) return Number(digit[1]) - 1
  for (const [re, index] of ORDINALS) if (re.test(s)) return index
  return undefined
}

/** An 8-digit Mongolian mobile number anywhere in the text (+976 allowed). */
export function findPhone(raw: string): string | null {
  for (const m of raw.matchAll(/(?<![\d])(?:\+?976[\s-]?)?(\d{4})[\s-]?(\d{4})(?![\d])/g)) {
    const phone = normalizePhone(`${m[1]}${m[2]}`)
    if (phone) return phone
  }
  return null
}

/** A booking reference such as "SV-K3QX7A" (dash and case optional). */
export function findReference(raw: string, prefix = 'SV'): string | null {
  const m = new RegExp(`(?:^|[^a-z0-9])${prefix}[\\s-]?([a-z0-9]{6})(?![a-z0-9])`, 'i').exec(raw)
  return m ? `${prefix}-${m[1].toUpperCase()}` : null
}

/** Words that make a reply something other than a name (whole words, or these stems). */
const NOT_NAME_WORDS = new Set([
  'үнэ', 'хэд', 'вэ', 'бэ', 'уу', 'үү', 'юу', 'тийм', 'үгүй', 'болно', 'за', 'сайн', 'байна', 'ок', 'ok',
  'book', 'price', 'time', 'yes', 'no', 'hello', 'hi', 'the', 'and',
])
const NOT_NAME_STEMS = [
  'цаг', 'захиал', 'үйлчил', 'маникюр', 'педикюр', 'гель', 'сунгал', 'хумс', 'мастер', 'маргааш',
  'өнөөдөр', 'нөгөөдөр', 'утас', 'дугаар', 'баярлал', 'хүсэж', 'цуцл', 'өөрчл', 'appoint', 'cancel',
]

function notAName(text: string): boolean {
  const words = [...text.toLowerCase().split(/\s+/), ...normText(text).split(/\s+/)]
  return words.some((w) => NOT_NAME_WORDS.has(w) || NOT_NAME_STEMS.some((s) => w.startsWith(s)))
}

/** Any 8-digit number (valid Mongolian phone or not) — a wrong number is still an attempt. */
export function findDigits8(raw: string): string | null {
  const m = /(?<!\d)(?:\+?976[\s-]?)?(\d{4})[\s-]?(\d{4})(?!\d)/.exec(raw)
  return m ? `${m[1]}${m[2]}` : null
}

function titleCase(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => (w ? w[0].toLocaleUpperCase('mn') + w.slice(1) : w))
    .join(' ')
}

/**
 * The customer's name. Explicit forms ("намайг Болд гэдэг", "my name is Anu") always count; when
 * the assistant has just asked for the name (`expected`), the remaining words after removing a
 * phone number count as the name.
 */
export function findName(raw: string, expected: boolean): string | null {
  const explicit =
    /(?:намайг|миний\s+нэр(?:\s+бол)?|нэр(?:\s+нь)?\s*[:-]?|namaig|minii\s+ner|ner\s*[:-])\s+([\p{L}][\p{L}-]{1,30}(?:\s+[\p{L}][\p{L}-]{1,30})?)(?:\s+гэдэг|\s+gedeg)?/iu.exec(
      raw,
    ) ?? /(?:my\s+name\s+is|i\s+am|i'm|this\s+is)\s+([a-z][a-z-]{1,30}(?:\s+[a-z][a-z-]{1,30})?)/i.exec(raw)
  if (explicit && !notAName(explicit[1])) return titleCase(explicit[1].trim()).slice(0, 60)
  if (!expected) return null
  const rest = raw
    .replace(/(?:\+?976[\s-]?)?\d{4}[\s-]?\d{4}/g, ' ')
    .replace(/[,.;:!?()"'«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!rest || rest.length > 40) return null
  const words = rest.split(' ')
  if (words.length > 3 || words.some((w) => !/^[\p{L}][\p{L}-]+$/u.test(w))) return null
  if (notAName(rest)) return null
  return titleCase(rest).slice(0, 60)
}
