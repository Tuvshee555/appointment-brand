// Сувд's side of the Meta integration: a Messenger or Instagram message goes
// through the same assistant, salon data, booking safety rules (a booking is
// only made after the customer confirms its draft), rate limits and staff
// takeover as the website chat.
// - The session is keyed by a hash of (platform, account, sender); the raw
//   Meta id is never stored on it.
// - A booking draft becomes a quick reply «Баталгаажуулах» whose payload
//   carries the draft id, on Messenger and Instagram alike.
// - The private manage link is never sent to Meta (it is shown once on the
//   website only); the booking reference and status are.
import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import type { ChatAction, ChatPart, QuickReply } from '@/lib/assistant/types'
import { handleChat, type ChatRequest } from '@/server/assistant/handler'
import { ServiceError, type ServiceContext } from '@/server/context'
import type { Database } from '@/server/db/client'
import * as t from '@/server/db/schema'
import { sha256Hex } from '@/server/security/crypto'
import { hitRateLimit, LIMITS } from '@/server/security/rate-limit'
import { resolveSalonId } from '@/server/services/salon'
import type { Chip } from './graph'
import type { MetaPlatform } from './events'
import type { MetaAdapter, MetaReply } from './process'
import { withSlotTimes } from './text'

/**
 * Sessions from Meta carry this prefix on their visitor hash, so the public demo
 * admin can leave real Messenger/Instagram conversations out (see admin-assistant.ts).
 */
export const META_VISITOR_PREFIX = 'mt:'
export const metaVisitorHash = (platform: MetaPlatform, accountId: string, senderId: string) =>
  `${META_VISITOR_PREFIX}${sha256Hex(`meta:${platform}:${accountId}:${senderId}`).slice(0, 61)}`
const engineMessageId = (mid: string) => `meta:${sha256Hex(mid).slice(0, 40)}`

/** A chip's payload: plain text is sent as the customer's words, an action as "action:<json>". */
function chipFor(q: QuickReply): Chip {
  if (q.action) return { title: q.label, payload: `action:${JSON.stringify(q.action)}` }
  return { title: q.label, payload: q.message ?? q.label }
}

/** The request a Meta message stands for: a tapped action chip, an older postback button, or text. */
export function requestFor(text: string, clientMessageId: string): ChatRequest {
  const action = text.startsWith('action:') ? text.slice(7) : text.startsWith('{') ? text : null
  if (action) {
    try {
      const parsed = JSON.parse(action) as ChatAction
      if (parsed && typeof parsed.type === 'string') return { action: parsed }
    } catch {
      // not an action: answer it as text
    }
  }
  return { message: text.slice(0, 500), clientMessageId }
}

/** Website chat parts as one Messenger/Instagram text with chips. */
export function toMetaReply(parts: ChatPart[]): MetaReply | null {
  const lines: string[] = []
  const chips: Chip[] = []
  for (const p of parts) {
    if (p.type === 'text' || p.type === 'handoff' || p.type === 'staff' || p.type === 'notice') lines.push(p.text)
    if (p.type === 'quick_replies') chips.push(...p.options.map(chipFor))
    if (p.type === 'slots') {
      const merged = withSlotTimes(lines, `${p.dateLabel}, ${p.serviceLabel}`, p.slots.map((s) => s.label).join(', '))
      lines.splice(0, lines.length, ...merged)
      chips.push(
        ...p.slots.slice(0, 10).map((s) => ({
          title: s.label,
          payload: `action:${JSON.stringify({ type: 'choose_slot', date: p.date, start: s.start })}`,
        })),
      )
    }
    if (p.type === 'draft') {
      lines.push(
        `${p.summary.dateLabel} ${p.summary.timeRange} · ${p.summary.services.map((s) => s.name).join(' + ')} · ${p.summary.staffName}`,
      )
      chips.push(
        { title: 'Баталгаажуулах', payload: `action:${JSON.stringify({ type: 'confirm_draft', draftId: p.draftId })}` },
        { title: 'Цуцлах', payload: `action:${JSON.stringify({ type: 'cancel_draft', draftId: p.draftId })}` },
      )
    }
    if (p.type === 'booking') lines.push(`Захиалга ${p.reference}: ${p.statusLabel}. ${p.explanation}`)
    if (p.type === 'appointment')
      lines.push(
        `${p.summary.reference}: ${p.summary.dateLabel} ${p.summary.timeRange}, ${p.summary.services.join(', ')}`,
      )
    if (p.type === 'change') {
      lines.push(
        `${p.summary.reference}: ${p.summary.from}${p.summary.to ? ` → ${p.summary.to}` : ''}. ${p.summary.note}`,
      )
      chips.push(
        {
          title: 'Өөрчлөлт батлах',
          payload: `action:${JSON.stringify({ type: 'confirm_change', draftId: p.draftId })}`,
        },
        { title: 'Болих', payload: `action:${JSON.stringify({ type: 'cancel_change', draftId: p.draftId })}` },
      )
    }
  }
  const text = lines.filter(Boolean).join('\n\n').trim()
  return text ? { text, suggestions: chips } : null
}

async function context(db: Database): Promise<ServiceContext> {
  return { db, salonId: await resolveSalonId(db), actor: null, now: new Date(), ipHash: null }
}

export const suvdMetaAdapter: MetaAdapter = {
  async answer(db, input) {
    const ctx = await context(db)
    const visitorHash = metaVisitorHash(input.platform, input.accountId, input.senderId)
    if (!(await hitRateLimit(db, LIMITS.messenger, visitorHash))) return null
    const request = requestFor(input.text, engineMessageId(input.messageId))
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await handleChat(ctx, request, { channel: input.platform, visitorHash, demoVisitorHash: null })
        if (result.status === 'staff') return null // a person has taken over: the message waits for them
        return toMetaReply(result.messages.filter((m) => m.role === 'assistant').flatMap((m) => m.parts))
      } catch (err) {
        // Two messages in a row: the first turn holds the conversation for a moment.
        if (err instanceof ServiceError && err.code === 'busy' && attempt < 3) {
          await new Promise((r) => setTimeout(r, 2_000))
          continue
        }
        throw err
      }
    }
  },

  async staffReplied(db, input) {
    const ctx = await context(db)
    const visitorHash = metaVisitorHash(input.platform, input.accountId, input.customerId)
    const [session] = await db
      .select()
      .from(t.chatSessions)
      .where(
        and(
          eq(t.chatSessions.salonId, ctx.salonId),
          eq(t.chatSessions.channel, input.platform),
          eq(t.chatSessions.visitorHash, visitorHash),
        ),
      )
      .orderBy(desc(t.chatSessions.lastMessageAt))
      .limit(1)
    if (!session) return
    const text = input.text || '(Ажилтан Meta-ийн inbox-оос хариулсан)'
    await db.insert(t.chatMessages).values({
      sessionId: session.id,
      role: 'staff',
      content: text,
      meta: { parts: [{ type: 'staff', text, name: 'Meta inbox' }] },
      createdAt: input.at,
    })
    // A person is answering: the assistant stays quiet until hand-back (or the configured idle time passes).
    await db
      .update(t.chatSessions)
      .set({
        status: 'staff',
        lastStaffAt: input.at,
        lastMessageAt: input.at,
        messageCount: session.messageCount + 1,
        resolvedAt: null,
      })
      .where(eq(t.chatSessions.id, session.id))
  },

  commentReply:
    'Сайн байна уу! Сэтгэгдэл бичсэнд баярлалаа. Үйлчилгээ, үнэ, сул цагийн талаар энд, Messenger-ээр асуугаарай — шууд хариулъя. (Сувд бол Ursgal Digital-ын портфолио демо салон.)',
  attachmentReply:
    'Зургийг тань хүлээн авлаа. Би бичвэрт хариулдаг тул ямар үйлчилгээ, хэзээ сонирхож байгаагаа бичээрэй. Ажилтантай ярих бол «ажилтан» гэж бичнэ үү.',
}
