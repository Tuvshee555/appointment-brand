// Shared plumbing for admin server actions (not itself a 'use server' module).
//
// Every admin mutation goes through runAdminAction():
//  1. authenticated session required, permission checked on the server;
//  2. public demo sessions never change shared sample data: the action runs
//     inside a transaction that is rolled back (the server still validates
//     everything and returns the would-be result), except for the visitor's
//     own sample bookings, which they may manage for real;
//  3. real changes refresh the router and can invalidate public caches.
import 'server-only'
import { and, eq } from 'drizzle-orm'
import { refresh, updateTag } from 'next/cache'
import type { Permission } from '@/lib/auth/permissions'
import * as t from '@/server/db/schema'
import { ERR, ServiceError } from '@/server/context'
import { adminContext, type AdminContext } from '@/server/auth/current'
import { enforceRateLimit, LIMITS } from '@/server/security/rate-limit'
import type { z } from 'zod'
import { toFailure, type ActionFailure, type ActionResult } from './result'

/** Validates action input without throwing (malformed input becomes a Mongolian error). */
export function safeParse<T>(schema: z.ZodType<T>, input: unknown): { ok: true; data: T } | ActionFailure {
  const r = schema.safeParse(input)
  return r.success ? { ok: true, data: r.data } : toFailure(r.error)
}

class DryRun extends Error {
  constructor(public readonly value: unknown) {
    super('dry-run')
  }
}

export const DEMO_SIMULATED_MESSAGE =
  'Демо горим: сервер шалгалтыг бүрэн хийсэн ч зохиомол өгөгдлийг өөрчлөөгүй. Зөвхөн өөрийн үүсгэсэн туршилтын захиалгыг жинхэнээр өөрчилнө.'

export interface RunOptions {
  /** Lets a demo visitor really change this appointment if they created it. */
  ownAppointmentId?: string
  /** Public cache tags to invalidate after a real change (e.g. catalog, salon). */
  tags?: string[]
}

async function isOwnDemoAppointment(ctx: AdminContext, appointmentId: string) {
  if (!ctx.actor.demoVisitorHash) return false
  const [row] = await ctx.db
    .select({ hash: t.appointments.demoVisitorHash })
    .from(t.appointments)
    .where(and(eq(t.appointments.id, appointmentId), eq(t.appointments.salonId, ctx.salonId)))
  return Boolean(row?.hash && row.hash === ctx.actor.demoVisitorHash)
}

export async function runAdminAction<T>(
  permission: Permission,
  fn: (ctx: AdminContext) => Promise<T>,
  opts: RunOptions = {},
): Promise<ActionResult<T>> {
  try {
    const ctx = await adminContext()
    const { actor } = ctx
    if (actor.isDemo) {
      // Demo visitors need the read permission for the area they explore.
      const viewPermission = permission.replace(/\.manage$/, '.view').replace(/^customers\.contact$/, 'customers.view')
      if (!actor.permissions.includes(viewPermission)) throw ERR.forbidden()
      await enforceRateLimit(ctx.db, LIMITS.demoMutation, actor.demoVisitorHash ?? ctx.ipHash)
      if (opts.ownAppointmentId && (await isOwnDemoAppointment(ctx, opts.ownAppointmentId))) {
        const data = await fn(ctx)
        refresh()
        return { ok: true, data, message: 'Таны үүсгэсэн туршилтын захиалга шинэчлэгдлээ.' }
      }
      try {
        await ctx.db.transaction(async (tx) => {
          const value = await fn({ ...ctx, db: tx })
          throw new DryRun(value)
        })
      } catch (err) {
        if (err instanceof DryRun)
          return { ok: true, data: err.value as T, simulated: true, message: DEMO_SIMULATED_MESSAGE }
        throw err
      }
      throw new ServiceError('unexpected', 'Алдаа гарлаа.')
    }
    if (!actor.permissions.includes(permission)) throw ERR.forbidden()
    const data = await fn(ctx)
    for (const tag of opts.tags ?? []) updateTag(tag)
    refresh()
    return { ok: true, data }
  } catch (err) {
    return toFailure(err)
  }
}

/** Records an important admin change. */
export async function audit(
  ctx: AdminContext,
  entry: {
    action: string
    entity: string
    entityId?: string | null
    summary: string
    detail?: Record<string, unknown>
  },
) {
  await ctx.db.insert(t.auditLog).values({
    salonId: ctx.salonId,
    adminUserId: ctx.actor.adminUserId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    summary: entry.summary,
    detail: entry.detail ?? null,
    ipHash: ctx.ipHash ?? null,
    createdAt: ctx.now,
  })
}
