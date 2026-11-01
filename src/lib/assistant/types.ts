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

export interface QuickReply {
  label: string
  /** Sent as the user's text… */
  message?: string
  /** …or as a structured action. */
  action?: ChatAction
}

export interface DraftSummary {
  services: { name: string; price: number; from: boolean; durationMinutes: number; addons: { name: string; price: number }[] }[]
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

export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'quick_replies'; options: QuickReply[] }
  | { type: 'slots'; date: string; dateLabel: string; serviceLabel: string; slots: { start: number; label: string }[] }
  | { type: 'draft'; draftId: string; summary: DraftSummary }
  | { type: 'booking'; reference: string; status: string; statusLabel: string; explanation: string; link: string }
  | { type: 'handoff'; text: string }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  parts: ChatPart[]
}

export interface ChatResponse {
  messages: ChatMessage[]
  /** "ai" when a language model answered, "rules" for the deterministic engine. */
  mode: 'ai' | 'rules'
  error?: string
}
