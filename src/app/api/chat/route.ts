// Website chat endpoint. Anonymous, rate-limited per hashed IP; the visitor
// is identified by a random httpOnly cookie (only its hash is stored).
// POST runs one turn; GET returns the current conversation (reopening the
// widget) and new staff replies after `after`.
import { cookies } from 'next/headers'
import { chatRequestSchema } from '@/lib/assistant/schema'
import { BASE_PATH } from '@/lib/base-path'
import { handleChat, loadChatHistory } from '@/server/assistant/handler'
import { ServiceError } from '@/server/context'
import { grantLookup } from '@/server/queries/customer-booking'
import { publicContext, visitorHash } from '@/server/request'
import { randomToken, sha256Hex } from '@/server/security/crypto'
import { enforceRateLimit, LIMITS } from '@/server/security/rate-limit'

const CHAT_COOKIE = 'sv_chat'

async function chatVisitor(create: boolean) {
  const jar = await cookies()
  let chatId = jar.get(CHAT_COOKIE)?.value
  if ((!chatId || chatId.length > 64) && create) {
    chatId = randomToken(18)
    jar.set(CHAT_COOKIE, chatId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: BASE_PATH || '/',
      maxAge: 60 * 60 * 24 * 7,
    })
  }
  return chatId && chatId.length <= 64 ? sha256Hex(`chat:${chatId}`) : null
}

function failure(err: unknown) {
  if (err instanceof ServiceError) {
    const status = err.code === 'rate_limited' ? 429 : err.code === 'busy' ? 409 : 400
    return Response.json({ messages: [], mode: 'rules', error: err.message }, { status })
  }
  console.error('[chat]', err instanceof Error ? `${err.name}: ${err.message}` : err)
  return Response.json({ messages: [], mode: 'rules', error: 'Алдаа гарлаа. Дахин оролдоно уу.' }, { status: 500 })
}

export async function POST(req: Request) {
  const parsed = chatRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success)
    return Response.json({ messages: [], mode: 'rules', error: 'Хүсэлт буруу байна.' }, { status: 400 })
  try {
    const ctx = await publicContext()
    await enforceRateLimit(ctx.db, LIMITS.chat, ctx.ipHash)
    if ('message' in parsed.data) await enforceRateLimit(ctx.db, LIMITS.chatDaily, ctx.ipHash)
    const hash = (await chatVisitor(true))!
    const result = await handleChat(ctx, parsed.data, {
      channel: 'web',
      visitorHash: hash,
      demoVisitorHash: await visitorHash({ create: true }),
    })
    // Bookings the visitor created or proved in the chat open on «Миний захиалга» without the link.
    for (const reference of result.grantReferences) await grantLookup(reference)
    return Response.json({ messages: result.messages, mode: result.mode, status: result.status })
  } catch (err) {
    return failure(err)
  }
}

export async function GET(req: Request) {
  try {
    const ctx = await publicContext()
    await enforceRateLimit(ctx.db, LIMITS.availability, ctx.ipHash)
    const hash = await chatVisitor(false)
    if (!hash) return Response.json({ messages: [], status: 'bot' })
    const after = new URL(req.url).searchParams.get('after')
    const since = after && !Number.isNaN(Date.parse(after)) ? new Date(after) : null
    const history = await loadChatHistory(ctx, { channel: 'web', visitorHash: hash, demoVisitorHash: null }, since)
    return Response.json(history ?? { messages: [], status: 'bot' })
  } catch (err) {
    return failure(err)
  }
}
