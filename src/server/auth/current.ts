import 'server-only'
import { redirect } from 'next/navigation'
import { hasPermission, type Permission } from '@/lib/auth/permissions'
import { ERR, type Actor, type ServiceContext } from '@/server/context'
import { db } from '@/server/db'
import { clientIp } from '@/server/request'
import { hashIp } from '@/server/security/crypto'
import { getSessionActor, type SessionActor } from './session'

export function toActor(s: SessionActor): Actor {
  return {
    adminUserId: s.adminUserId,
    salonId: s.salonId,
    role: s.role,
    name: s.name,
    permissions: s.permissions,
    staffId: s.role === 'specialist' ? s.staffId : null,
    isDemo: s.isDemo,
    demoVisitorHash: s.demoVisitorHash,
  }
}

/** Page guard: redirects to the login page, or to the overview when a permission is missing. */
export async function requireAdminPage(permission: Permission): Promise<SessionActor> {
  const session = await getSessionActor()
  if (!session) redirect('/admin/login')
  if (!hasPermission(session.permissions, permission)) redirect('/admin?denied=1')
  return session
}

export interface AdminContext extends ServiceContext {
  actor: Actor
  session: SessionActor
}

/** Context for admin server actions: authenticated actor, salon scope, hashed IP. */
export async function adminContext(): Promise<AdminContext> {
  const session = await getSessionActor()
  if (!session) throw ERR.unauthenticated()
  const ip = await clientIp()
  return { db, salonId: session.salonId, actor: toActor(session), session, now: new Date(), ipHash: hashIp(ip) }
}
