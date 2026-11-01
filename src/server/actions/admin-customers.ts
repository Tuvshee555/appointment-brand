'use server'

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { id, optionalText } from '@/lib/validation/common'
import * as t from '@/server/db/schema'
import { ServiceError } from '@/server/context'
import { audit, runAdminAction, safeParse } from './admin-run'

export async function updateCustomerAction(input: unknown) {
  const p = safeParse(
    z.object({ id, notes: optionalText(2000), preferences: optionalText(300), marketingOptIn: z.boolean() }),
    input,
  )
  if (!p.ok) return p
  return runAdminAction('customers.manage', async (ctx) => {
    const rows = await ctx.db
      .update(t.customers)
      .set({
        notes: p.data.notes,
        preferences: p.data.preferences,
        marketingOptIn: p.data.marketingOptIn,
        updatedAt: ctx.now,
      })
      .where(and(eq(t.customers.id, p.data.id), eq(t.customers.salonId, ctx.salonId)))
      .returning({ name: t.customers.name })
    if (!rows.length) throw new ServiceError('not_found', 'Харилцагч олдсонгүй.')
    await audit(ctx, {
      action: 'customer.update',
      entity: 'customer',
      entityId: p.data.id,
      summary: `${rows[0].name}: тэмдэглэл шинэчлэв`,
    })
    return null
  })
}
