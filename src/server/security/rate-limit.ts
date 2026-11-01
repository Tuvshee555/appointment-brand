// Fixed-window rate limiting stored in Postgres, so limits hold across
// serverless instances.
import { sql } from 'drizzle-orm'
import type { Database } from '@/server/db/client'
import { ERR } from '@/server/context'

export interface RateLimitRule {
  name: string
  limit: number
  windowSeconds: number
}

export const LIMITS = {
  login: { name: 'login', limit: 8, windowSeconds: 15 * 60 },
  demoSession: { name: 'demo-session', limit: 12, windowSeconds: 60 * 60 },
  demoMutation: { name: 'demo-mutation', limit: 60, windowSeconds: 60 * 60 },
  availability: { name: 'availability', limit: 240, windowSeconds: 60 },
  booking: { name: 'booking', limit: 8, windowSeconds: 60 * 60 },
  lookup: { name: 'lookup', limit: 20, windowSeconds: 15 * 60 },
  customerChange: { name: 'customer-change', limit: 10, windowSeconds: 60 * 60 },
  payment: { name: 'payment', limit: 30, windowSeconds: 10 * 60 },
  paymentCallback: { name: 'payment-callback', limit: 120, windowSeconds: 60 },
  chat: { name: 'chat', limit: 30, windowSeconds: 10 * 60 },
  chatDaily: { name: 'chat-daily', limit: 120, windowSeconds: 24 * 60 * 60 },
  upload: { name: 'upload', limit: 40, windowSeconds: 60 * 60 },
  messenger: { name: 'messenger', limit: 600, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>

/**
 * `next dev` serves every request from one localhost IP, so limits are 50×
 * looser there unless RATE_LIMITS=strict. Production and tests use real limits.
 */
function effectiveLimit(rule: RateLimitRule): number {
  return process.env.NODE_ENV === 'development' && process.env.RATE_LIMITS !== 'strict' ? rule.limit * 50 : rule.limit
}

export async function hitRateLimit(db: Database, rule: RateLimitRule, subject: string): Promise<boolean> {
  const key = `${rule.name}:${subject}`.slice(0, 200)
  const result = await db.execute<{ count: number }>(sql`
    insert into salon.rate_limits (key, count, window_started_at)
    values (${key}, 1, now())
    on conflict (key) do update set
      count = case
        when salon.rate_limits.window_started_at < now() - make_interval(secs => ${rule.windowSeconds}) then 1
        else salon.rate_limits.count + 1
      end,
      window_started_at = case
        when salon.rate_limits.window_started_at < now() - make_interval(secs => ${rule.windowSeconds}) then now()
        else salon.rate_limits.window_started_at
      end
    returning count
  `)
  return (result.rows[0]?.count ?? 0) <= effectiveLimit(rule)
}

/** Throws a Mongolian "too many attempts" error when the limit is exceeded. */
export async function enforceRateLimit(db: Database, rule: RateLimitRule, subject: string | null | undefined) {
  if (!(await hitRateLimit(db, rule, subject || 'anonymous'))) throw ERR.rateLimited()
}

export async function pruneRateLimits(db: Database) {
  await db.execute(sql`delete from salon.rate_limits where window_started_at < now() - interval '2 days'`)
}
