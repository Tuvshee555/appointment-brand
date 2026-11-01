// Mongolian phone numbers are 8 digits (mobile 8x/9x/6x, Ulaanbaatar landline 7x).
// We store them normalised to the bare 8 digits.

const MN_PHONE = /^[5-9]\d{7}$/

export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[^\d+]/g, '')
  if (digits.startsWith('+976')) digits = digits.slice(4)
  else if (digits.startsWith('976') && digits.length === 11) digits = digits.slice(3)
  digits = digits.replace(/\D/g, '')
  return MN_PHONE.test(digits) ? digits : null
}

/** "99112233" -> "9911 2233" */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  return /^\d{8}$/.test(phone) ? `${phone.slice(0, 4)} ${phone.slice(4)}` : phone
}

/** For tel: links. */
export function phoneHref(phone: string): string {
  return `tel:+976${phone.replace(/\D/g, '')}`
}

/** "99112233" -> "99****33" — for logs and anything that must not show the full number. */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  if (phone.length < 4) return '****'
  return `${phone.slice(0, 2)}****${phone.slice(-2)}`
}
