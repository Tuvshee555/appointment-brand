// Shared types for server services. Services receive everything they need in a
// ServiceContext (no Next.js imports), which keeps them callable from server
// actions, route handlers, scripts and integration tests alike.
import type { Permission, RoleKey } from '@/lib/auth/permissions'
import type { Database } from '@/server/db/client'

export interface Actor {
  adminUserId: string
  salonId: string
  role: RoleKey
  name: string
  permissions: string[]
  /** Specialist accounts see only their own appointments. */
  staffId: string | null
  /** Public portfolio visitor exploring the dashboard. */
  isDemo: boolean
  /** Links a demo session to the visitor's own sample bookings. */
  demoVisitorHash: string | null
}

export interface ServiceContext {
  db: Database
  salonId: string
  actor: Actor | null
  now: Date
  /** Hashed client IP, for rate limits and audit (never the raw IP). */
  ipHash?: string | null
}

/** A business-rule failure with a Mongolian, user-presentable message. */
export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
    /** Extra data for the caller (e.g. alternative slots after a conflict). */
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}

export const ERR = {
  unauthenticated: () => new ServiceError('unauthenticated', 'Нэвтэрч орно уу.'),
  forbidden: () => new ServiceError('forbidden', 'Танд энэ үйлдлийг хийх эрх байхгүй байна.'),
  notFound: (what = 'Мэдээлэл') => new ServiceError('not_found', `${what} олдсонгүй.`),
  rateLimited: () => new ServiceError('rate_limited', 'Хэт олон оролдлого хийлээ. Түр хүлээгээд дахин оролдоно уу.'),
  slotTaken: (details?: unknown) =>
    new ServiceError('slot_unavailable', 'Энэ цаг дөнгөж сая захиалагдсан эсвэл боломжгүй болсон байна. Өөр цаг сонгоно уу.', undefined, details),
}

export function requirePermission(ctx: ServiceContext, permission: Permission): Actor {
  if (!ctx.actor) throw ERR.unauthenticated()
  if (!ctx.actor.permissions.includes(permission)) throw ERR.forbidden()
  if (ctx.actor.salonId !== ctx.salonId) throw ERR.forbidden()
  return ctx.actor
}
