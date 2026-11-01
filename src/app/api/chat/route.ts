// Website chat endpoint. Anonymous, rate-limited per hashed IP; the visitor
// is identified by a random httpOnly cookie (only its hash is stored).
import { cookies } from 'next/headers'
import { z } from 'zod'
import { BASE_PATH } from '@/lib/base-path'
import { handleChat } from '@/server/assistant/engine'
import { ServiceError } from '@/server/context'
import { publicContext, visitorHash } from '@/server/request'
import { randomToken, sha256Hex } from '@/server/security/crypto'
import { enforceRateLimit, LIMITS } from '@/server/security/rate-limit'

const id = z.guid()
const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello') }),
  z.object({ type: z.literal('reset') }),
  z.object({ type: z.literal('pick_service'), serviceId: id }),
  z.object({ type: z.literal('pick_staff'), staffId: id.nullable() }),
  z.object({ type: z.literal('pick_date'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ type: z.literal('choose_slot'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), start: z.number().int().min(0).max(1440) }),
  z.object({ type: z.literal('confirm_draft'), draftId: id }),
  z.object({ type: z.literal('cancel_draft'), draftId: id }),
])
const bodySchema = z.union([z.object({ message: z.string().trim().min(1).max(500) }), z.object({ action: actionSchema })])

const CHAT_COOKIE = 'sv_chat'

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ messages: [], mode: 'rules', error: 'Хүсэлт буруу байна.' }, { status: 400 })
  try {
    const ctx = await publicContext()
    await enforceRateLimit(ctx.db, LIMITS.chat, ctx.ipHash)
    if ('message' in parsed.data) await enforceRateLimit(ctx.db, LIMITS.chatDaily, ctx.ipHash)
    const jar = await cookies()
    let chatId = jar.get(CHAT_COOKIE)?.value
    if (!chatId || chatId.length > 64) {
      chatId = randomToken(18)
      jar.set(CHAT_COOKIE, chatId, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: BASE_PATH || '/', maxAge: 60 * 60 * 24 * 7 })
    }
    const confirming = 'action' in parsed.data && parsed.data.action.type === 'confirm_draft'
    const result = await handleChat(ctx, parsed.data, {
      channel: 'web',
      visitorHash: sha256Hex(`chat:${chatId}`),
      demoVisitorHash: await visitorHash({ create: confirming }),
    })
    return Response.json(result)
  } catch (err) {
    if (err instanceof ServiceError) return Response.json({ messages: [], mode: 'rules', error: err.message }, { status: err.code === 'rate_limited' ? 429 : 400 })
    console.error('[chat]', err)
    return Response.json({ messages: [], mode: 'rules', error: 'Алдаа гарлаа. Дахин оролдоно уу.' }, { status: 500 })
  }
}
