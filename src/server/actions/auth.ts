'use server'

import { and, eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { password } from '@/lib/validation/common'
import { DUMMY_PASSWORD_HASH, verifyPassword } from '@/server/auth/password'
import { createSession, destroySession } from '@/server/auth/session'
import { ServiceError } from '@/server/context'
import * as t from '@/server/db/schema'
import { isDemoMode } from '@/server/notifications'
import { publicContext, userAgent, visitorHash } from '@/server/request'
import { enforceRateLimit, LIMITS } from '@/server/security/rate-limit'
import { DEMO_SPECIALIST_EMAIL, DEMO_VIEWER_EMAIL } from '@/server/seed/base'
import { toFailure, type ActionResult } from './result'

const loginSchema = z.object({
  email: z.string({ error: 'И-мэйлээ оруулна уу.' }).trim().toLowerCase().max(254),
  password,
})

export async function loginAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const { email, password: pass } = loginSchema.parse(input)
    const ctx = await publicContext()
    await enforceRateLimit(ctx.db, LIMITS.login, ctx.ipHash)
    const [user] = await ctx.db
      .select()
      .from(t.adminUsers)
      .where(and(eq(t.adminUsers.email, email), eq(t.adminUsers.salonId, ctx.salonId), eq(t.adminUsers.isActive, true)))
    // Constant-time path for unknown accounts and passwordless (demo) accounts.
    const ok = await verifyPassword(pass, user?.passwordHash ?? DUMMY_PASSWORD_HASH)
    if (!user || !user.passwordHash || !ok) throw new ServiceError('invalid_login', 'И-мэйл эсвэл нууц үг буруу байна.')
    await createSession(user.id, { userAgent: await userAgent(), ipHash: ctx.ipHash ?? null })
  } catch (err) {
    return toFailure(err)
  }
  redirect('/admin')
}

/** Public portfolio demo: a read-only, 60-minute session on the fictional salon. */
export async function startDemoAction(input: unknown): Promise<ActionResult<null>> {
  try {
    const { view } = z.object({ view: z.enum(['owner', 'specialist']) }).parse(input)
    if (!isDemoMode()) throw new ServiceError('demo_disabled', 'Демо нэвтрэлт энэ орчинд идэвхгүй.')
    const ctx = await publicContext()
    const [salon] = await ctx.db.select({ isDemo: t.salons.isDemo }).from(t.salons).where(eq(t.salons.id, ctx.salonId))
    if (!salon?.isDemo) throw new ServiceError('demo_disabled', 'Демо нэвтрэлт зөвхөн зохиомол салонд ажиллана.')
    await enforceRateLimit(ctx.db, LIMITS.demoSession, ctx.ipHash)
    const [user] = await ctx.db
      .select({ id: t.adminUsers.id })
      .from(t.adminUsers)
      .where(and(eq(t.adminUsers.email, view === 'owner' ? DEMO_VIEWER_EMAIL : DEMO_SPECIALIST_EMAIL), eq(t.adminUsers.salonId, ctx.salonId)))
    if (!user) throw new ServiceError('demo_missing', 'Демо хэрэглэгч олдсонгүй. Өгөгдлийн санг seed хийнэ үү.')
    await createSession(user.id, {
      userAgent: await userAgent(),
      ipHash: ctx.ipHash ?? null,
      demo: { visitorHash: await visitorHash({ create: true }) },
    })
  } catch (err) {
    return toFailure(err)
  }
  redirect('/admin')
}

export async function logoutAction() {
  await destroySession()
  redirect('/admin/login')
}
