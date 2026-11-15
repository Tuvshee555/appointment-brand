// The webhook's HTTP handling, kept apart from the route so tests can drive it
// with a test database and a synchronous scheduler.
//
// GET  — the subscription handshake: echoes hub.challenge only for the right verify token.
// POST — verifies X-Hub-Signature-256 over the raw body, stores the events and
//        answers 200 at once (Meta expects it within seconds); replies are
//        produced after the response. A storage failure answers 503 so Meta retries.
import 'server-only'
import type { Database } from '@/server/db/client'
import { metaConfig } from './config'
import { MetaPayloadError, parseWebhook, type MetaEvent } from './events'
import { runMetaQueue, type MetaAdapter } from './process'
import { recordEvents } from './receipts'
import { validSignature, validVerifyToken } from './signature'

const MAX_BODY = 512 * 1024
const plain = (body: string, status: number) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } })

export function verifySubscription(req: Request): Response {
  const config = metaConfig()
  if (!config) return plain('Not configured', 503)
  const params = new URL(req.url).searchParams
  const challenge = params.get('hub.challenge')
  if (
    params.get('hub.mode') === 'subscribe' &&
    challenge &&
    /^[\w-]{1,200}$/.test(challenge) &&
    validVerifyToken(params.get('hub.verify_token'), config.verifyToken)
  )
    return plain(challenge, 200)
  return plain('Forbidden', 403)
}

export async function receiveWebhook(
  req: Request,
  db: Database,
  adapter: MetaAdapter,
  schedule: (task: () => Promise<void>) => void,
): Promise<Response> {
  const config = metaConfig()
  if (!config) return plain('Not configured', 503)
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY) return plain('Too large', 413)
  const raw = Buffer.from(await req.arrayBuffer())
  if (raw.length > MAX_BODY) return plain('Too large', 413)
  if (!validSignature(raw, req.headers.get('x-hub-signature-256'), config.appSecret))
    return plain('Invalid signature', 401)

  let events: MetaEvent[]
  try {
    events = parseWebhook(JSON.parse(raw.toString('utf8')), config)
  } catch (err) {
    if (err instanceof SyntaxError || err instanceof MetaPayloadError) return plain('Bad request', 400)
    throw err
  }
  try {
    await recordEvents(db, events)
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: 'meta',
        code: 'meta.receipt_store_failed',
        error: err instanceof Error ? err.name : 'unknown',
      }),
    )
    return plain('Retry later', 503)
  }
  schedule(() =>
    runMetaQueue(
      db,
      config,
      adapter,
      events.map((e) => e.key),
    ),
  )
  return plain('EVENT_RECEIVED', 200)
}
