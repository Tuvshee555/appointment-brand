// Outbound calls to the Graph API. Replies go to POST /{PAGE_ID}/messages for
// Messenger and for Instagram accounts linked to the Page (Instagram-scoped id
// as recipient); a private reply to an Instagram comment goes through
// /{IG_ID}/messages. Every message is a RESPONSE to something the person just
// did — there is no broadcast, tag or campaign code here.
//
// Delivery outcome: an HTTP answer from Meta is definitive ("sent" or
// "failed"); a timeout or network error is "uncertain" — the message may have
// arrived, so it is never sent again automatically.
import 'server-only'
import type { MetaConfig } from './config'
import type { MetaPlatform } from './events'
import { appSecretProof } from './signature'

/** Tags our own messages so their echoes are never mistaken for a staff reply. */
export const BOT_METADATA = 'ursgal-assistant'
const TIMEOUT_MS = 8_000

export type Recipient = { id: string } | { comment_id: string }
export type OutgoingMessage = {
  text: string
  quick_replies?: { content_type: 'text'; title: string; payload: string }[]
  metadata?: string
}
export type Delivery =
  { status: 'sent'; messageId: string | null } | { status: 'failed'; code: string } | { status: 'uncertain' }

export async function sendMessage(
  config: MetaConfig,
  platform: MetaPlatform,
  recipient: Recipient,
  message: OutgoingMessage,
): Promise<Delivery> {
  // A private reply to an Instagram comment is sent as the Instagram account; everything else as the Page.
  const sender = platform === 'instagram' && 'comment_id' in recipient ? config.instagramId : config.pageId
  if (!sender) return { status: 'failed', code: 'no_sender' }
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${sender}/messages`)
  url.searchParams.set('access_token', config.pageToken)
  url.searchParams.set('appsecret_proof', appSecretProof(config.pageToken, config.appSecret))
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient, messaging_type: 'RESPONSE', message: { ...message, metadata: BOT_METADATA } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
  } catch {
    return { status: 'uncertain' }
  }
  const body = (await res.json().catch(() => null)) as {
    message_id?: string
    error?: { code?: number; error_subcode?: number }
  } | null
  if (!res.ok)
    return {
      status: 'failed',
      code: `http_${res.status}:${body?.error?.code ?? 'x'}${body?.error?.error_subcode ? `/${body.error.error_subcode}` : ''}`,
    }
  return { status: 'sent', messageId: body?.message_id ?? null }
}

/** Splits a reply into Messenger-sized messages (2,000 characters), at paragraph or line breaks where possible. */
export function chunkText(text: string, size = 1_900): string[] {
  const out: string[] = []
  let rest = text.trim()
  while (rest.length > size) {
    const cut = Math.max(rest.lastIndexOf('\n\n', size), rest.lastIndexOf('\n', size), rest.lastIndexOf('. ', size))
    const at = cut > size / 2 ? cut + 1 : size
    out.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest) out.push(rest)
  return out.slice(0, 4)
}

export type Chip = string | { title: string; payload: string }

/** Quick-reply chips: at most 13, titles of at most 20 characters; a plain label is its own payload. */
export function quickReplies(chips: Chip[]): OutgoingMessage['quick_replies'] {
  const out = chips
    .map((c) =>
      typeof c === 'string' ? { title: c.trim(), payload: c.trim() } : { title: c.title.trim(), payload: c.payload },
    )
    .filter((c) => c.title && c.payload)
    .slice(0, 13)
    .map((c) => ({
      content_type: 'text' as const,
      title: c.title.length > 20 ? `${c.title.slice(0, 19)}…` : c.title,
      payload: c.payload.slice(0, 1000),
    }))
  return out.length ? out : undefined
}
