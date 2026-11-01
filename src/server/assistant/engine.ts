// Conversation engine shared by the website chat and the (prepared)
// Messenger channel: session state, model-or-rules routing, guard fallback,
// and the explicit confirmation step that is the only way the assistant
// creates a booking.
import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gt } from 'drizzle-orm'
import type { ChatAction, ChatMessage, ChatPart, ChatResponse } from '@/lib/assistant/types'
import { STATUS_EXPLANATIONS, STATUS_LABELS } from '@/lib/booking/status'
import { formatDateKey, minutesToTime } from '@/lib/datetime'
import * as t from '@/server/db/schema'
import { ServiceError, type ServiceContext } from '@/server/context'
import { createBooking } from '@/server/services/booking'
import { aiConfigured, runModel, spentToday, underBudget } from './llm'
import { greeting, handleRuleAction, handleRuleText } from './rules'
import type { ChatState } from './tools'

const MAX_TURNS = 30

export interface ChatChannel {
  channel: 'web' | 'messenger'
  visitorHash: string
  /** Demo visitor link so a chat booking shows as "your test" in the demo admin. */
  demoVisitorHash: string | null
}

async function loadSession(ctx: ServiceContext, ch: ChatChannel, fresh: boolean) {
  if (!fresh) {
    const [row] = await ctx.db
      .select()
      .from(t.chatSessions)
      .where(
        and(
          eq(t.chatSessions.salonId, ctx.salonId),
          eq(t.chatSessions.visitorHash, ch.visitorHash),
          gt(t.chatSessions.lastMessageAt, new Date(ctx.now.getTime() - 24 * 3_600_000)),
        ),
      )
      .orderBy(desc(t.chatSessions.lastMessageAt))
      .limit(1)
    if (row) return row
  }
  const [salon] = await ctx.db.select({ isDemo: t.salons.isDemo }).from(t.salons).where(eq(t.salons.id, ctx.salonId))
  const [row] = await ctx.db
    .insert(t.chatSessions)
    .values({ salonId: ctx.salonId, channel: ch.channel, visitorHash: ch.visitorHash, state: {}, isDemo: salon?.isDemo ?? false, createdAt: ctx.now, lastMessageAt: ctx.now })
    .returning()
  return row
}

/** Plain-text rendering of an assistant message, used as history for the model. */
function historyText(parts: ChatPart[]): string {
  return parts
    .map((p) => {
      switch (p.type) {
        case 'text':
        case 'handoff':
          return p.text
        case 'slots':
          return `(Санал болгосон сул цаг, ${p.date}: ${p.slots.map((s) => s.label).join(', ')})`
        case 'draft':
          return `(Захиалгын хураангуй гаргасан: ${p.summary.dateLabel} ${p.summary.timeRange}, ${p.summary.services.map((s) => s.name).join(' + ')}. Үйлчлүүлэгч баталгаажуулаагүй.)`
        case 'booking':
          return `(Захиалга үүссэн: ${p.reference}, төлөв: ${p.statusLabel})`
        default:
          return ''
      }
    })
    .filter(Boolean)
    .join('\n')
}

async function confirmDraft(ctx: ServiceContext, state: ChatState, draftId: string, ch: ChatChannel): Promise<{ parts: ChatPart[]; appointmentId?: string }> {
  const draft = state.draft
  if (!draft || draft.id !== draftId) {
    return { parts: [{ type: 'text', text: 'Энэ хураангуй хүчингүй болсон байна. Цагаа дахин сонгоё.' }] }
  }
  if (new Date(draft.expiresAt) < ctx.now) {
    state.draft = undefined
    return { parts: [{ type: 'text', text: 'Хураангуйн хугацаа (15 минут) дууссан. Сул цагийг дахин шалгая.' }] }
  }
  const [salon] = await ctx.db.select({ isDemo: t.salons.isDemo }).from(t.salons).where(eq(t.salons.id, ctx.salonId))
  try {
    const result = await createBooking(
      ctx,
      { items: draft.items, staffId: draft.staffId, date: draft.date, start: draft.start, customer: { name: draft.name, phone: draft.phone, email: null, note: draft.note, preferences: null } },
      {
        source: ch.channel === 'messenger' ? 'messenger' : 'assistant',
        actor: 'assistant',
        publicRules: true,
        isDemo: salon?.isDemo ?? false,
        demoVisitorHash: ch.demoVisitorHash,
      },
    )
    state.draft = undefined
    return {
      appointmentId: result.appointmentId,
      parts: [
        {
          type: 'booking',
          reference: result.reference,
          status: result.status,
          statusLabel: STATUS_LABELS[result.status],
          explanation: STATUS_EXPLANATIONS[result.status],
          link: `/booking/${result.reference}?t=${encodeURIComponent(result.manageToken)}&new=1`,
        },
      ],
    }
  } catch (err) {
    if (err instanceof ServiceError) {
      state.draft = undefined
      const alts = (err.details as { alternatives?: { date: string; start: number }[] } | undefined)?.alternatives ?? []
      return {
        parts: [
          { type: 'text', text: err.message },
          ...(alts.length
            ? [
                {
                  type: 'quick_replies' as const,
                  options: alts.map((a) => ({ label: `${formatDateKey(a.date)} ${minutesToTime(a.start)}`, action: { type: 'choose_slot' as const, date: a.date, start: a.start } })),
                },
              ]
            : []),
        ],
      }
    }
    throw err
  }
}

export async function handleChat(ctx: ServiceContext, input: { message?: string; action?: ChatAction }, ch: ChatChannel): Promise<ChatResponse> {
  const reset = input.action?.type === 'reset'
  const session = await loadSession(ctx, ch, reset)
  const state = (session.state ?? {}) as ChatState
  let mode: ChatResponse['mode'] = 'rules'
  let parts: ChatPart[] = []
  let handoff = false
  let appointmentId: string | undefined

  if (input.message) {
    await ctx.db.insert(t.chatMessages).values({ sessionId: session.id, role: 'user', content: input.message, createdAt: ctx.now })
  }

  if ((state.turns ?? 0) >= MAX_TURNS && input.message) {
    parts = [{ type: 'handoff', text: 'Энэ ярианы хязгаарт хүрлээ. Шинээр эхлүүлэх эсвэл салон руу залгаарай.' }]
  } else if (input.action?.type === 'confirm_draft') {
    const r = await confirmDraft(ctx, state, input.action.draftId, ch)
    parts = r.parts
    appointmentId = r.appointmentId
  } else if (input.action?.type === 'cancel_draft') {
    state.draft = undefined
    parts = [{ type: 'text', text: 'Болиулав. Өөр цаг сонгох уу?' }, { type: 'quick_replies', options: [{ label: 'Сул цаг шалгах', message: 'Цаг захиалах' }] }]
  } else if (input.action) {
    const r = input.action.type === 'hello' && (state.turns ?? 0) === 0 ? await greeting(ctx) : await handleRuleAction(ctx, state, input.action)
    parts = r.parts
  } else if (input.message) {
    state.turns = (state.turns ?? 0) + 1
    const useModel = aiConfigured() && underBudget(await spentToday(ctx)) && !state.flow
    if (useModel) {
      try {
        const history = await ctx.db
          .select()
          .from(t.chatMessages)
          .where(eq(t.chatMessages.sessionId, session.id))
          .orderBy(asc(t.chatMessages.createdAt))
        const turns = history
          .slice(0, -1)
          .slice(-12)
          .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), text: m.content }))
          .filter((m) => m.text)
        const prices = await ctx.db.select({ price: t.services.price }).from(t.services).where(eq(t.services.salonId, ctx.salonId))
        const addonPrices = await ctx.db.select({ price: t.serviceAddons.price }).from(t.serviceAddons).where(eq(t.serviceAddons.salonId, ctx.salonId))
        const reply = await runModel(ctx, state, turns, input.message, [...prices, ...addonPrices].map((p) => p.price))
        if (reply.text && reply.grounded && !reply.refused) {
          mode = 'ai'
          parts = [{ type: 'text', text: reply.text }, ...reply.parts]
        }
      } catch (err) {
        console.error('[assistant] model call failed, using rules', err instanceof Error ? err.message : err)
      }
    }
    if (!parts.length) {
      const r = await handleRuleText(ctx, state, input.message)
      parts = r.parts
      handoff = Boolean(r.handoff)
    }
  }

  if (!parts.length) parts = (await greeting(ctx)).parts
  const message: ChatMessage = { id: randomUUID(), role: 'assistant', parts }
  await ctx.db.insert(t.chatMessages).values({
    sessionId: session.id,
    role: 'assistant',
    content: historyText(parts),
    meta: { parts, mode },
    createdAt: new Date(ctx.now.getTime() + 1),
  })
  await ctx.db
    .update(t.chatSessions)
    .set({
      state: state as Record<string, unknown>,
      messageCount: session.messageCount + (input.message ? 2 : 1),
      lastMessageAt: ctx.now,
      handedOff: session.handedOff || handoff,
      appointmentId: appointmentId ?? session.appointmentId,
    })
    .where(eq(t.chatSessions.id, session.id))
  return { messages: [message], mode }
}
