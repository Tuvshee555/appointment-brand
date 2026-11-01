// Facebook Messenger webhook — prepared, inactive until MESSENGER_VERIFY_TOKEN,
// MESSENGER_APP_SECRET and MESSENGER_PAGE_TOKEN are configured. It verifies
// Meta's X-Hub-Signature-256, answers with the same engine as the website chat
// (rule-based or AI, same database tools) and sends text replies through the
// Send API. Booking confirmation uses a postback button carrying the draft id.
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { ChatPart } from '@/lib/assistant/types'
import { handleChat } from '@/server/assistant/engine'
import { publicContext } from '@/server/request'
import { sha256Hex } from '@/server/security/crypto'
import { hitRateLimit, LIMITS } from '@/server/security/rate-limit'

function configured() {
  return Boolean(
    process.env.MESSENGER_VERIFY_TOKEN && process.env.MESSENGER_APP_SECRET && process.env.MESSENGER_PAGE_TOKEN,
  )
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (!configured()) return new Response('Messenger not configured', { status: 503 })
  if (
    url.searchParams.get('hub.mode') === 'subscribe' &&
    url.searchParams.get('hub.verify_token') === process.env.MESSENGER_VERIFY_TOKEN
  ) {
    return new Response(url.searchParams.get('hub.challenge') ?? '')
  }
  return new Response('forbidden', { status: 403 })
}

function validSignature(raw: string, header: string | null) {
  if (!header?.startsWith('sha256=')) return false
  const expected = Buffer.from(createHmac('sha256', process.env.MESSENGER_APP_SECRET!).update(raw).digest('hex'))
  const given = Buffer.from(header.slice(7))
  return expected.length === given.length && timingSafeEqual(expected, given)
}

function toMessenger(parts: ChatPart[]) {
  const out: Record<string, unknown>[] = []
  for (const p of parts) {
    if (p.type === 'text' || p.type === 'handoff') out.push({ text: p.text.slice(0, 1900) })
    if (p.type === 'slots') out.push({ text: `${p.dateLabel}: ${p.slots.map((s) => s.label).join(', ')}` })
    if (p.type === 'draft') {
      out.push({
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: `${p.summary.dateLabel} ${p.summary.timeRange} · ${p.summary.services.map((s) => s.name).join(' + ')} · ${p.summary.staffName}`.slice(
              0,
              600,
            ),
            buttons: [
              {
                type: 'postback',
                title: 'Баталгаажуулах',
                payload: JSON.stringify({ type: 'confirm_draft', draftId: p.draftId }),
              },
            ],
          },
        },
      })
    }
    if (p.type === 'booking') out.push({ text: `Захиалга ${p.reference}: ${p.statusLabel}. ${p.explanation}` })
  }
  return out
}

export async function POST(req: Request) {
  if (!configured()) return new Response('Messenger not configured', { status: 503 })
  const raw = await req.text()
  if (!validSignature(raw, req.headers.get('x-hub-signature-256')))
    return new Response('bad signature', { status: 401 })
  const body = JSON.parse(raw) as {
    entry?: {
      messaging?: {
        sender?: { id?: string }
        message?: { text?: string; is_echo?: boolean }
        postback?: { payload?: string }
      }[]
    }[]
  }
  const ctx = await publicContext()
  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const psid = event.sender?.id
      if (!psid || event.message?.is_echo) continue
      if (!(await hitRateLimit(ctx.db, LIMITS.messenger, psid))) continue
      let input: Parameters<typeof handleChat>[1] | null = null
      if (event.message?.text) input = { message: event.message.text.slice(0, 500) }
      else if (event.postback?.payload) {
        try {
          const payload = JSON.parse(event.postback.payload) as { type?: string; draftId?: string }
          if (payload.type === 'confirm_draft' && payload.draftId)
            input = { action: { type: 'confirm_draft', draftId: payload.draftId } }
        } catch {
          input = null
        }
      }
      if (!input) continue
      const result = await handleChat(ctx, input, {
        channel: 'messenger',
        visitorHash: sha256Hex(`messenger:${psid}`),
        demoVisitorHash: null,
      })
      for (const message of toMessenger(result.messages.flatMap((m) => m.parts))) {
        await fetch(
          `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(process.env.MESSENGER_PAGE_TOKEN!)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient: { id: psid }, messaging_type: 'RESPONSE', message }),
            signal: AbortSignal.timeout(8000),
          },
        ).catch((err) => console.error('[messenger] send failed', err instanceof Error ? err.message : err))
      }
    }
  }
  return new Response('EVENT_RECEIVED')
}
