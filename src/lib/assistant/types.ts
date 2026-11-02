// Messages exchanged between the chat widget and /api/chat. The assistant
// answers with structured parts so slots, booking summaries and results are
// rendered from server data — never from model-written text.

export type ChatAction =
  | { type: 'hello' }
  | { type: 'reset' }
  | { type: 'pick_service'; serviceId: string }
  | { type: 'pick_staff'; staffId: string | null }
  | { type: 'pick_date'; date: string }
  | { type: 'choose_slot'; date: string; start: number }
  | { type: 'confirm_draft'; draftId: string }
  | { type: 'cancel_draft'; draftId: string }
  | { type: 'confirm_change'; draftId: string }
  | { type: 'cancel_change'; draftId: string }
  | { type: 'pick_booking'; reference: string }
  | { type: 'human' }

export interface QuickReply {
  label: string
  /** Sent as the user's text… */
  message?: string
  /** …or as a structured action. */
  action?: ChatAction
}

export interface DraftSummary {
  services: {
    name: string
    price: number
    from: boolean
    durationMinutes: number
    addons: { name: string; price: number }[]
  }[]
  staffName: string
  dateLabel: string
  timeRange: string
  durationMinutes: number
  total: number
  hasFromPrice: boolean
  deposit: number
  customerName: string
  customerPhone: string
  statusAfter: string
}

/** One of the customer's own bookings (shown only after they proved it is theirs). */
export interface AppointmentSummary {
  reference: string
  dateLabel: string
  timeRange: string
  services: string[]
  staffName: string
  statusLabel: string
}

/** A cancellation or a move that waits for the customer's confirmation. */
export interface ChangeSummary {
  kind: 'cancel' | 'reschedule'
  reference: string
  from: string
  to?: string
  staffName?: string
  note: string
}

export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'quick_replies'; options: QuickReply[] }
  | { type: 'slots'; date: string; dateLabel: string; serviceLabel: string; slots: { start: number; label: string }[] }
  | { type: 'draft'; draftId: string; summary: DraftSummary }
  | {
      type: 'booking'
      reference: string
      status: string
      statusLabel: string
      explanation: string
      link: string | null
    }
  | { type: 'appointment'; summary: AppointmentSummary }
  | { type: 'change'; draftId: string; summary: ChangeSummary }
  | { type: 'handoff'; text: string }
  | { type: 'staff'; text: string; name: string }
  | { type: 'notice'; text: string }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'staff'
  parts: ChatPart[]
  createdAt?: string
}

export type ConversationStatus = 'bot' | 'handoff' | 'staff' | 'closed'

export interface ChatResponse {
  messages: ChatMessage[]
  /** "ai" when a language model read or wrote this turn, "rules" for the deterministic engine. */
  mode: 'ai' | 'rules'
  /** "staff": a person took the conversation over and answers in the chat. */
  status?: ConversationStatus
  error?: string
}
