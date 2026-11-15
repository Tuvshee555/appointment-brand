// The assistant against the real booking services and PostgreSQL: concurrency, duplicates,
// authorization, failures of the model and the database, hand-over and the admin test chat.
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatRequestSchema } from '@/lib/assistant/schema'
import type { ChatPart } from '@/lib/assistant/types'
import { ModelError, type ModelCaller } from '@/server/assistant/engine/model'
import { handleChat, loadChatHistory, postStaffReply, type ChatChannel } from '@/server/assistant/handler'
import * as t from '@/server/db/schema'
import { sha256Hex } from '@/server/security/crypto'
import { createBooking } from '@/server/services/booking'
import { EVAL_NOW } from '../eval/types'
import { flatten } from '../eval/harness'
import { freshDatabase, serviceId, staffId, type TestDb } from './db'

let env: TestDb
let n = 0
const ctx = (now = EVAL_NOW, db = env.db) => ({
  db,
  salonId: env.salonId,
  actor: null,
  now,
  ipHash: sha256Hex(`ip-${++n}`),
})
const visitor = (name: string, channel: ChatChannel['channel'] = 'web'): ChatChannel => ({
  channel,
  visitorHash: sha256Hex(`visitor:${name}:${Math.random()}`),
  demoVisitorHash: null,
})
const say = async (
  ch: ChatChannel,
  message: string,
  opts: { now?: Date; caller?: ModelCaller | null; id?: string } = {},
) => {
  const r = await handleChat(ctx(opts.now), { message, clientMessageId: opts.id ?? `m-${++n}` }, ch, {
    caller: opts.caller ?? null,
  })
  return { ...r, text: flatten(r.messages.flatMap((m) => m.parts)), parts: r.messages.flatMap((m) => m.parts) }
}
const appointmentsAt = (staff: string, startsAtIso: string) =>
  env.db.$count(
    t.appointments,
    and(
      eq(t.appointments.staffId, staff),
      eq(t.appointments.startsAt, new Date(startsAtIso)),
      sql`${t.appointments.status} in ('pending','confirmed','awaiting_deposit')`,
    ),
  )

beforeAll(async () => {
  env = await freshDatabase()
})
afterAll(() => env.close())
afterEach(() => {
  vi.unstubAllEnvs()
})

/** Takes a conversation to the summary for Wednesday 11-11 at `time` with Солонго. */
async function toSummary(name: string, phone: string, time: string) {
  const ch = visitor(name)
  await say(ch, `margaash ${time} Solongo deer songodog manikyur`)
  const r = await say(ch, `${name} ${phone}`)
  expect(
    r.parts.some((p) => p.type === 'draft'),
    r.text,
  ).toBe(true)
  return ch
}

describe('double-booking protection', () => {
  it('two customers confirming the same slot at the same moment: exactly one booking', async () => {
    const solongo = await staffId(env.db, env.salonId, 'solongo')
    const a = await toSummary('Ану', '99110001', '15:00')
    const b = await toSummary('Болд', '99110002', '15:00')
    const [ra, rb] = await Promise.all([say(a, 'tiim'), say(b, 'tiim')])
    const booked = [ra, rb].filter((r) => /SV-[A-Z0-9]{6}/.test(r.text) && /бүртгэгдлээ/.test(r.text))
    const refused = [ra, rb].filter((r) => /дөнгөж сая захиалагдсан|боломжгүй/.test(r.text))
    expect(booked).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(await appointmentsAt(solongo, '2026-11-11T07:00:00Z')).toBe(1)
    // The refused customer is offered real alternatives, never told it is booked.
    expect(refused[0].text).not.toMatch(/бүртгэгдлээ/)
  })

  it('the same phone booking the same time twice (two chats, any specialist) is refused', async () => {
    const first = visitor('dup-1')
    await say(first, 'margaash 11 tsagt songodog manikyur')
    await say(first, 'Сараа 99110003')
    expect((await say(first, 'tiim')).text).toMatch(/бүртгэгдлээ/)
    const second = visitor('dup-2')
    await say(second, 'margaash 11 tsagt songodog manikyur')
    await say(second, 'Сараа 99110003')
    const r = await say(second, 'tiim')
    expect(r.text).toMatch(/давхцах захиалга/)
    expect(r.text).not.toMatch(/бүртгэгдлээ/)
    const rows = await env.db
      .select({ id: t.appointments.id })
      .from(t.appointments)
      .innerJoin(t.customers, eq(t.customers.id, t.appointments.customerId))
      .where(and(eq(t.customers.phone, '99110003'), eq(t.appointments.startsAt, new Date('2026-11-11T03:00:00Z'))))
    expect(rows).toHaveLength(1)
  })

  it('a repeated send returns the stored reply and never books twice', async () => {
    const ch = await toSummary('Дорж', '99110004', '16:30')
    const first = await say(ch, 'tiim', { id: 'confirm-1' })
    const again = await say(ch, 'tiim', { id: 'confirm-1' })
    expect(again.messages[0].id).toBe(first.messages[0].id)
    const solongo = await staffId(env.db, env.salonId, 'solongo')
    expect(await appointmentsAt(solongo, '2026-11-11T08:30:00Z')).toBe(1)
    // A new "yes" after the booking does not create another one.
    const later = await say(ch, 'tiim')
    expect(later.text).not.toMatch(/бүртгэгдлээ/)
    expect(await appointmentsAt(solongo, '2026-11-11T08:30:00Z')).toBe(1)
  })

  it('two identical sends in parallel (double click) create one booking', async () => {
    const ch = await toSummary('Цэцэг', '99110005', '10:00')
    const results = await Promise.allSettled([say(ch, 'tiim', { id: 'dbl' }), say(ch, 'tiim', { id: 'dbl' })])
    const solongo = await staffId(env.db, env.salonId, 'solongo')
    expect(await appointmentsAt(solongo, '2026-11-11T02:00:00Z')).toBe(1)
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true)
  })

  it('a slot taken between the summary and the "yes" is refused with alternatives', async () => {
    const ch = await toSummary('Оюун', '99110006', '12:00')
    const svc = await serviceId(env.db, env.salonId, 'classic-manicure')
    const solongo = await staffId(env.db, env.salonId, 'solongo')
    await createBooking(
      ctx(),
      {
        items: [{ serviceId: svc, addonIds: [] }],
        staffId: solongo,
        date: '2026-11-11',
        start: 12 * 60,
        customer: { name: 'Өөр', phone: '99110007', email: null, note: null, preferences: null },
      },
      { source: 'website', actor: 'customer', publicRules: true, isDemo: true },
    )
    const r = await say(ch, 'tiim')
    expect(r.text).toMatch(/дөнгөж сая захиалагдсан|боломжгүй/)
    expect(r.parts.some((p) => p.type === 'quick_replies')).toBe(true)
    expect(await appointmentsAt(solongo, '2026-11-11T04:00:00Z')).toBe(1)
  })
})

describe('availability conflicts', () => {
  it('never offers a time that collides with a booking (duration counted)', async () => {
    const svc = await serviceId(env.db, env.salonId, 'gel-polish')
    const nomin = await staffId(env.db, env.salonId, 'nomin')
    await createBooking(
      ctx(),
      {
        items: [{ serviceId: svc, addonIds: [] }],
        staffId: nomin,
        date: '2026-11-13',
        start: 15 * 60,
        customer: { name: 'Х', phone: '99110008', email: null, note: null, preferences: null },
      },
      { source: 'website', actor: 'customer', publicRules: true, isDemo: true },
    )
    const ch = visitor('dur')
    const r = await say(ch, 'baasan garigt 14:30 Nomin deer gel budalt')
    expect(r.text).toMatch(/сул биш/)
    const slots = r.parts
      .filter((p): p is Extract<ChatPart, { type: 'slots' }> => p.type === 'slots')
      .flatMap((p) => p.slots.map((s) => s.start))
    // 90 minutes + buffer: nothing from 13:30 to 16:30 that would overlap 15:00–16:30.
    expect(slots.filter((s) => s + 90 > 15 * 60 && s < 16 * 60 + 40)).toEqual([])
  })

  it('respects a specialist’s day off', async () => {
    const r = await say(visitor('dayoff'), 'byamba garagt Nomin deer gel budalt')
    expect(r.text).toMatch(/сул цаг|олдсонгүй|өдөр/)
    expect(r.parts.some((p) => p.type === 'slots' && p.date === '2026-11-14')).toBe(false)
  })
})

describe('authorization of existing bookings', () => {
  it('a wrong phone never reveals or changes someone else’s booking', async () => {
    const svc = await serviceId(env.db, env.salonId, 'gel-pedicure')
    const other = await createBooking(
      ctx(),
      {
        items: [{ serviceId: svc, addonIds: [] }],
        staffId: null,
        date: '2026-11-18',
        start: 11 * 60,
        customer: { name: 'Нууц', phone: '88112244', email: null, note: null, preferences: null },
      },
      { source: 'website', actor: 'customer', publicRules: true, isDemo: true },
    )
    const ch = visitor('intruder')
    await say(ch, `${other.reference} tsutslah`)
    for (const guess of ['99999999', '88112245', '95556677']) {
      const r = await say(ch, guess)
      expect(r.text).not.toMatch(/Нууц|педикюр|11:00/)
      expect(r.parts.some((p) => p.type === 'appointment' || p.type === 'change')).toBe(false)
    }
    const [row] = await env.db
      .select({ status: t.appointments.status })
      .from(t.appointments)
      .where(eq(t.appointments.id, other.appointmentId))
    expect(row.status).toBe('pending')
  })

  it('the owner of the booking can cancel it after proving the phone', async () => {
    const svc = await serviceId(env.db, env.salonId, 'basic-manicure')
    const mine = await createBooking(
      ctx(),
      {
        items: [{ serviceId: svc, addonIds: [] }],
        staffId: null,
        date: '2026-11-19',
        start: 12 * 60,
        customer: { name: 'Миний', phone: '88112255', email: null, note: null, preferences: null },
      },
      { source: 'website', actor: 'customer', publicRules: true, isDemo: true },
    )
    const ch = visitor('owner')
    const shown = await say(ch, `${mine.reference} 88112255 tsutslah`)
    expect(shown.parts.some((p) => p.type === 'change')).toBe(true)
    expect(shown.grantReferences).toEqual([mine.reference])
    const done = await say(ch, 'tiim')
    expect(done.text).toMatch(/цуцлагдлаа/)
    const [row] = await env.db
      .select({ status: t.appointments.status })
      .from(t.appointments)
      .where(eq(t.appointments.id, mine.appointmentId))
    expect(row.status).toBe('cancelled')
  })
})

describe('model failures and grounding', () => {
  it('keeps answering from the rules when the model is down', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const down: ModelCaller = async () => {
      throw new ModelError('unavailable', 'HTTP 503')
    }
    const ch = visitor('down')
    const r = await say(ch, 'хумсаа гоё болгуулмаар байна', { caller: down })
    expect(r.text.trim().length).toBeGreaterThan(0)
    expect(r.mode).toBe('rules')
    expect(r.events).toContain('model_error')
    const price = await say(ch, 'gel budalt hed ve', { caller: down })
    expect(price.text).toMatch(/65,000₮/)
  })

  it('uses a grounded model reading for a message the rules cannot read', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const calls: string[] = []
    const caller: ModelCaller = async (_o, req) => {
      calls.push(req.json ? 'interpret' : 'answer')
      const key = /S(\d+) \| Гель будалт/.exec(req.user)?.[0].split(' ')[0]
      return {
        text: JSON.stringify({ intent: 'book', services: [key, 'S999'] }),
        model: 'gpt-4.1-mini',
        inputTokens: 900,
        outputTokens: 20,
      }
    }
    const r = await say(visitor('ai'), 'хумсаа гоё болгуулмаар байна', { caller })
    expect(calls).toEqual(['interpret'])
    expect(r.mode).toBe('ai')
    expect(r.text).toMatch(/Гель будалт/)
    const [usage] = await env.db.select().from(t.assistantUsage).where(eq(t.assistantUsage.source, 'interpret'))
    expect(usage.calls).toBeGreaterThan(0)
    expect(usage.costUsd).toBeGreaterThan(0)
  })

  it('a model answer with an invented price is rejected and never shown', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const caller: ModelCaller = async (_o, req) =>
      req.json
        ? { text: '{}', model: 'gpt-4.1-mini', inputTokens: 10, outputTokens: 2 }
        : {
            text: 'Танд гель будалтыг 10,500₮-өөр хийж өгнө.',
            model: 'gpt-4.1-mini',
            inputTokens: 10,
            outputTokens: 10,
          }
    const r = await say(visitor('invent'), 'та нар найзуудтайгаа хамт ирвэл ямар нөхцөлтэй вэ', { caller })
    expect(r.text).not.toMatch(/10,500₮/)
    expect(r.events).toContain('model_rejected')
  })

  it('a verified model answer is used', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const caller: ModelCaller = async (_o, req) =>
      req.json
        ? { text: '{}', model: 'gpt-4.1-mini', inputTokens: 10, outputTokens: 2 }
        : {
            text: 'Тийм, найзуудтайгаа хамт ирж болно — мастер бүр тусдаа цаг захиална. Утас: 5000 0100.',
            model: 'gpt-4.1-mini',
            inputTokens: 10,
            outputTokens: 10,
          }
    const r = await say(visitor('verified'), 'та нар найзуудтайгаа хамт ирвэл ямар нөхцөлтэй вэ', { caller })
    expect(r.mode).toBe('ai')
    expect(r.events).toContain('model_answered')
  })

  it('stops calling the model once the daily budget is spent', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    await env.db
      .insert(t.assistantUsage)
      .values({
        day: '2026-11-10',
        environment: 'test',
        provider: 'openai',
        model: 'gpt-4.1-mini',
        source: 'seed',
        calls: 1,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 50,
      })
      .onConflictDoNothing()
    let calls = 0
    const caller: ModelCaller = async () => {
      calls++
      return { text: '{}', model: 'gpt-4.1-mini', inputTokens: 0, outputTokens: 0 }
    }
    const r = await say(visitor('budget'), 'хумсаа гоё болгуулмаар байна', { caller })
    expect(calls).toBe(0)
    expect(r.events).toContain('budget_exceeded')
    expect(r.text.trim().length).toBeGreaterThan(0)
    await env.db.delete(t.assistantUsage).where(eq(t.assistantUsage.source, 'seed'))
  })
})

describe('backend failures', () => {
  it('a backend timeout gives a clear failure message and no false claims', async () => {
    const ch = visitor('slow')
    const r = await handleChat(ctx(), { message: 'gel budalt hed ve', clientMessageId: 'slow-1' }, ch, {
      caller: null,
      readTimeoutMs: 0,
    })
    const text = flatten(r.messages.flatMap((m) => m.parts))
    expect(text).toMatch(/удааширлаа/)
    expect(r.events).toContain('backend_timeout')
  })

  it('a database error during the booking is reported, not hidden, and nothing is claimed', async () => {
    const ch = await toSummary('Энх', '99110009', '13:30')
    const broken = new Proxy(env.db, {
      get(target, prop, receiver) {
        if (prop === 'transaction') return () => Promise.reject(new Error('connection lost'))
        return Reflect.get(target, prop, receiver)
      },
    })
    const r = await handleChat(ctx(EVAL_NOW, broken), { message: 'tiim', clientMessageId: 'broken-1' }, ch, {
      caller: null,
    })
    const text = flatten(r.messages.flatMap((m) => m.parts))
    expect(text).toMatch(/саатлаа/)
    expect(text).not.toMatch(/бүртгэгдлээ/)
    expect(r.events).toContain('engine_error')
  })

  it('rejects malformed requests before they reach the assistant', () => {
    expect(chatRequestSchema.safeParse({ message: '' }).success).toBe(false)
    expect(chatRequestSchema.safeParse({ message: 'x'.repeat(501) }).success).toBe(false)
    expect(chatRequestSchema.safeParse({ action: { type: 'drop_tables' } }).success).toBe(false)
    expect(chatRequestSchema.safeParse({ action: { type: 'pick_service', serviceId: 'not-a-uuid' } }).success).toBe(
      false,
    )
    expect(chatRequestSchema.safeParse({ message: 'hi', clientMessageId: 'bad id with spaces' }).success).toBe(false)
    expect(chatRequestSchema.safeParse({ message: 'сайн уу', clientMessageId: 'abc-1' }).success).toBe(true)
  })
})

describe('hand-over and staff takeover', () => {
  it('a request for a person flags the chat and logs a staff alert (never sent in demo)', async () => {
    const ch = visitor('human')
    const r = await say(ch, 'huntei yarimaar baina')
    expect(r.status).toBe('handoff')
    const [session] = await env.db.select().from(t.chatSessions).where(eq(t.chatSessions.id, r.sessionId))
    expect(session.handoffReason).toBe('customer_request')
    const alerts = await env.db
      .select()
      .from(t.notifications)
      .where(and(eq(t.notifications.kind, 'assistant_handoff'), eq(t.notifications.salonId, env.salonId)))
    expect(alerts.length).toBeGreaterThan(0)
    expect(alerts.every((a) => a.status === 'logged')).toBe(true)
  })

  it('while staff answer the assistant stays quiet, then resumes after the silence limit', async () => {
    const ch = visitor('takeover')
    const first = await say(ch, 'huntei yarimaar baina')
    await postStaffReply(ctx(), {
      sessionId: first.sessionId,
      text: 'Сайн байна уу, би ресепшн Сараа байна.',
      adminUserId: (await anyAdmin()).id,
      staffName: 'Сараа',
    })
    const quiet = await say(ch, 'za bayarlalaa')
    expect(quiet.messages).toEqual([])
    expect(quiet.status).toBe('staff')
    const history = await loadChatHistory(ctx(), ch)
    expect(history?.messages.some((m) => m.role === 'staff')).toBe(true)
    await env.db.insert(t.assistantSettings).values({ salonId: env.salonId, handoverAutoResumeHours: 2 })
    const stillQuiet = await say(ch, 'hello?', { now: new Date(EVAL_NOW.getTime() + 1 * 3_600_000) })
    expect(stillQuiet.messages).toEqual([])
    const later = await say(ch, 'gel budalt hed ve', { now: new Date(EVAL_NOW.getTime() + 3 * 3_600_000) })
    expect(later.text).toMatch(/65,000₮/)
    expect(later.events).toContain('bot_resumed')
    await env.db.delete(t.assistantSettings).where(eq(t.assistantSettings.salonId, env.salonId))
  })
})

describe('admin test chat and stored data', () => {
  it('a test-chat booking is validated but never saved', async () => {
    const before = await env.db.$count(t.appointments)
    const ch = visitor('admin', 'test')
    const a = await say(ch, 'baasan garigt 14 tsagt songodog manikyur')
    const b = await say(ch, 'Туршилт 99110010')
    const r = await say(ch, 'tiim')
    expect(r.text, [a.text, b.text, r.text].join(' || ')).toMatch(/Туршилтын горим/)
    expect(await env.db.$count(t.appointments)).toBe(before)
  })

  it('stores neither the private booking link nor contact details in events', async () => {
    const ch = visitor('stored')
    const a = await say(ch, 'nugeedur 15 tsagt songodog manikyur')
    const b = await say(ch, 'Номин 99110011')
    const r = await say(ch, 'tiim')
    const live = r.parts.find((p): p is Extract<ChatPart, { type: 'booking' }> => p.type === 'booking')
    expect(live?.link ?? '', [a.text, b.text, r.text].join(' || ')).toMatch(/\?t=/)
    const rows = await env.db.select().from(t.chatMessages).where(eq(t.chatMessages.sessionId, r.sessionId))
    expect(JSON.stringify(rows.filter((x) => x.role === 'assistant').map((x) => x.meta))).not.toMatch(/\?t=/)
    const events = await env.db.select().from(t.assistantEvents).where(eq(t.assistantEvents.sessionId, r.sessionId))
    expect(JSON.stringify(events)).not.toMatch(/99110011|Номин/)
    const userRows = rows.filter((x) => x.role === 'user' && /99110011/.test(x.content))
    expect(userRows.every((x) => (x.meta as { sensitive?: boolean } | null)?.sensitive)).toBe(true)
  })
})

async function anyAdmin() {
  const [row] = await env.db
    .select({ id: t.adminUsers.id })
    .from(t.adminUsers)
    .where(eq(t.adminUsers.salonId, env.salonId))
    .limit(1)
  return row
}
