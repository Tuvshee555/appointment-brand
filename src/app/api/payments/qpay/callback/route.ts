// QPay payment callback. The callback is only a hint: the payment is marked
// paid exclusively after the server asks QPay (payment/check) itself.
import { eq } from 'drizzle-orm'
import * as t from '@/server/db/schema'
import { verifyPayment } from '@/server/payments/service'
import { publicContext } from '@/server/request'
import { verifyHmac } from '@/server/security/crypto'
import { hitRateLimit, LIMITS } from '@/server/security/rate-limit'

async function handle(req: Request) {
  const url = new URL(req.url)
  const paymentId = url.searchParams.get('payment') ?? ''
  const sig = url.searchParams.get('sig') ?? ''
  if (
    !/^[0-9a-f-]{36}$/.test(paymentId) ||
    !sig ||
    !verifyHmac(`qpay-callback:${paymentId}`, sig, 'QPAY_CALLBACK_SECRET')
  ) {
    return new Response('invalid', { status: 400 })
  }
  const ctx = await publicContext()
  if (!(await hitRateLimit(ctx.db, LIMITS.paymentCallback, ctx.ipHash ?? 'qpay')))
    return new Response('slow down', { status: 429 })
  const [payment] = await ctx.db
    .select({ salonId: t.payments.salonId })
    .from(t.payments)
    .where(eq(t.payments.id, paymentId))
  if (!payment) return new Response('unknown', { status: 404 })
  await verifyPayment({ ...ctx, salonId: payment.salonId }, paymentId, 'callback')
  return new Response('SUCCESS')
}

export const GET = handle
export const POST = handle
