import 'server-only'
import { and, eq, gt, sql } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { BASE_PATH } from '@/lib/base-path'
import type { RoleKey } from '@/lib/auth/permissions'
import { db } from '@/server/db'
import * as t from '@/server/db/schema'
import { randomToken, sha256Hex } from '@/server/security/crypto'

export const SESSION_COOKIE = 'sv_admin'
const STAFF_SESSION_HOURS = 12
export const DEMO_SESSION_MINUTES = 60

export interface SessionActor {
  sessionId: string
  adminUserId: string
  salonId: string
  name: string
  email: string
  role: RoleKey
  roleName: string
  permissions: string[]
  staffId: string | null
  isDemo: boolean
  demoVisitorHash: string | null
  expiresAt: Date
}

export async function createSession(
  adminUserId: string,
  opts: { userAgent: string | null; ipHash: string | null; demo?: { visitorHash: string | null } },
) {
  const token = randomToken(32)
  const expiresAt = new Date(Date.now() + (opts.demo ? DEMO_SESSION_MINUTES * 60_000 : STAFF_SESSION_HOURS * 3_600_000))
  await db.insert(t.adminSessions).values({
    id: sha256Hex(token),
    adminUserId,
    expiresAt,
    isDemo: Boolean(opts.demo),
    demoVisitorHash: opts.demo?.visitorHash ?? null,
    userAgent: opts.userAgent?.slice(0, 255) ?? null,
    ipHash: opts.ipHash,
  })
  if (!opts.demo) await db.update(t.adminUsers).set({ lastLoginAt: new Date() }).where(eq(t.adminUsers.id, adminUserId))
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: BASE_PATH || '/',
    expires: expiresAt,
  })
}

/** The signed-in staff member for this request (memoised per request). */
export const getSessionActor = cache(async (): Promise<SessionActor | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token || token.length > 100) return null
  const rows = await db
    .select({
      sessionId: t.adminSessions.id,
      expiresAt: t.adminSessions.expiresAt,
      isDemo: t.adminSessions.isDemo,
      demoVisitorHash: t.adminSessions.demoVisitorHash,
      adminUserId: t.adminUsers.id,
      salonId: t.adminUsers.salonId,
      name: t.adminUsers.name,
      email: t.adminUsers.email,
      role: t.adminUsers.roleKey,
      staffId: t.adminUsers.staffId,
      roleName: t.adminRoles.name,
      permissions: t.adminRoles.permissions,
    })
    .from(t.adminSessions)
    .innerJoin(t.adminUsers, eq(t.adminUsers.id, t.adminSessions.adminUserId))
    .innerJoin(t.adminRoles, eq(t.adminRoles.key, t.adminUsers.roleKey))
    // Expiry is compared with the database clock (no JS clock read during render).
    .where(
      and(
        eq(t.adminSessions.id, sha256Hex(token)),
        gt(t.adminSessions.expiresAt, sql`now()`),
        eq(t.adminUsers.isActive, true),
      ),
    )
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return { ...row, role: row.role as RoleKey }
})

export async function destroySession() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) await db.delete(t.adminSessions).where(eq(t.adminSessions.id, sha256Hex(token)))
  jar.delete({ name: SESSION_COOKIE, path: BASE_PATH || '/' })
}
