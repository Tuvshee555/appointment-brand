// Daily maintenance (Vercel Cron, Bearer CRON_SECRET): expire unpaid holds and
// unanswered past requests, queue reminders, prune rate limits and old demo
// chats, and — in DEMO_MODE only — refresh the sample data to today's dates.
import { and, eq, lt } from 'drizzle-orm'
import { db } from '@/server/db'
import * as t from '@/server/db/schema'
import { expireStaleHolds, expireUnhandledRequests, queueReminders } from '@/server/services/booking'
import { loadSalonConfig } from '@/server/services/salon'
import { pruneRateLimits } from '@/server/security/rate-limit'
import { deleteDemoData, seedDemo } from '@/server/seed/demo'

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`)
    return new Response('unauthorized', { status: 401 })
  const now = new Date()
  const report: Record<string, unknown> = {}
  const salons = await db.select().from(t.salons)
  for (const salon of salons) {
    const config = await loadSalonConfig(db, salon.id)
    if (salon.isDemo && process.env.DEMO_MODE === 'true') {
      // One transaction: visitors see either yesterday's sample data or today's, never an empty salon.
      const demoReset = await db.transaction(async (tx) => {
        await deleteDemoData(tx, salon.id)
        return seedDemo(tx, { salonId: salon.id, now, force: true })
      })
      report[salon.slug] = { demoReset }
      continue
    }
    report[salon.slug] = {
      expiredHolds: await expireStaleHolds(db, salon.id, now),
      expiredRequests: await expireUnhandledRequests(db, salon.id, now),
      reminders: await queueReminders(db, salon.id, now, config.settings.reminderHoursBefore),
    }
  }
  await pruneRateLimits(db)
  await db.delete(t.adminSessions).where(lt(t.adminSessions.expiresAt, now))
  await db
    .delete(t.chatSessions)
    .where(
      and(eq(t.chatSessions.isDemo, true), lt(t.chatSessions.lastMessageAt, new Date(now.getTime() - 7 * 86_400_000))),
    )
  return Response.json({ ok: true, at: now.toISOString(), report })
}
