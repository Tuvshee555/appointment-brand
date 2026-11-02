// Hides customers' contact details in assistant transcripts for staff without contact access
// (and always for public demo visitors): phone numbers, contact answers, names on summaries.
import type { ChatPart } from './types'

const PHONE = /(?<!\d)(?:\+?976[\s-]?)?(\d{2})\d{2}[\s-]?\d{2}(\d{2})(?!\d)/g

export function maskPhones(text: string): string {
  return text.replace(PHONE, (_m, a: string, b: string) => `${a}****${b}`)
}

export function maskName(name: string): string {
  const first = name.trim()[0]
  return first ? `${first}***` : '***'
}

export function redactParts(parts: ChatPart[]): ChatPart[] {
  return parts.map((p) => {
    switch (p.type) {
      case 'text':
      case 'handoff':
      case 'notice':
      case 'staff':
        return { ...p, text: maskPhones(p.text) }
      case 'draft':
        return {
          ...p,
          summary: { ...p.summary, customerName: maskName(p.summary.customerName), customerPhone: maskPhones(p.summary.customerPhone) },
        }
      default:
        return p
    }
  })
}

/** A customer's message as a viewer without contact access sees it. */
export function redactCustomerText(text: string, sensitive: boolean): string {
  return sensitive ? 'Холбоо барих мэдээлэл (нуусан)' : maskPhones(text)
}
