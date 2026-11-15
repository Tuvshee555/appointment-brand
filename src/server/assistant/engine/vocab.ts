// Finds the business's own vocabulary (service names, categories, specialists) in a message,
// typo-tolerant and across Cyrillic/Latin spelling. Phrases are matched by position, longest
// first, and a word belongs to one match only: "гель педикюр" is the gel pedicure, not "gel"
// plus "pedicure"; "гель будалт болон гель авалт" is two services.
import { normText, phoneticTokens, tokenMatches } from './text'

export interface VocabEntry {
  id: string
  kind: string
  phrases: string[]
}

interface CompiledPhrase {
  id: string
  kind: string
  words: string[]
  weight: number
}

export interface Vocabulary {
  phrases: CompiledPhrase[]
}

export interface VocabMatch {
  id: string
  kind: string
  /** Positions of the matched words in the message, in order. */
  at: number[]
  weight: number
}

export function compileVocabulary(entries: VocabEntry[]): Vocabulary {
  const phrases: CompiledPhrase[] = []
  for (const e of entries) {
    for (const phrase of e.phrases) {
      const words = phoneticTokens(normText(phrase))
      if (!words.length) continue
      phrases.push({ id: e.id, kind: e.kind, words, weight: words.join('').length + words.length * 2 })
    }
  }
  return { phrases }
}

/** Every place `words` occurs in `tokens`, in order, with at most `gap` other words between. */
function occurrences(tokens: string[], words: string[], gap = 1): number[][] {
  const found: number[][] = []
  for (let start = 0; start < tokens.length; start++) {
    if (!tokenMatches(tokens[start], words[0])) continue
    const at = [start]
    let pos = start
    for (const w of words.slice(1)) {
      let next = -1
      for (let j = pos + 1; j <= Math.min(tokens.length - 1, pos + 1 + gap); j++) {
        if (tokenMatches(tokens[j], w)) {
          next = j
          break
        }
      }
      if (next < 0) break
      at.push(next)
      pos = next
    }
    if (at.length === words.length) found.push(at)
  }
  return found
}

/** Non-overlapping vocabulary matches in the message, strongest first. */
export function findVocabulary(text: string, vocab: Vocabulary, kinds?: string[]): VocabMatch[] {
  const tokens = phoneticTokens(normText(text))
  const candidates: VocabMatch[] = []
  for (const p of vocab.phrases) {
    if (kinds && !kinds.includes(p.kind)) continue
    for (const at of occurrences(tokens, p.words)) candidates.push({ id: p.id, kind: p.kind, at, weight: p.weight })
  }
  candidates.sort((a, b) => b.weight - a.weight || a.at[0] - b.at[0])
  const used = new Set<number>()
  const picked: VocabMatch[] = []
  for (const m of candidates) {
    if (m.at.some((i) => used.has(i))) continue
    if (picked.some((p) => p.id === m.id && p.kind === m.kind)) continue
    m.at.forEach((i) => used.add(i))
    picked.push(m)
  }
  return picked.sort((a, b) => a.at[0] - b.at[0])
}
