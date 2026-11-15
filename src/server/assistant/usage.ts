// Model spend ledger and the daily budget (Lorentz aiUsage pattern): every call is counted per
// day, environment, model and purpose with an estimated cost; over the owner's budget the
// assistant keeps answering from its rules. Test-chat calls count too (they cost real money).
import { and, eq, sql } from 'drizzle-orm'
import { dateKeyOf } from '@/lib/datetime'
import type { Database } from '@/server/db/client'
import * as t from '@/server/db/schema'
import { estimateCostUsd } from './engine/model'

export function usageEnvironment(): string {
  return (
    process.env.AI_USAGE_ENVIRONMENT || process.env.VERCEL_ENV || (process.env.NODE_ENV === 'test' ? 'test' : 'local')
  )
}

export async function recordModelUsage(
  db: Database,
  now: Date,
  u: { provider: string; model: string; source: string; inputTokens: number; outputTokens: number; ok: boolean },
) {
  const cost = estimateCostUsd(u.model, u.inputTokens, u.outputTokens)
  await db
    .insert(t.assistantUsage)
    .values({
      day: dateKeyOf(now),
      environment: usageEnvironment(),
      provider: u.provider,
      model: u.model,
      source: u.source,
      calls: u.ok ? 1 : 0,
      failures: u.ok ? 0 : 1,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      costUsd: cost,
    })
    .onConflictDoUpdate({
      target: [t.assistantUsage.day, t.assistantUsage.environment, t.assistantUsage.model, t.assistantUsage.source],
      set: {
        calls: sql`${t.assistantUsage.calls} + ${u.ok ? 1 : 0}`,
        failures: sql`${t.assistantUsage.failures} + ${u.ok ? 0 : 1}`,
        inputTokens: sql`${t.assistantUsage.inputTokens} + ${u.inputTokens}`,
        outputTokens: sql`${t.assistantUsage.outputTokens} + ${u.outputTokens}`,
        costUsd: sql`${t.assistantUsage.costUsd} + ${cost}`,
      },
    })
}

/** Today's estimated spend in this environment (all models and purposes). */
export async function spentTodayUsd(db: Database, now: Date): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${t.assistantUsage.costUsd}), 0)::float8` })
    .from(t.assistantUsage)
    .where(and(eq(t.assistantUsage.day, dateKeyOf(now)), eq(t.assistantUsage.environment, usageEnvironment())))
  return Number(row?.total ?? 0)
}

/** 0 or less means no limit. */
export function withinBudget(spent: number, budget: number): boolean {
  return !(budget > 0) || spent < budget
}
