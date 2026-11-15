// Presentation rules for every reply (Lorentz chatbotReplyPolicy + reply sanitising): plain text,
// no markdown or control tokens, at most one emoji, no repeated greeting, never empty.

export const REPLY_RULES = [
  'Answer the current question first, in one to three short sentences. No empty enthusiasm.',
  'Ask at most one question, and never ask again for something the customer already gave.',
  'Offer at most a few options; say that more exist when they do.',
  'If the customer asks the same thing again, answer again. Never scold or say it was already answered.',
  'Never say a booking was made, changed or cancelled, or that a payment arrived — the system reports that.',
  'Plain text only: no markdown, headings, tables or bullet symbols. At most one emoji.',
] as const

export function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, '$2')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(?<![\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[*•-]\s+/gm, '')
    .replace(/\|/g, ' ')
}

/** Cleans model-written text for the customer. */
export function presentModelText(text: string): string {
  let emojis = 0
  return stripMarkdown(text)
    .replace(/(^|\s)\b(?:REFER|SILENT|UNKNOWN)\b(?=\s|$)/g, ' ')
    .replace(/\p{Extended_Pictographic}(?:️)?/gu, (e) => (++emojis <= 1 ? e : ''))
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const GREETING_START = /^(?:сайн\s+байна\s+уу|сайн\s+уу|hello|hi|hey)[!.,\s]*/iu

/** Drops a greeting at the start of a reply when the conversation already has one. */
export function withoutRepeatedGreeting(text: string, greeted: boolean): string {
  if (!greeted) return text
  const stripped = text.replace(GREETING_START, '').trim()
  return stripped ? stripped[0].toLocaleUpperCase('mn') + stripped.slice(1) : text
}
