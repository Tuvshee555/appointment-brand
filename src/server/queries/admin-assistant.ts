// Read models for the admin «AI туслах» section: overview, conversations, knowledge, analytics,
// activity and problems. Test-chat sessions are kept out of the statistics.
import 'server-only'
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { addDays, dateKeyOf, dayBounds } from '@/lib/datetime'
import { MODEL_OPTIONS, providerConfigured, resolveModel } from '@/server/assistant/engine/model'
import { loadAssistantSettings } from '@/server/assistant/settings'
import { spentTodayUsd } from '@/server/assistant/usage'
import { db } from '@/server/db'
import * as t from '@/server/db/schema'

export const EVENT_LABELS: Record<string, string> = {
  booking_created: 'Захиалга үүсгэсэн',
  booking_simulated: 'Туршилтын захиалга (хадгалаагүй)',
  booking_failed: 'Захиалга амжилтгүй',
  cancel_done: 'Захиалга цуцалсан',
  cancel_simulated: 'Туршилтын цуцлалт',
  cancel_failed: 'Цуцлалт амжилтгүй',
  reschedule_done: 'Цаг өөрчилсөн',
  reschedule_simulated: 'Туршилтын цаг өөрчлөлт',
  reschedule_failed: 'Цаг өөрчлөлт амжилтгүй',
  verify_ok: 'Захиалга эзэмшигчийг баталгаажуулсан',
  verify_failed: 'Дугаар, утас таараагүй',
  verify_rate_limited: 'Баталгаажуулах оролдлогын хязгаар',
  time_unavailable: 'Хүссэн цаг сул биш',
  handoff: 'Ажилтанд шилжүүлсэн',
  unsupported: 'Хариулж чадаагүй асуулт',
  unanswered_topic: 'Нийтлээгүй мэдээлэл асуусан',
  not_offered: 'Байхгүй үйлчилгээ асуусан',
  knowledge_answer: 'Мэдлэгийн сангаас хариулсан',
  privacy_refused: 'Хувийн мэдээлэл өгөхөөс татгалзсан',
  payment_claim: '«Төлсөн» гэж мэдэгдсэн',
  model_interpreted: 'AI мессеж уншсан',
  model_answered: 'AI хариулт (шалгалт давсан)',
  model_referred: 'AI мэдээлэл олоогүй',
  model_rejected: 'AI хариулт шалгалтад унасан',
  model_error: 'AI загварын алдаа',
  budget_exceeded: 'AI өдрийн төсөв дууссан',
  engine_error: 'Системийн алдаа',
  backend_timeout: 'Системийн удаашрал',
  bot_resumed: 'Туслах автоматаар үргэлжилсэн',
  staff_takeover: 'Ажилтан хариулж эхэлсэн',
  staff_handback: 'Туслахад буцаасан',
  conversation_resolved: 'Шийдвэрлэсэн',
}

export const HANDOFF_LABELS: Record<string, string> = {
  customer_request: 'Хүнтэй ярих хүсэлт',
  complaint: 'Гомдол',
  payment_claim: 'Төлбөрийн асуудал',
  unanswered: 'Хариулж чадаагүй',
  verification: 'Баталгаажуулалт',
  system_error: 'Системийн алдаа',
}

export const STATUS_LABELS_CHAT: Record<string, string> = {
  bot: 'Туслах',
  handoff: 'Ажилтан хүлээж буй',
  staff: 'Ажилтан хариулж буй',
  closed: 'Шийдвэрлэсэн',
}

const live = (salonId: string) => and(eq(t.chatSessions.salonId, salonId), eq(t.chatSessions.isTest, false))

export async function assistantOverview(salonId: string, now: Date) {
  const settings = await loadAssistantSettings(db, salonId)
  const today = dateKeyOf(now)
  const weekAgo = dayBounds(addDays(today, -6)).start
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000)
  const [conversations7, waiting, staff, bookings7, problems24, spent] = await Promise.all([
    db.$count(t.chatSessions, and(live(salonId), gte(t.chatSessions.createdAt, weekAgo))),
    db.$count(t.chatSessions, and(live(salonId), eq(t.chatSessions.status, 'handoff'))),
    db.$count(t.chatSessions, and(live(salonId), eq(t.chatSessions.status, 'staff'))),
    db.$count(
      t.assistantEvents,
      and(
        eq(t.assistantEvents.salonId, salonId),
        eq(t.assistantEvents.kind, 'booking_created'),
        gte(t.assistantEvents.createdAt, weekAgo),
      ),
    ),
    db.$count(
      t.assistantEvents,
      and(
        eq(t.assistantEvents.salonId, salonId),
        eq(t.assistantEvents.isTest, false),
        inArray(t.assistantEvents.level, ['warning', 'error']),
        gte(t.assistantEvents.createdAt, dayAgo),
      ),
    ),
    spentTodayUsd(db, now),
  ])
  const model = resolveModel({ provider: settings.provider, model: settings.model })
  return {
    settings,
    model,
    keys: { openai: providerConfigured('openai'), anthropic: providerConfigured('anthropic') },
    conversations7,
    waiting,
    staff,
    bookings7,
    problems24,
    spent,
    messenger: Boolean(
      process.env.MESSENGER_PAGE_TOKEN && process.env.MESSENGER_APP_SECRET && process.env.MESSENGER_VERIFY_TOKEN,
    ),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    demoMode: process.env.DEMO_MODE === 'true',
  }
}

export type ConversationFilter = 'all' | 'attention' | 'staff' | 'booked' | 'test'

export async function listConversations(salonId: string, filter: ConversationFilter, page: number, pageSize: number) {
  const where = and(
    eq(t.chatSessions.salonId, salonId),
    filter === 'test' ? eq(t.chatSessions.isTest, true) : eq(t.chatSessions.isTest, false),
    filter === 'attention' ? eq(t.chatSessions.status, 'handoff') : undefined,
    filter === 'staff' ? eq(t.chatSessions.status, 'staff') : undefined,
    filter === 'booked' ? sql`${t.chatSessions.appointmentId} is not null` : undefined,
  )
  const [rows, total] = await Promise.all([
    db
      .select({
        s: t.chatSessions,
        reference: t.appointments.reference,
      })
      .from(t.chatSessions)
      .leftJoin(t.appointments, eq(t.appointments.id, t.chatSessions.appointmentId))
      .where(where)
      .orderBy(desc(t.chatSessions.lastMessageAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.$count(t.chatSessions, where),
  ])
  return { rows, total }
}

export async function conversationDetail(salonId: string, sessionId: string) {
  const [row] = await db
    .select({ s: t.chatSessions, reference: t.appointments.reference, assignee: t.adminUsers.name })
    .from(t.chatSessions)
    .leftJoin(t.appointments, eq(t.appointments.id, t.chatSessions.appointmentId))
    .leftJoin(t.adminUsers, eq(t.adminUsers.id, t.chatSessions.assignedAdminId))
    .where(and(eq(t.chatSessions.id, sessionId), eq(t.chatSessions.salonId, salonId)))
  if (!row) return null
  const [messages, events] = await Promise.all([
    db
      .select()
      .from(t.chatMessages)
      .where(eq(t.chatMessages.sessionId, sessionId))
      .orderBy(asc(t.chatMessages.createdAt)),
    db
      .select()
      .from(t.assistantEvents)
      .where(eq(t.assistantEvents.sessionId, sessionId))
      .orderBy(asc(t.assistantEvents.createdAt)),
  ])
  return { ...row, messages, events }
}

export async function listKnowledge(salonId: string) {
  return db
    .select()
    .from(t.assistantKnowledge)
    .where(eq(t.assistantKnowledge.salonId, salonId))
    .orderBy(asc(t.assistantKnowledge.sortOrder), asc(t.assistantKnowledge.createdAt))
}

export async function assistantAnalytics(salonId: string, now: Date, days: number) {
  const today = dateKeyOf(now)
  const from = addDays(today, -(days - 1))
  const since = dayBounds(from).start
  const dayExpr = (col: unknown) => sql<string>`to_char(${col} at time zone 'Asia/Ulaanbaatar', 'YYYY-MM-DD')`
  const [conversations, events, intents, modes, durations, usage, reasons] = await Promise.all([
    db
      .select({
        day: dayExpr(t.chatSessions.createdAt),
        n: sql<number>`count(*)::int`,
        booked: sql<number>`count(${t.chatSessions.appointmentId})::int`,
      })
      .from(t.chatSessions)
      .where(and(live(salonId), gte(t.chatSessions.createdAt, since)))
      .groupBy(sql`1`),
    db
      .select({
        kind: t.assistantEvents.kind,
        day: dayExpr(t.assistantEvents.createdAt),
        n: sql<number>`count(*)::int`,
      })
      .from(t.assistantEvents)
      .where(
        and(
          eq(t.assistantEvents.salonId, salonId),
          eq(t.assistantEvents.isTest, false),
          gte(t.assistantEvents.createdAt, since),
        ),
      )
      .groupBy(t.assistantEvents.kind, sql`2`),
    db
      .select({ intent: sql<string>`${t.chatMessages.meta}->>'intent'`, n: sql<number>`count(*)::int` })
      .from(t.chatMessages)
      .innerJoin(t.chatSessions, eq(t.chatSessions.id, t.chatMessages.sessionId))
      .where(and(live(salonId), eq(t.chatMessages.role, 'assistant'), gte(t.chatMessages.createdAt, since)))
      .groupBy(sql`1`)
      .orderBy(sql`2 desc`)
      .limit(14),
    db
      .select({ mode: sql<string>`coalesce(${t.chatMessages.meta}->>'mode', 'rules')`, n: sql<number>`count(*)::int` })
      .from(t.chatMessages)
      .innerJoin(t.chatSessions, eq(t.chatSessions.id, t.chatMessages.sessionId))
      .where(and(live(salonId), eq(t.chatMessages.role, 'assistant'), gte(t.chatMessages.createdAt, since)))
      .groupBy(sql`1`),
    db
      .select({
        avg: sql<number>`coalesce(avg((${t.chatMessages.meta}->>'durationMs')::int), 0)::int`,
        p95: sql<number>`coalesce(percentile_disc(0.95) within group (order by (${t.chatMessages.meta}->>'durationMs')::int), 0)::int`,
      })
      .from(t.chatMessages)
      .innerJoin(t.chatSessions, eq(t.chatSessions.id, t.chatMessages.sessionId))
      .where(
        and(
          live(salonId),
          eq(t.chatMessages.role, 'assistant'),
          gte(t.chatMessages.createdAt, since),
          sql`${t.chatMessages.meta} ? 'durationMs'`,
        ),
      ),
    db.select().from(t.assistantUsage).where(gte(t.assistantUsage.day, from)).orderBy(asc(t.assistantUsage.day)),
    db
      .select({ reason: t.chatSessions.handoffReason, n: sql<number>`count(*)::int` })
      .from(t.chatSessions)
      .where(and(live(salonId), gte(t.chatSessions.createdAt, since), sql`${t.chatSessions.handoffReason} is not null`))
      .groupBy(t.chatSessions.handoffReason),
  ])
  const count = (kind: string) => events.filter((e) => e.kind === kind).reduce((a, e) => a + e.n, 0)
  const series = Array.from({ length: days }, (_, i) => {
    const day = addDays(from, i)
    return {
      day,
      conversations: conversations.find((c) => c.day === day)?.n ?? 0,
      bookings: events.filter((e) => e.day === day && e.kind === 'booking_created').reduce((a, e) => a + e.n, 0),
      handoffs: events.filter((e) => e.day === day && e.kind === 'handoff').reduce((a, e) => a + e.n, 0),
    }
  })
  const totalConversations = conversations.reduce((a, c) => a + c.n, 0)
  const booked = conversations.reduce((a, c) => a + c.booked, 0)
  const byModel = new Map<string, { calls: number; failures: number; input: number; output: number; cost: number }>()
  for (const u of usage) {
    const key = `${u.model}${u.source.startsWith('test-') ? ' (туршилт)' : ''}`
    const m = byModel.get(key) ?? { calls: 0, failures: 0, input: 0, output: 0, cost: 0 }
    m.calls += u.calls
    m.failures += u.failures
    m.input += u.inputTokens
    m.output += u.outputTokens
    m.cost += u.costUsd
    byModel.set(key, m)
  }
  return {
    days,
    series,
    totals: {
      conversations: totalConversations,
      booked,
      conversion: totalConversations ? booked / totalConversations : 0,
      bookings: count('booking_created'),
      cancels: count('cancel_done'),
      reschedules: count('reschedule_done'),
      handoffs: count('handoff'),
      unanswered: count('unsupported') + count('unanswered_topic'),
      knowledgeAnswers: count('knowledge_answer'),
      modelAnswers: count('model_answered'),
    },
    intents,
    modes,
    durations: durations[0] ?? { avg: 0, p95: 0 },
    usage: [...byModel.entries()].map(([model, v]) => ({ model, ...v })),
    usageCost: usage.reduce((a, u) => a + u.costUsd, 0),
    reasons,
    prices: MODEL_OPTIONS,
  }
}

export async function assistantActivity(salonId: string, page: number, pageSize: number) {
  const where = eq(t.assistantEvents.salonId, salonId)
  const [events, total, audits] = await Promise.all([
    db
      .select({ e: t.assistantEvents, reference: t.appointments.reference })
      .from(t.assistantEvents)
      .leftJoin(t.appointments, eq(t.appointments.id, t.assistantEvents.appointmentId))
      .where(where)
      .orderBy(desc(t.assistantEvents.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.$count(t.assistantEvents, where),
    page === 1
      ? db
          .select({ a: t.auditLog, name: t.adminUsers.name })
          .from(t.auditLog)
          .leftJoin(t.adminUsers, eq(t.adminUsers.id, t.auditLog.adminUserId))
          .where(and(eq(t.auditLog.salonId, salonId), eq(t.auditLog.entity, 'assistant')))
          .orderBy(desc(t.auditLog.createdAt))
          .limit(20)
      : Promise.resolve([]),
  ])
  return { events, total, audits }
}

export async function assistantProblems(salonId: string, now: Date, days: number) {
  const since = new Date(now.getTime() - days * 24 * 3_600_000)
  const where = and(
    eq(t.assistantEvents.salonId, salonId),
    eq(t.assistantEvents.isTest, false),
    inArray(t.assistantEvents.level, ['warning', 'error']),
    gte(t.assistantEvents.createdAt, since),
  )
  const [byKind, latest] = await Promise.all([
    db
      .select({ kind: t.assistantEvents.kind, level: t.assistantEvents.level, n: sql<number>`count(*)::int` })
      .from(t.assistantEvents)
      .where(where)
      .groupBy(t.assistantEvents.kind, t.assistantEvents.level)
      .orderBy(sql`3 desc`),
    db
      .select({ e: t.assistantEvents, question: t.chatMessages.content, meta: t.chatMessages.meta })
      .from(t.assistantEvents)
      .leftJoin(
        t.chatMessages,
        and(
          eq(t.chatMessages.sessionId, t.assistantEvents.sessionId),
          eq(t.chatMessages.createdAt, t.assistantEvents.createdAt),
          eq(t.chatMessages.role, 'user'),
        ),
      )
      .where(where)
      .orderBy(desc(t.assistantEvents.createdAt))
      .limit(60),
  ])
  return { byKind, latest }
}
