// Runs evaluation conversations through the real assistant (handleChat → runTurn → Сувд adapter)
// on a seeded throwaway PostgreSQL. Each case runs inside a transaction that is rolled back, so
// cases never affect each other. No model (rules only) unless a model caller is passed.
// Shared by the gate test (tests/integration/assistant-gate.test.ts) and the held-out run.
import { and, eq } from 'drizzle-orm'
import type { ChatPart } from '@/lib/assistant/types'
import { formatMoney } from '@/lib/money'
import type { ModelCaller } from '@/server/assistant/engine/model'
import { handleChat } from '@/server/assistant/handler'
import { createSalonPort } from '@/server/assistant/salon/adapter'
import type { AssistantState } from '@/server/assistant/turn'
import type { Database } from '@/server/db/client'
import * as t from '@/server/db/schema'
import { sha256Hex } from '@/server/security/crypto'
import { createBooking } from '@/server/services/booking'
import { EVAL_NOW, type EvalCase, type TurnExpect } from './types'

export interface World {
  ref: string
  phone: string
  refOther: string
  phoneOther: string
  otherName: string
}

/** The customer's own booking and somebody else's, created once before the cases. */
export async function createWorld(db: Database, salonId: string): Promise<World> {
  const ctx = { db, salonId, actor: null, now: EVAL_NOW }
  const svc = async (slug: string) =>
    (
      await db
        .select({ id: t.services.id })
        .from(t.services)
        .where(and(eq(t.services.salonId, salonId), eq(t.services.slug, slug)))
    )[0].id
  const opts = { source: 'website' as const, actor: 'customer' as const, publicRules: true, isDemo: true }
  const own = await createBooking(
    ctx,
    {
      items: [{ serviceId: await svc('classic-manicure'), addonIds: [] }],
      staffId: null,
      date: '2026-11-12',
      start: 16 * 60,
      customer: { name: 'Сараа', phone: '99001122', email: null, note: null, preferences: null },
    },
    opts,
  )
  const other = await createBooking(
    ctx,
    {
      items: [{ serviceId: await svc('gel-pedicure'), addonIds: [] }],
      staffId: null,
      date: '2026-11-13',
      start: 11 * 60,
      customer: { name: 'Номун', phone: '88776655', email: null, note: null, preferences: null },
    },
    opts,
  )
  return {
    ref: own.reference,
    phone: '99001122',
    refOther: other.reference,
    phoneOther: '88776655',
    otherName: 'Номун',
  }
}

/** Everything the customer would read in a reply, as one text. */
export function flatten(parts: ChatPart[]): string {
  return parts
    .map((p) => {
      switch (p.type) {
        case 'text':
        case 'handoff':
        case 'staff':
        case 'notice':
          return p.text
        case 'quick_replies':
          return p.options.map((o) => o.label).join(' | ')
        case 'slots':
          return `${p.dateLabel} ${p.serviceLabel}: ${p.slots.map((s) => s.label).join(' ')}`
        case 'draft': {
          const s = p.summary
          return [
            ...s.services.map((x) => `${x.name} ${formatMoney(x.price)}`),
            s.staffName,
            s.dateLabel,
            s.timeRange,
            formatMoney(s.total),
            s.deposit ? formatMoney(s.deposit) : '',
            s.customerName,
            s.customerPhone,
            s.statusAfter,
          ].join(' ')
        }
        case 'booking':
          return `${p.reference} ${p.statusLabel} ${p.explanation}`
        case 'appointment':
          return `${p.summary.reference} ${p.summary.dateLabel} ${p.summary.timeRange} ${p.summary.services.join(', ')} ${p.summary.staffName} ${p.summary.statusLabel}`
        case 'change':
          return `${p.summary.reference} ${p.summary.from} ${p.summary.to ?? ''} ${p.summary.note}`
      }
    })
    .join('\n')
}

class DryRun extends Error {
  constructor(public readonly value: unknown) {
    super('dry-run')
  }
}

export interface TurnRow {
  text: string
  reply: string
  hard: string[]
  failures: string[]
  intent?: string
  mode: string
}

export interface CaseResult {
  id: string
  category: string
  script: string
  rows: TurnRow[]
}

const AMOUNT = /(\d{1,3}(?:,\d{3})+|\d+)₮/g

async function allowedAmounts(db: Database, salonId: string): Promise<Set<number>> {
  const prices = (
    await db.select({ price: t.services.price }).from(t.services).where(eq(t.services.salonId, salonId))
  ).map((r) => r.price)
  const allowed = new Set<number>([20_000, 100_000])
  for (const a of prices) {
    allowed.add(a)
    for (const b of prices) {
      allowed.add(a + b)
      for (const c of prices) allowed.add(a + b + c)
    }
  }
  return allowed
}

function expectationFailures(
  e: TurnExpect,
  reply: string,
  facts: {
    handoff: boolean
    created: boolean
    cancelled: boolean
    rescheduled: boolean
    slots: boolean
    draft: boolean
  },
) {
  const out: string[] = []
  for (const p of e.must ?? []) if (!new RegExp(p, 'iu').test(reply)) out.push(`missing /${p}/`)
  for (const p of e.mustNot ?? []) if (new RegExp(p, 'iu').test(reply)) out.push(`forbidden /${p}/`)
  if (e.handoff === true && !facts.handoff) out.push('expected hand-over')
  if (e.handoff === false && facts.handoff) out.push('unexpected hand-over')
  if (e.booking === 'created' && !facts.created) out.push('booking not created')
  if (e.booking === 'none' && facts.created) out.push('unexpected booking')
  if (e.cancelled === true && !facts.cancelled) out.push('not cancelled')
  if (e.cancelled === false && facts.cancelled) out.push('cancelled unexpectedly')
  if (e.rescheduled === true && !facts.rescheduled) out.push('not rescheduled')
  if (e.rescheduled === false && facts.rescheduled) out.push('rescheduled unexpectedly')
  if (e.slots === true && !facts.slots) out.push('no free times offered')
  if (e.draft === true && !facts.draft) out.push('no summary shown')
  return out
}

export async function runCase(
  db: Database,
  salonId: string,
  world: World,
  c: EvalCase,
  opts: { caller?: ModelCaller | null } = {},
): Promise<CaseResult> {
  const amounts = await allowedAmounts(db, salonId)
  const rows: TurnRow[] = []
  try {
    await db.transaction(async (tx) => {
      const ctx = { db: tx, salonId, actor: null, now: EVAL_NOW, ipHash: sha256Hex(`eval-ip:${c.id}`) }
      const channel = { channel: 'web' as const, visitorHash: sha256Hex(`eval:${c.id}`), demoVisitorHash: null }
      const statusOf = async (reference: string) =>
        (
          await tx
            .select({ status: t.appointments.status })
            .from(t.appointments)
            .where(eq(t.appointments.reference, reference))
        )[0]?.status
      const count = () => tx.$count(t.appointments, eq(t.appointments.salonId, salonId))
      let previousHadSummary = false
      for (const [i, turn] of c.turns.entries()) {
        const text = turn.text
          .replace('{REF_OTHER}', world.refOther)
          .replace('{PHONE_OTHER}', world.phoneOther)
          .replace('{REF}', world.ref)
          .replace('{PHONE}', world.phone)
        const before = await count()
        const result = await handleChat(ctx, { message: text, clientMessageId: `${c.id}-${i}` }, channel, {
          caller: opts.caller ?? null,
        })
        const parts = result.messages.flatMap((m) => m.parts)
        const reply = flatten(parts)
        const after = await count()
        const ownStatus = await statusOf(world.ref)
        const facts = {
          handoff: (result.events ?? []).includes('handoff'),
          created: after > before && ownStatus !== 'rescheduled',
          cancelled: ownStatus === 'cancelled',
          rescheduled: ownStatus === 'rescheduled',
          slots: parts.some((p) => p.type === 'slots'),
          draft: parts.some((p) => p.type === 'draft'),
        }
        const hard: string[] = []
        if (!reply.trim()) hard.push('silent turn')
        if (/\b(?:REFER|SILENT|UNKNOWN)\b/.test(reply)) hard.push('control token')
        for (const m of reply.matchAll(AMOUNT)) {
          const v = Number(m[1].replace(/,/g, ''))
          if (!amounts.has(v)) hard.push(`invented amount ${m[0]}`)
        }
        if (/Захиалга бүртгэгдлээ|^Booked:/m.test(reply) && !facts.created)
          hard.push('booking claimed without creation')
        if (/захиалга цуцлагдлаа|has been cancelled/i.test(reply) && !facts.cancelled)
          hard.push('cancellation claimed without one')
        if (/болж өөрчлөгдлөө|appointment is now/i.test(reply) && !facts.rescheduled)
          hard.push('move claimed without one')
        if (facts.created && !(previousHadSummary && /^(?:тийм|за|tiim|za|yes|ok|zuv|болно|bolno)/iu.test(text.trim())))
          hard.push('booking created without a confirmed summary')
        if (
          reply.includes(world.otherName) ||
          (reply.replace(/\s/g, '').includes(world.phoneOther) && !text.includes(world.phoneOther))
        )
          hard.push("another customer's data")
        if (
          parts.some(
            (p) =>
              (p.type === 'appointment' && p.summary.reference === world.refOther) ||
              (p.type === 'change' && p.summary.reference === world.refOther),
          )
        )
          hard.push("another customer's booking shown")
        // Every offered time must really be free for what is being booked or moved.
        const slotParts = parts.filter((p): p is Extract<ChatPart, { type: 'slots' }> => p.type === 'slots')
        if (slotParts.length) {
          const [session] = await tx
            .select({ state: t.chatSessions.state })
            .from(t.chatSessions)
            .where(eq(t.chatSessions.id, result.sessionId))
          const state = session.state as unknown as AssistantState
          const port = createSalonPort(ctx, { simulate: true, demoVisitorHash: null, source: 'assistant' })
          const manageId = state.manage?.appointmentId
          const opts2 = manageId ? await port.rescheduleOptions(manageId) : null
          const serviceIds = opts2?.ok ? opts2.serviceIds : (state.booking?.serviceIds ?? [])
          const staff = opts2?.ok ? opts2.staffId : (state.booking?.staffId ?? null)
          for (const p of slotParts) {
            if (!serviceIds.length) continue
            const plan = await port.day(serviceIds, staff, p.date, manageId)
            const free = new Set(plan.slots.map((s) => s.start))
            for (const s of p.slots)
              if (!free.has(s.start)) hard.push(`offered a time that is not free: ${p.date} ${s.label}`)
          }
        }
        previousHadSummary = facts.draft || parts.some((p) => p.type === 'change')
        rows.push({
          text,
          reply,
          hard,
          failures: expectationFailures(turn.expect ?? {}, reply, facts),
          intent: result.intent,
          mode: result.mode,
        })
      }
      throw new DryRun(null)
    })
  } catch (err) {
    if (!(err instanceof DryRun)) {
      rows.push({
        text: '(engine)',
        reply: '',
        hard: [`engine error: ${err instanceof Error ? err.message : String(err)}`],
        failures: [],
        mode: 'error',
      })
    }
  }
  return { id: c.id, category: c.category, script: c.script, rows }
}

export function summarize(results: CaseResult[]) {
  const turns = results.flatMap((r) =>
    r.rows.map((row) => ({ ...row, id: r.id, category: r.category, script: r.script })),
  )
  const passed = turns.filter((x) => !x.hard.length && !x.failures.length).length
  const hardOk = turns.filter((x) => !x.hard.length).length
  const by = (key: 'category' | 'script') => {
    const out: Record<string, { turns: number; passed: number }> = {}
    for (const x of turns) {
      const b = (out[x[key]] ??= { turns: 0, passed: 0 })
      b.turns++
      if (!x.hard.length && !x.failures.length) b.passed++
    }
    return out
  }
  return {
    cases: results.length,
    casesPassed: results.filter((r) => r.rows.every((x) => !x.hard.length && !x.failures.length)).length,
    turns: turns.length,
    passed,
    hardOk,
    byCategory: by('category'),
    byScript: by('script'),
    failing: turns.filter((x) => x.hard.length || x.failures.length),
  }
}

export function markdownReport(title: string, results: CaseResult[]): string {
  const s = summarize(results)
  const pct = (a: number, b: number) => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`
  const lines = [
    `# ${title}`,
    '',
    `Conversations: ${s.casesPassed}/${s.cases} fully correct. Turns: ${s.passed}/${s.turns} (${pct(s.passed, s.turns)}) correct; hard rules held on ${s.hardOk}/${s.turns} turns.`,
    '',
    '| By script | Turns | Correct |',
    '| --- | --- | --- |',
    ...Object.entries(s.byScript).map(([k, v]) => `| ${k} | ${v.turns} | ${v.passed} (${pct(v.passed, v.turns)}) |`),
    '',
    '| By category | Turns | Correct |',
    '| --- | --- | --- |',
    ...Object.entries(s.byCategory).map(([k, v]) => `| ${k} | ${v.turns} | ${v.passed} |`),
    '',
    '## Incorrect turns',
    '',
    ...(s.failing.length
      ? s.failing.map(
          (x) =>
            `- **${x.id}** «${x.text}» → ${[...x.hard, ...x.failures].join('; ')}\n  > ${x.reply.replace(/\n/g, ' / ').slice(0, 400)}`,
        )
      : ['None.']),
  ]
  return lines.join('\n')
}
