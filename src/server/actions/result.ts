// Shared result shape for server actions (not itself a 'use server' module).
import { z } from 'zod'
import '@/lib/validation/mn-errors'
import { fieldErrors } from '@/lib/validation/common'
import { ServiceError } from '@/server/context'
import { PaymentProviderError } from '@/server/payments/provider'

export type ActionFailure = {
  ok: false
  error: string
  code?: string
  fieldErrors?: Record<string, string>
  details?: unknown
}
export type ActionResult<T = undefined> = { ok: true; data: T; simulated?: boolean; message?: string } | ActionFailure

export function toFailure(err: unknown): ActionFailure {
  if (err instanceof ServiceError)
    return { ok: false, error: err.message, code: err.code, fieldErrors: err.fieldErrors, details: err.details }
  if (err instanceof z.ZodError) {
    return {
      ok: false,
      error: err.issues[0]?.message ?? 'Мэдээллээ шалгана уу.',
      code: 'validation',
      fieldErrors: fieldErrors(err),
    }
  }
  if (err instanceof PaymentProviderError) {
    console.error('[payment]', err.message)
    return {
      ok: false,
      error: 'Төлбөрийн системтэй холбогдож чадсангүй. Түр хүлээгээд дахин оролдоно уу.',
      code: 'payment_provider',
    }
  }
  console.error('[action]', err)
  return { ok: false, error: 'Алдаа гарлаа. Дахин оролдоно уу.', code: 'unexpected' }
}
