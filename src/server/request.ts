import 'server-only'
import { cookies, headers } from 'next/headers'
import { BASE_PATH } from '@/lib/base-path'
import { db } from '@/server/db'
import type { ServiceContext } from '@/server/context'
import { hashIp, randomToken, sha256Hex } from '@/server/security/crypto'
import { resolveSalonId } from '@/server/services/salon'

export async function clientIp(): Promise<string | null> {
  const h = await headers()
  const forwarded = h.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() || null
  return h.get('x-real-ip')
}

export async function userAgent(): Promise<string | null> {
  return (await headers()).get('user-agent')
}

/** Context for public (anonymous) requests. */
export async function publicContext(): Promise<ServiceContext> {
  const [salonId, ip] = await Promise.all([resolveSalonId(db), clientIp()])
  return { db, salonId, actor: null, now: new Date(), ipHash: hashIp(ip) }
}

export const VISITOR_COOKIE = 'sv_visitor'

/**
 * A random, httpOnly visitor id (public demo). Its hash links the visitor's
 * sample bookings to their demo admin session so they can manage only those.
 */
export async function visitorHash({ create }: { create: boolean }): Promise<string | null> {
  const jar = await cookies()
  let id = jar.get(VISITOR_COOKIE)?.value
  if ((!id || id.length > 64) && create) {
    id = randomToken(18)
    jar.set(VISITOR_COOKIE, id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: BASE_PATH || '/',
      maxAge: 60 * 60 * 24 * 30,
    })
  }
  return id ? sha256Hex(`visitor:${id}`) : null
}
