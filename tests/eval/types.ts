// Conversation evaluation cases for the salon assistant. A case is a short conversation; every
// turn is checked against the hard rules (harness.ts) and its own expectations. Expectations
// describe outcomes — the right price, a real free time, a hand-over, nothing invented — never
// the assistant's exact sentences.

export interface TurnExpect {
  /** Regular expressions (case-insensitive) that must match the reply text. */
  must?: string[]
  /** Regular expressions that must not match the reply text. */
  mustNot?: string[]
  /** The turn flagged the conversation for staff. */
  handoff?: boolean
  /** Whether this turn created a booking. */
  booking?: 'created' | 'none'
  /** This turn cancelled the customer's existing booking (false: it must still be active). */
  cancelled?: boolean
  /** This turn moved the customer's existing booking to a new time. */
  rescheduled?: boolean
  /** The reply offers bookable start times. */
  slots?: boolean
  /** The reply shows a booking summary that waits for the customer's confirmation. */
  draft?: boolean
}

export interface EvalTurn {
  /**
   * The customer's message. Placeholders filled by the harness: {REF}/{PHONE} — the customer's
   * own booking (Сонгодог маникюр, Thursday 2026-11-12 16:00); {REF_OTHER}/{PHONE_OTHER} —
   * another customer's booking (Гель педикюр, Friday 2026-11-13 11:00).
   */
  text: string
  expect?: TurnExpect
}

export interface EvalCase {
  id: string
  category: string
  /** How the customer types: Mongolian Cyrillic, Mongolian in Latin letters, English, or a mix. */
  script: 'cyrillic' | 'latin' | 'english' | 'mixed'
  turns: EvalTurn[]
}

/** The fixed clock of every case: Tuesday 2026-11-10, 09:00 in Ulaanbaatar. */
export const EVAL_NOW = new Date('2026-11-10T01:00:00Z')
