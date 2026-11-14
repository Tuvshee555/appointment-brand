// The Meta webhook end to end against a real (throwaway) database, with the Graph API
// mocked: signed events in, the Сувд assistant's answer out — once, even when Meta
// retries; a booking is only made after the customer taps «Баталгаажуулах»; nothing is
// sent while outbound is off; a staff reply in the Page inbox silences the assistant;
// real Messenger conversations never reach the public demo admin.
import { and, eq } from 'drizzle-orm'
import { createHmac } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as t from '@/server/db/schema'
import { metaVisitorHash, requestFor, suvdMetaAdapter, toMetaReply } from '@/server/meta/adapter'
import { BOT_METADATA } from '@/server/meta/graph'
import { receiveWebhook, verifySubscription } from '@/server/meta/webhook'
import { EVAL_NOW } from '../eval/types'
import { freshDatabase, type TestDb } from './db'

const PAGE = '1111111111'
const IG = '2222222222'
const SECRET = 'test-app-secret'
const VERIFY = 'verify-token-1234567890'

type Sent = {
  url: URL
  body: {
    recipient: Record<string, string>
    messaging_type: string
    message: { text: string; metadata: string; quick_replies?: { title: string; payload: string }[] }
  }
}
let env: TestDb
let sent: Sent[]

beforeAll(async () => {
  env = await freshDatabase()
})
afterAll(() => env.close())

beforeEach(() => {
  // Only Date is faked: the salon's schedule is evaluated on the fixed evaluation day.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(EVAL_NOW)
  vi.stubEnv('OPENAI_API_KEY', '')
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  vi.stubEnv('META_APP_SECRET', SECRET)
  vi.stubEnv('META_VERIFY_TOKEN', VERIFY)
  vi.stubEnv('META_PAGE_ID', PAGE)
  vi.stubEnv('META_PAGE_ACCESS_TOKEN', 'test-page-token')
  vi.stubEnv('META_INSTAGRAM_ACCOUNT_ID', IG)
  vi.stubEnv('META_OUTBOUND_ENABLED', 'true')
  sent = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.hostname !== 'graph.facebook.com') throw new Error(`unexpected fetch ${url.hostname}`)
      sent.push({ url, body: JSON.parse(String(init?.body)) })
      return Response.json({
        recipient_id: '1',
        message_id: `m_sent_${sent.length}_${Math.random().toString(36).slice(2)}`,
      })
    }),
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const sign = (raw: string, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(Buffer.from(raw)).digest('hex')}`

async function deliver(payload: unknown, secret = SECRET) {
  const raw = JSON.stringify(payload)
  const tasks: Promise<void>[] = []
  const res = await receiveWebhook(
    new Request('https://salon.test/api/meta/webhook', {
      method: 'POST',
      body: raw,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(raw, secret) },
    }),
    env.db,
    suvdMetaAdapter,
    (task) => void tasks.push(task()),
  )
  await Promise.all(tasks)
  return res
}

let seq = 0
const mid = () => `m_test_${seq++}_${Math.random().toString(36).slice(2)}`
const now = () => Date.now()
const dm = (sender: string, text: string, extra: Record<string, unknown> = {}) => ({
  object: 'page',
  entry: [
    {
      id: PAGE,
      time: now(),
      messaging: [
        { sender: { id: sender }, recipient: { id: PAGE }, timestamp: now(), message: { mid: mid(), text, ...extra } },
      ],
    },
  ],
})
const tap = (sender: string, chip: { title: string; payload: string }) =>
  dm(sender, chip.title, { quick_reply: { payload: chip.payload } })
const echo = (customer: string, text: string, extra: Record<string, unknown> = {}) => ({
  object: 'page',
  entry: [
    {
      id: PAGE,
      time: now(),
      messaging: [
        {
          sender: { id: PAGE },
          recipient: { id: customer },
          timestamp: now(),
          message: { mid: mid(), text, is_echo: true, ...extra },
        },
      ],
    },
  ],
})

async function sessionOf(platform: 'messenger' | 'instagram', sender: string, account = PAGE) {
  const [s] = await env.db
    .select()
    .from(t.chatSessions)
    .where(
      and(
        eq(t.chatSessions.channel, platform),
        eq(t.chatSessions.visitorHash, metaVisitorHash(platform, account, sender)),
      ),
    )
  return s
}

describe('handshake and signatures', () => {
  it('echoes the challenge only for the right verify token; rejects unsigned deliveries', async () => {
    const url = (token: string) =>
      `https://salon.test/api/meta/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=42`
    expect(await verifySubscription(new Request(url(VERIFY))).text()).toBe('42')
    expect(verifySubscription(new Request(url('wrong-token-1234567890'))).status).toBe(403)
    expect((await deliver(dm('3000000001', 'Сайн уу'), 'wrong-secret')).status).toBe(401)
    expect(sent).toHaveLength(0)
  })
})

describe('Messenger booking', () => {
  it('answers in Cyrillic and Latin Mongolian, once per message even when Meta retries', async () => {
    const payload = dm('3000000002', 'Маникюр хэд вэ?')
    await deliver(payload)
    await deliver(payload)
    expect(sent).toHaveLength(1)
    expect(sent[0].url.pathname).toBe(`/v25.0/${PAGE}/messages`)
    expect(sent[0].body).toMatchObject({
      recipient: { id: '3000000002' },
      messaging_type: 'RESPONSE',
      message: { metadata: BOT_METADATA },
    })
    expect(sent[0].body.message.text).toMatch(/₮/)
    await deliver(dm('3000000002', 'pedikyur hed ve'))
    expect(sent).toHaveLength(2)
    expect(sent[1].body.message.text).toMatch(/₮/)
    const s = await sessionOf('messenger', '3000000002')
    expect(s.visitorHash.startsWith('mt:')).toBe(true)
    expect(await env.db.$count(t.chatMessages, eq(t.chatMessages.sessionId, s.id))).toBe(4)
  })

  it('books only after the customer taps «Баталгаажуулах», with the source "messenger"', async () => {
    await deliver(dm('3000000003', 'margaash 15:00 Solongo deer songodog manikyur'))
    await deliver(dm('3000000003', 'Сараа 99110011'))
    const summary = sent.at(-1)!
    const confirm = summary.body.message.quick_replies?.find((c) => c.title === 'Баталгаажуулах')
    expect(confirm, summary.body.message.text).toBeTruthy()
    // Nothing is booked from the summary alone.
    const messengerBefore = await env.db.$count(t.appointments, eq(t.appointments.source, 'messenger'))
    await deliver(tap('3000000003', confirm!))
    expect(sent.at(-1)!.body.message.text).toMatch(/SV-/)
    expect(await env.db.$count(t.appointments, eq(t.appointments.source, 'messenger'))).toBe(messengerBefore + 1)
    // The private manage link is never sent to Meta.
    expect(sent.every((m) => !/\/booking\/|token=/i.test(m.body.message.text))).toBe(true)
  })

  it('with outbound off the reply is logged but nothing is sent', async () => {
    vi.stubEnv('META_OUTBOUND_ENABLED', '')
    await deliver(dm('3000000004', 'Хаана байрладаг вэ?'))
    expect(sent).toHaveLength(0)
    const s = await sessionOf('messenger', '3000000004')
    expect(await env.db.$count(t.chatMessages, eq(t.chatMessages.sessionId, s.id))).toBe(2)
  })
})

describe('human handover and privacy', () => {
  it('a reply typed in the Page inbox takes the chat over; own echoes do not', async () => {
    await deliver(dm('3000000010', 'Сайн байна уу'))
    await deliver(echo('3000000010', sent[0].body.message.text, { metadata: BOT_METADATA }))
    expect((await sessionOf('messenger', '3000000010')).status).not.toBe('staff')
    await deliver(echo('3000000010', 'Сайн байна уу, Сараа байна.', { app_id: 263902037430900 }))
    expect((await sessionOf('messenger', '3000000010')).status).toBe('staff')
    const count = sent.length
    await deliver(dm('3000000010', 'Баярлалаа'))
    expect(sent).toHaveLength(count)
  })

  it('real Messenger conversations never appear for the public demo role', async () => {
    await deliver(dm('3000000011', 'Сайн уу'))
    const s = await sessionOf('messenger', '3000000011')
    // The admin queries use the app-wide pool: point it at this test's database before loading them.
    process.env.DATABASE_URL = env.url
    const { conversationDetail, listConversations } = await import('@/server/queries/admin-assistant')
    const staff = await listConversations(env.salonId, 'all', 1, 200)
    const demo = await listConversations(env.salonId, 'all', 1, 200, { hideMeta: true })
    expect(staff.rows.some((r) => r.s.id === s.id)).toBe(true)
    expect(demo.rows.some((r) => r.s.id === s.id)).toBe(false)
    expect(await conversationDetail(env.salonId, s.id, { hideMeta: true })).toBeNull()
  })
})

describe('Instagram', () => {
  it('answers an Instagram DM through the Page with the Instagram-scoped id', async () => {
    await deliver({
      object: 'instagram',
      entry: [
        {
          id: IG,
          time: now(),
          messaging: [
            {
              sender: { id: '4000000001' },
              recipient: { id: IG },
              timestamp: now(),
              message: { mid: mid(), text: 'gel budag hed ve' },
            },
          ],
        },
      ],
    })
    expect(sent).toHaveLength(1)
    expect(sent[0].url.pathname).toBe(`/v25.0/${PAGE}/messages`)
    expect(sent[0].body.recipient).toEqual({ id: '4000000001' })
    expect((await sessionOf('instagram', '4000000001', IG)).channel).toBe('instagram')
  })
})

describe('reply formatting', () => {
  it('turns a draft into confirm and cancel chips carrying the draft id', () => {
    const reply = toMetaReply([
      { type: 'text', text: 'Шалгаад баталгаажуулна уу.' },
      {
        type: 'draft',
        draftId: 'd-1',
        summary: {
          dateLabel: '11-11',
          timeRange: '15:00–16:00',
          services: [{ name: 'Маникюр' }],
          staffName: 'Солонго',
        },
      } as never,
    ])!
    expect(reply.text).toContain('Маникюр')
    expect(reply.suggestions).toEqual([
      { title: 'Баталгаажуулах', payload: 'action:{"type":"confirm_draft","draftId":"d-1"}' },
      { title: 'Цуцлах', payload: 'action:{"type":"cancel_draft","draftId":"d-1"}' },
    ])
  })
  it('reads chips and the earlier postback buttons back as actions; anything else as text', () => {
    expect(requestFor('action:{"type":"confirm_draft","draftId":"d-1"}', 'x')).toEqual({
      action: { type: 'confirm_draft', draftId: 'd-1' },
    })
    expect(requestFor('{"type":"confirm_draft","draftId":"d-2"}', 'x')).toEqual({
      action: { type: 'confirm_draft', draftId: 'd-2' },
    })
    expect(requestFor('{сайн уу', 'x')).toEqual({ message: '{сайн уу', clientMessageId: 'x' })
  })
})
