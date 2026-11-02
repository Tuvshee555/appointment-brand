// Fact check for model-written text (Lorentz productReplyVerification, appointment edition). The
// model may choose its own words, but every checkable fact must be in the evidence the code gave
// it: amounts, clock times, phone numbers, e-mail addresses and links. It may never claim that a
// booking was made or changed, or that a payment was received — only the backend says that.

export interface Evidence {
  amounts: Set<number>
  /** Clock times as "H:MM" (no leading zero). */
  times: Set<string>
  phones: Set<string>
  emails: Set<string>
  links: Set<string>
}

export type Verdict = { ok: true; text: string } | { ok: false; reason: string }

const AMOUNT = /(\d{1,3}(?:[,.\s]\d{3})+|\d+)\s*(?:₮|төгрөг|tugrug|mnt\b)/giu
const TIME = /(?<![\d:])([01]?\d|2[0-3])[:.]([0-5]\d)(?![\d:])/g
const PHONE = /(?<![\d-])(?:\+?976[\s-]?)?(\d{4})[\s-]?(\d{4})(?![\d-])/g
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g
const LINK = /https?:\/\/[^\s)]+/g
const ACTION_CLAIM =
  /(?:захиалга(?:\s+тань)?\s+(?:баталгаажлаа|баталгаажсан|үүслээ|үүсгэлээ|бүртгэгдлээ|цуцлагдлаа|өөрчлөгдлөө)|цаг(?:ийг)?\s+(?:тань\s+)?(?:захиаллаа|товлолоо|цуцаллаа|өөрчиллөө)|(?:you\s+are|you're|i\s+have|i've)\s+(?:booked|confirmed|cancelled|canceled|rescheduled)|booking\s+(?:is\s+)?(?:confirmed|created|cancelled|canceled))/iu
const PAYMENT_CLAIM =
  /(?:төлбөр(?:\s+тань)?\s+(?:орсон|орлоо|баталгаажлаа|төлөгдсөн)|урьдчилгаа(?:\s+тань)?\s+(?:орсон|төлөгдсөн|баталгаажлаа)|payment\s+(?:is\s+)?(?:received|confirmed))/iu
const PROMISE = /(?:100\s*%|баталгаатай|гарантитай|guarantee|хямдрал\s+(?:үзүүлнэ|өгнө)|discount\s+for\s+you)/iu

export const clockKey = (h: number, m: number) => `${h}:${String(m).padStart(2, '0')}`

export function verifyReply(text: string, evidence: Evidence): Verdict {
  const reply = text.trim()
  if (!reply || /^(?:REFER|UNKNOWN)\b/i.test(reply)) return { ok: false, reason: 'refer' }
  if (ACTION_CLAIM.test(reply)) return { ok: false, reason: 'action_claim' }
  if (PAYMENT_CLAIM.test(reply)) return { ok: false, reason: 'payment_claim' }
  if (PROMISE.test(reply)) return { ok: false, reason: 'promise' }
  const withoutLinks = reply.replace(LINK, ' ')
  for (const m of withoutLinks.matchAll(AMOUNT)) {
    const amount = Number(m[1].replace(/[,.\s]/g, ''))
    if (!evidence.amounts.has(amount)) return { ok: false, reason: `amount:${amount}` }
  }
  for (const m of withoutLinks.matchAll(TIME)) {
    const key = clockKey(Number(m[1]), Number(m[2]))
    if (!evidence.times.has(key)) return { ok: false, reason: `time:${key}` }
  }
  for (const m of withoutLinks.matchAll(PHONE)) {
    if (!evidence.phones.has(`${m[1]}${m[2]}`)) return { ok: false, reason: 'phone' }
  }
  for (const m of withoutLinks.matchAll(EMAIL)) {
    if (!evidence.emails.has(m[0].replace(/\.+$/, '').toLowerCase())) return { ok: false, reason: 'email' }
  }
  for (const m of reply.matchAll(LINK)) {
    if (!evidence.links.has(m[0].replace(/[.,!?;:]+$/, ''))) return { ok: false, reason: 'link' }
  }
  return { ok: true, text: reply }
}

/** Clock times and amounts that appear in a text, for building evidence from code-written facts. */
export function factsIn(text: string): { amounts: number[]; times: string[] } {
  return {
    amounts: [...text.matchAll(AMOUNT)].map((m) => Number(m[1].replace(/[,.\s]/g, ''))),
    times: [...text.matchAll(TIME)].map((m) => clockKey(Number(m[1]), Number(m[2]))),
  }
}
