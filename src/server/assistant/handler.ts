// The one entry point for customer messages (website widget, Messenger, the admin «Try it» chat).
// This is the persistence around a turn (Lorentz handler.ts): the session, a repeated send
// returning the stored reply, a short per-conversation lease, staff takeover with automatic
// hand-back, the model and its daily budget, saving messages and events, and the staff alert
// on a hand-over. The conversation itself is runTurn() in turn.ts.
import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'
import type { ChatAction, ChatMessage, ChatPart, ChatResponse, ConversationStatus } from '@/lib/assistant/types'
import { dateKeyOf } from '@/lib/datetime'
import * as t from '@/server/db/schema'
import { ServiceError, type ServiceContext } from '@/server/context'
import { deliverNotification, queueStaffAlert } from '@/server/notifications'
import { createModelCaller, resolveModel, type ModelCaller } from './engine/model'
import { createModelPorts } from './models'
import { createSalonPort } from './salon/adapter'
import type { SalonPort } from './salon/port'
import { loadAssistantSettings } from './settings'
import {
  runTurn,
  type AssistantState,
  type HistoryLine,
  type ModelPorts,
  type TurnEvent,
  type TurnOutput,
} from './turn'
import { recordModelUsage, spentTodayUsd, withinBudget } from './usage'

export interface ChatChannel {
  channel: 'web' | 'messenger' | 'test'
  /** Hashed visitor cookie, Messenger sender id or admin id — never the raw id. */
  visitorHash: string
  /** Demo visitor link so a chat booking shows as "your test" in the demo admin. */
  demoVisitorHash: string | null
}

export interface ChatRequest {
  message?: string
  action?: ChatAction
  /** The widget's id for this send; a repeat returns the stored reply instead of a second turn. */
  clientMessageId?: string | null
}

export interface ChatTurnResult extends ChatResponse {
  sessionId: string
  /** References the visitor proved or created (the web route grants them the booking page). */
  grantReferences: string[]
  intent?: string
  events?: string[]
}

export interface HandlerDeps {
  /** null disables the model (tests); undefined uses the production caller. */
  caller?: ModelCaller | null
  /** Time limit for each read (catalogue, availability); writes are never abandoned. */
  readTimeoutMs?: number
}

const LEASE_MS = 30_000
const SESSION_IDLE_MS = 24 * 3_600_000
const HISTORY_MESSAGES = 12

type SessionRow = typeof t.chatSessions.$inferSelect

async function findSession(ctx: ServiceContext, ch: ChatChannel): Promise<SessionRow | null> {
  const [row] = await ctx.db
    .select()
    .from(t.chatSessions)
    .where(
      and(
        eq(t.chatSessions.salonId, ctx.salonId),
        eq(t.chatSessions.visitorHash, ch.visitorHash),
        eq(t.chatSessions.channel, ch.channel),
        gt(t.chatSessions.lastMessageAt, new Date(ctx.now.getTime() - SESSION_IDLE_MS)),
      ),
    )
    .orderBy(desc(t.chatSessions.lastMessageAt))
    .limit(1)
  return row ?? null
}

async function openSession(ctx: ServiceContext, ch: ChatChannel, fresh: boolean): Promise<SessionRow> {
  if (!fresh) {
    const existing = await findSession(ctx, ch)
    if (existing) return existing
  }
  const [salon] = await ctx.db.select({ isDemo: t.salons.isDemo }).from(t.salons).where(eq(t.salons.id, ctx.salonId))
  const [row] = await ctx.db
    .insert(t.chatSessions)
    .values({
      salonId: ctx.salonId,
      channel: ch.channel,
      visitorHash: ch.visitorHash,
      state: { v: 2, turns: 0 },
      isDemo: salon?.isDemo ?? false,
      isTest: ch.channel === 'test',
      createdAt: ctx.now,
      lastMessageAt: ctx.now,
    })
    .returning()
  return row
}

/** Parts as stored: the private booking link is shown once and never kept with the message. */
function storedParts(parts: ChatPart[]): ChatPart[] {
  return parts.map((p) => (p.type === 'booking' ? { ...p, link: null } : p))
}

/** Plain text of a reply, for the admin transcript and the model's context. */
export function plainText(parts: ChatPart[]): string {
  return parts
    .map((p) => {
      switch (p.type) {
        case 'text':
        case 'handoff':
        case 'staff':
        case 'notice':
          return p.text
        case 'slots':
          return `(${p.dateLabel}: ${p.slots.map((s) => s.label).join(', ')})`
        case 'draft':
          return `(Хураангуй: ${p.summary.dateLabel} ${p.summary.timeRange}, ${p.summary.services.map((s) => s.name).join(' + ')} — баталгаажуулаагүй)`
        case 'booking':
          return `(Захиалга ${p.reference}: ${p.statusLabel})`
        case 'appointment':
          return `(Захиалга ${p.summary.reference}: ${p.summary.dateLabel} ${p.summary.timeRange})`
        case 'change':
          return `(${p.summary.kind === 'cancel' ? 'Цуцлах' : 'Цаг өөрчлөх'} хүсэлт: ${p.summary.reference})`
        default:
          return ''
      }
    })
    .filter(Boolean)
    .join('\n')
}

function withReadTimeouts(port: SalonPort, ms: number): SalonPort {
  const guard =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> =>
      new Promise<R>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new ServiceError('timeout', 'Систем түр удааширлаа. Хэсэг хүлээгээд дахин бичнэ үү.')),
          ms,
        )
        fn(...args).then(
          (v) => {
            clearTimeout(timer)
            resolve(v)
          },
          (e) => {
            clearTimeout(timer)
            reject(e)
          },
        )
      })
  return {
    ...port,
    snapshot: guard(port.snapshot),
    quote: guard(port.quote),
    day: guard(port.day),
    openDays: guard(port.openDays),
    getBooking: guard(port.getBooking),
    rescheduleOptions: guard(port.rescheduleOptions),
  }
}

async function salonPhone(ctx: ServiceContext): Promise<string | null> {
  try {
    const [row] = await ctx.db
      .select({ phone: t.businessSettings.phone })
      .from(t.businessSettings)
      .where(eq(t.businessSettings.salonId, ctx.salonId))
    return row?.phone ?? null
  } catch {
    return null
  }
}

function failureTurn(state: AssistantState, phone: string | null, err: unknown): TurnOutput {
  const timeout = err instanceof ServiceError && err.code === 'timeout'
  const call = phone ? ` Яаралтай бол ${phone.slice(0, 4)} ${phone.slice(4)} руу залгаарай.` : ''
  return {
    parts: [
      {
        type: 'text',
        text: timeout
          ? `Систем түр удааширлаа — таны хүсэлтийг гүйцээж чадсангүй. Хэсэг хүлээгээд дахин бичнэ үү.${call}`
          : `Уучлаарай, систем түр саатлаа — таны хүсэлтийг гүйцээж чадсангүй. Дахин бичнэ үү.${call}`,
      },
    ],
    state,
    intent: 'error',
    events: [
      {
        kind: timeout ? 'backend_timeout' : 'engine_error',
        level: 'error',
        detail: {
          error: err instanceof Error ? err.name : typeof err,
          code: err instanceof ServiceError ? err.code : null,
        },
      },
    ],
    grantReferences: [],
    usedModel: false,
  }
}

function toMessage(row: typeof t.chatMessages.$inferSelect): ChatMessage {
  const meta = (row.meta ?? {}) as { parts?: ChatPart[] }
  const role = row.role === 'user' ? 'user' : row.role === 'staff' ? 'staff' : 'assistant'
  const parts: ChatPart[] =
    role === 'user' ? [{ type: 'text', text: row.content }] : (meta.parts ?? [{ type: 'text', text: row.content }])
  return { id: row.id, role, parts, createdAt: row.createdAt.toISOString() }
}

/** The visitor's current conversation (for reopening the widget and for staff replies). */
export async function loadChatHistory(
  ctx: ServiceContext,
  ch: ChatChannel,
  after?: Date | null,
): Promise<{ messages: ChatMessage[]; status: ConversationStatus } | null> {
  const session = await findSession(ctx, ch)
  if (!session) return null
  const rows = await ctx.db
    .select()
    .from(t.chatMessages)
    .where(and(eq(t.chatMessages.sessionId, session.id), after ? gt(t.chatMessages.createdAt, after) : undefined))
    .orderBy(desc(t.chatMessages.createdAt))
    .limit(60)
  return { messages: rows.reverse().map(toMessage), status: session.status as ConversationStatus }
}

export async function handleChat(
  ctx: ServiceContext,
  req: ChatRequest,
  ch: ChatChannel,
  deps: HandlerDeps = {},
): Promise<ChatTurnResult> {
  const started = Date.now()
  const text = req.message?.trim().slice(0, 500) || undefined
  const clientId = req.clientMessageId?.trim().slice(0, 80) || null
  const settings = await loadAssistantSettings(ctx.db, ctx.salonId)
  let session = await openSession(ctx, ch, req.action?.type === 'reset')

  // A repeated send (double click, network retry, Meta webhook retry) returns the stored reply.
  let existingUserMessage = false
  if (clientId && text) {
    const [prior] = await ctx.db
      .select()
      .from(t.chatMessages)
      .where(and(eq(t.chatMessages.sessionId, session.id), eq(t.chatMessages.clientMessageId, clientId)))
    if (prior) {
      if (prior.content !== text) throw new ServiceError('message_id_reused', 'Мессежийг дахин илгээнэ үү.')
      existingUserMessage = true
      const [reply] = await ctx.db
        .select()
        .from(t.chatMessages)
        .where(
          and(
            eq(t.chatMessages.sessionId, session.id),
            eq(t.chatMessages.role, 'assistant'),
            sql`${t.chatMessages.meta}->>'replyTo' = ${clientId}`,
          ),
        )
      if (reply || session.status === 'staff')
        return {
          sessionId: session.id,
          messages: reply ? [toMessage(reply)] : [],
          mode: ((reply?.meta as { mode?: 'ai' | 'rules' } | null)?.mode ?? 'rules') as 'ai' | 'rules',
          status: session.status as ConversationStatus,
          grantReferences: [],
        }
    }
  }

  const owner = randomUUID()
  const leased = await ctx.db
    .update(t.chatSessions)
    .set({ leaseOwner: owner, leaseUntil: new Date(ctx.now.getTime() + LEASE_MS) })
    .where(
      and(
        eq(t.chatSessions.id, session.id),
        or(isNull(t.chatSessions.leaseUntil), lt(t.chatSessions.leaseUntil, ctx.now)),
      ),
    )
    .returning({ id: t.chatSessions.id })
  if (!leased.length)
    throw new ServiceError('busy', 'Өмнөх мессежийг боловсруулж байна. Түр хүлээгээд дахин илгээнэ үү.')

  try {
    if (text && !existingUserMessage) {
      // Contact details and phone numbers are hidden in the admin from anyone without contact access.
      const awaiting = (session.state as { awaiting?: string } | null)?.awaiting
      const sensitive = awaiting === 'contact' || awaiting === 'phone' || /\d{4}[\s-]?\d{4}/.test(text)
      await ctx.db.insert(t.chatMessages).values({
        sessionId: session.id,
        role: 'user',
        content: text,
        clientMessageId: clientId,
        meta: sensitive ? { sensitive: true } : null,
        createdAt: ctx.now,
      })
    }

    const events: TurnEvent[] = []
    // A person took the conversation over: keep the message for them, unless they went quiet.
    if (session.status === 'staff') {
      const last = session.lastStaffAt ?? session.handoffAt
      const hours = settings.handoverAutoResumeHours
      if (hours > 0 && last && ctx.now.getTime() - last.getTime() > hours * 3_600_000) {
        ;[session] = await ctx.db
          .update(t.chatSessions)
          .set({ status: 'bot', assignedAdminId: null })
          .where(eq(t.chatSessions.id, session.id))
          .returning()
        events.push({ kind: 'bot_resumed', level: 'info', detail: { hours } })
      } else {
        await ctx.db
          .update(t.chatSessions)
          .set({ lastMessageAt: ctx.now, messageCount: session.messageCount + (text ? 1 : 0) })
          .where(eq(t.chatSessions.id, session.id))
        return { sessionId: session.id, messages: [], mode: 'rules', status: 'staff', grantReferences: [] }
      }
    }

    const state = (session.state ?? {}) as unknown as AssistantState
    let out: TurnOutput
    if (!settings.enabled) {
      const phone = await salonPhone(ctx)
      out = {
        parts: [
          {
            type: 'text',
            text: `Туслах түр ажиллахгүй байна.${phone ? ` ${phone.slice(0, 4)} ${phone.slice(4)} руу залгаж асуугаарай.` : ''}`,
          },
        ],
        state,
        intent: 'disabled',
        events: [],
        grantReferences: [],
        usedModel: false,
      }
    } else {
      const history = (
        await ctx.db
          .select({ role: t.chatMessages.role, content: t.chatMessages.content })
          .from(t.chatMessages)
          .where(eq(t.chatMessages.sessionId, session.id))
          .orderBy(desc(t.chatMessages.createdAt))
          .limit(HISTORY_MESSAGES + 1)
      )
        .reverse()
        .slice(0, text ? -1 : undefined)
        .map((m): HistoryLine => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.content }))

      let models: ModelPorts | undefined
      const option = resolveModel({ provider: settings.provider, model: settings.model })
      if (option && deps.caller !== null && (settings.useModelForUnderstanding || settings.useModelForAnswers)) {
        const spent = await spentTodayUsd(ctx.db, ctx.now)
        if (withinBudget(spent, settings.dailyBudgetUsd)) {
          models = createModelPorts({
            option,
            caller: deps.caller ?? createModelCaller(),
            understanding: settings.useModelForUnderstanding,
            answers: settings.useModelForAnswers,
            record: (u) =>
              recordModelUsage(ctx.db, ctx.now, {
                ...u,
                source: ch.channel === 'test' ? `test-${u.source}` : u.source,
              }),
            onEvent: (e) => events.push(e),
          })
        } else if (state.budgetNoticeDay !== dateKeyOf(ctx.now)) {
          state.budgetNoticeDay = dateKeyOf(ctx.now)
          events.push({
            kind: 'budget_exceeded',
            level: 'warning',
            detail: { spentUsd: Number(spent.toFixed(4)), budgetUsd: settings.dailyBudgetUsd },
          })
        }
      }

      const port = withReadTimeouts(
        createSalonPort(ctx, {
          simulate: ch.channel === 'test',
          demoVisitorHash: ch.demoVisitorHash,
          source: ch.channel === 'messenger' ? 'messenger' : 'assistant',
        }),
        deps.readTimeoutMs ?? 10_000,
      )
      try {
        out = await runTurn({
          text,
          action: req.action,
          state,
          history,
          port,
          now: ctx.now,
          models,
          settings: {
            englishReplies: settings.englishReplies,
            greeting: settings.greeting,
            handoverMessage: settings.handoverMessage,
          },
        })
      } catch (err) {
        console.error('[assistant] turn failed:', err instanceof Error ? `${err.name}: ${err.message}` : err)
        out = failureTurn(state, await salonPhone(ctx), err)
      }
    }
    events.push(...out.events)

    const mode = out.usedModel ? 'ai' : 'rules'
    const [saved] = await ctx.db
      .insert(t.chatMessages)
      .values({
        sessionId: session.id,
        role: 'assistant',
        content: plainText(out.parts),
        meta: {
          parts: storedParts(out.parts),
          mode,
          intent: out.intent,
          events: events.map((e) => e.kind),
          durationMs: Date.now() - started,
          replyTo: clientId,
          handoff: out.handoff?.reason ?? null,
        },
        createdAt: new Date(ctx.now.getTime() + 1),
      })
      .returning({ id: t.chatMessages.id })

    const handingOff = Boolean(out.handoff) && session.status === 'bot'
    const status: ConversationStatus = handingOff ? 'handoff' : (session.status as ConversationStatus)
    await ctx.db
      .update(t.chatSessions)
      .set({
        state: out.state as unknown as Record<string, unknown>,
        messageCount: session.messageCount + (text && !existingUserMessage ? 2 : 1),
        lastMessageAt: ctx.now,
        locale: out.state.locale ?? 'mn',
        handedOff: session.handedOff || Boolean(out.handoff),
        appointmentId: out.booked?.appointmentId ?? session.appointmentId,
        ...(handingOff
          ? { status: 'handoff', handoffReason: out.handoff!.reason, handoffAt: ctx.now, resolvedAt: null }
          : {}),
      })
      .where(eq(t.chatSessions.id, session.id))

    if (events.length) {
      await ctx.db.insert(t.assistantEvents).values(
        events.map((e) => ({
          salonId: ctx.salonId,
          sessionId: session.id,
          kind: e.kind.slice(0, 40),
          level: e.level ?? 'info',
          appointmentId: e.appointmentId ?? null,
          detail: e.detail ?? null,
          isDemo: session.isDemo,
          isTest: session.isTest,
          createdAt: ctx.now,
        })),
      )
    }

    if (handingOff && !session.isTest) {
      const id = await queueStaffAlert(ctx.db, {
        salonId: ctx.salonId,
        kind: 'assistant_handoff',
        subject: 'Чатад хүн хэрэгтэй',
        body: `Вэбсайтын чатад үйлчлүүлэгч ажилтантай холбогдохыг хүслээ (шалтгаан: ${out.handoff!.reason}). Админ → AI туслах → Харилцан яриа.`,
        isDemo: session.isDemo,
        dedupeKey: `chat:${session.id}:handoff:${dateKeyOf(ctx.now)}`,
      })
      await deliverNotification(ctx.db, id)
    }

    return {
      sessionId: session.id,
      messages: [{ id: saved.id, role: 'assistant', parts: out.parts }],
      mode,
      status,
      grantReferences: out.grantReferences,
      intent: out.intent,
      events: events.map((e) => e.kind),
    }
  } finally {
    await ctx.db
      .update(t.chatSessions)
      .set({ leaseOwner: null, leaseUntil: null })
      .where(and(eq(t.chatSessions.id, session.id), eq(t.chatSessions.leaseOwner, owner)))
  }
}

/** A staff member answers in the chat; the assistant stays quiet until hand-back. */
export async function postStaffReply(
  ctx: ServiceContext,
  input: { sessionId: string; text: string; adminUserId: string; staffName: string },
) {
  const [session] = await ctx.db
    .select()
    .from(t.chatSessions)
    .where(and(eq(t.chatSessions.id, input.sessionId), eq(t.chatSessions.salonId, ctx.salonId)))
  if (!session) throw new ServiceError('not_found', 'Яриа олдсонгүй.')
  const text = input.text.trim().slice(0, 1000)
  if (!text) throw new ServiceError('validation', 'Хариугаа бичнэ үү.')
  await ctx.db.insert(t.chatMessages).values({
    sessionId: session.id,
    role: 'staff',
    content: text,
    authorAdminId: input.adminUserId,
    meta: { parts: [{ type: 'staff', text, name: input.staffName }] },
    createdAt: ctx.now,
  })
  await ctx.db
    .update(t.chatSessions)
    .set({
      status: 'staff',
      assignedAdminId: input.adminUserId,
      lastStaffAt: ctx.now,
      lastMessageAt: ctx.now,
      messageCount: session.messageCount + 1,
      resolvedAt: null,
    })
    .where(eq(t.chatSessions.id, session.id))
}

/** Staff takes the conversation over, hands it back to the assistant, or marks it resolved. */
export async function setConversationStatus(
  ctx: ServiceContext,
  input: { sessionId: string; status: 'staff' | 'bot' | 'closed'; adminUserId: string },
) {
  const [session] = await ctx.db
    .select({ id: t.chatSessions.id, isDemo: t.chatSessions.isDemo, isTest: t.chatSessions.isTest })
    .from(t.chatSessions)
    .where(and(eq(t.chatSessions.id, input.sessionId), eq(t.chatSessions.salonId, ctx.salonId)))
  if (!session) throw new ServiceError('not_found', 'Яриа олдсонгүй.')
  await ctx.db
    .update(t.chatSessions)
    .set(
      input.status === 'staff'
        ? { status: 'staff', assignedAdminId: input.adminUserId, lastStaffAt: ctx.now, resolvedAt: null }
        : input.status === 'bot'
          ? { status: 'bot', assignedAdminId: null, resolvedAt: null }
          : { status: 'closed', resolvedAt: ctx.now },
    )
    .where(eq(t.chatSessions.id, session.id))
  await ctx.db.insert(t.assistantEvents).values({
    salonId: ctx.salonId,
    sessionId: session.id,
    kind:
      input.status === 'staff' ? 'staff_takeover' : input.status === 'bot' ? 'staff_handback' : 'conversation_resolved',
    level: 'info',
    detail: { adminUserId: input.adminUserId },
    isDemo: session.isDemo,
    isTest: session.isTest,
    createdAt: ctx.now,
  })
}

/** Oldest-first transcript of one conversation (admin). */
export async function loadTranscript(ctx: ServiceContext, sessionId: string) {
  const rows = await ctx.db
    .select()
    .from(t.chatMessages)
    .where(eq(t.chatMessages.sessionId, sessionId))
    .orderBy(asc(t.chatMessages.createdAt))
  return rows.map((r) => ({ ...toMessage(r), meta: r.meta as Record<string, unknown> | null, content: r.content }))
}
