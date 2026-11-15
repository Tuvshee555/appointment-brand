// Matches a message to the business's own verified FAQ entries (Lorentz knowledge.ts). A match is
// quoted verbatim; the model never rewrites an owner's answer.
import { contentTokens, normText, phoneticTokens, tokenMatches } from './text'

export interface KnowledgeItem {
  id: string
  question: string
  answer: string
  /** Extra phrases that identify the entry ("зогсоол", "parking"). */
  keywords: string[]
}

export interface KnowledgeMatch {
  item: KnowledgeItem
  score: number
}

function overlap(asked: string[], stored: string[]) {
  if (!stored.length) return { score: 0, shared: 0 }
  const shared = stored.filter((w) => asked.some((a) => tokenMatches(a, w))).length
  return { score: shared / stored.length, shared }
}

/**
 * The best entry for the message, or null. A keyword phrase that appears in full is a match; a
 * short stored question needs every content word, a longer one most of them and at least two.
 */
export function matchKnowledge(text: string, items: KnowledgeItem[]): KnowledgeMatch | null {
  const asked = contentTokens(text)
  const askedAll = phoneticTokens(normText(text))
  let best: KnowledgeMatch | null = null
  for (const item of items) {
    let score = 0
    for (const k of item.keywords) {
      const words = phoneticTokens(normText(k))
      if (words.length && words.every((w) => askedAll.some((a) => tokenMatches(a, w)))) score = Math.max(score, 1)
    }
    const stored = contentTokens(item.question)
    const o = overlap(asked, stored)
    if (stored.length <= 2 ? o.score >= 1 : o.shared >= 2 && o.score >= 0.6) score = Math.max(score, o.score)
    if (score > 0 && (!best || score > best.score)) best = { item, score }
  }
  return best
}

/** Amounts in an answer go stale silently: prices belong in the catalogue, not in FAQ text. */
export function answerHasAmount(answer: string): boolean {
  return /\d[\d,.\s]*\s*(?:₮|төгрөг|tugrug|mnt)/iu.test(answer)
}
