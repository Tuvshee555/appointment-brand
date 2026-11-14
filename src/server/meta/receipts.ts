// Webhook receipts: every accepted event is stored BEFORE Meta gets its 200, so
// nothing is lost if processing dies, and a retried delivery (same event id)
// is recognised instead of answered twice. Processing claims a receipt with a
// short lease; a crashed attempt becomes claimable again when its lease ends.
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm'
import type { Database } from '@/server/db/client'
import * as t from '@/server/db/schema'
import { eventKey, type MetaEvent, type MetaPlatform } from './events'

export const MAX_ATTEMPTS = 5
const LEASE_MS = 90_000
/** Meta's standard messaging window is 24 hours; nothing older is answered automatically. */
export const REPLY_WINDOW_MS = 23 * 60 * 60 * 1000

export type Receipt = typeof t.metaWebhookEvents.$inferSelect
export type ReceiptPayload = MetaEvent & { sentChunks?: number }

/** Stores new events; an event already stored (a Meta retry) is left as it is. */
export async function recordEvents(db: Database, events: MetaEvent[]): Promise<void> {
  if (!events.length) return
  await db
    .insert(t.metaWebhookEvents)
    .values(
      events.map((e) => ({
        id: e.key,
        platform: e.platform,
        kind: e.kind,
        accountId: e.accountId,
        payload: e,
        eventAt: new Date(e.at),
      })),
    )
    .onConflictDoNothing()
}

/** Takes one receipt for processing, or null when it is done, being processed or out of attempts. */
export async function claimReceipt(db: Database, key: string, now = new Date()): Promise<Receipt | null> {
  const [row] = await db
    .update(t.metaWebhookEvents)
    .set({
      status: 'processing',
      attempts: sql`${t.metaWebhookEvents.attempts} + 1`,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
    })
    .where(
      and(
        eq(t.metaWebhookEvents.id, key),
        lt(t.metaWebhookEvents.attempts, MAX_ATTEMPTS),
        or(
          inArray(t.metaWebhookEvents.status, ['pending', 'failed']),
          and(eq(t.metaWebhookEvents.status, 'processing'), lt(t.metaWebhookEvents.leaseUntil, now)),
        ),
      ),
    )
    .returning()
  return row ?? null
}

/** Remembers how many reply parts were delivered, so a retry never repeats them. */
export async function saveProgress(db: Database, key: string, payload: ReceiptPayload): Promise<void> {
  await db.update(t.metaWebhookEvents).set({ payload }).where(eq(t.metaWebhookEvents.id, key))
}

/**
 * Closes a receipt. The customer's text is dropped from it once handled: the
 * conversation itself keeps the history, the receipt only what is needed to
 * recognise a retry.
 */
export async function finishReceipt(
  db: Database,
  key: string,
  status: 'done' | 'skipped' | 'expired',
  outcome: string,
): Promise<void> {
  await db
    .update(t.metaWebhookEvents)
    .set({
      status,
      outcome: outcome.slice(0, 80),
      leaseUntil: null,
      processedAt: new Date(),
      payload: sql`${t.metaWebhookEvents.payload} - 'text'`,
    })
    .where(eq(t.metaWebhookEvents.id, key))
}

/** Gives a receipt back for a later attempt (or leaves it failed after the last one). */
export async function failReceipt(db: Database, key: string, outcome: string): Promise<void> {
  await db
    .update(t.metaWebhookEvents)
    .set({ status: 'failed', outcome: outcome.slice(0, 80), leaseUntil: null })
    .where(eq(t.metaWebhookEvents.id, key))
}

/** Receipts left behind by an interrupted run, oldest first, still inside the reply window. */
export async function staleReceipts(db: Database, now = new Date(), limit = 5): Promise<string[]> {
  const rows = await db
    .select({ id: t.metaWebhookEvents.id })
    .from(t.metaWebhookEvents)
    .where(
      and(
        lt(t.metaWebhookEvents.attempts, MAX_ATTEMPTS),
        sql`${t.metaWebhookEvents.createdAt} > ${new Date(now.getTime() - REPLY_WINDOW_MS)}`,
        or(
          and(
            inArray(t.metaWebhookEvents.status, ['pending', 'failed']),
            lt(t.metaWebhookEvents.createdAt, new Date(now.getTime() - 30_000)),
          ),
          and(eq(t.metaWebhookEvents.status, 'processing'), lt(t.metaWebhookEvents.leaseUntil, now)),
        ),
      ),
    )
    .orderBy(t.metaWebhookEvents.eventAt)
    .limit(limit)
  return rows.map((r) => r.id)
}

/** Our own sent messages, so their echoes are told apart from a person writing in the Page inbox. */
export async function rememberSent(
  db: Database,
  platform: MetaPlatform,
  accountId: string,
  messageId: string,
): Promise<void> {
  const key = eventKey('sent', messageId)
  await db
    .insert(t.metaWebhookEvents)
    .values({
      id: key,
      platform,
      kind: 'sent',
      accountId,
      payload: {},
      status: 'done',
      outcome: 'sent',
      eventAt: new Date(),
      processedAt: new Date(),
    })
    .onConflictDoNothing()
}

export async function wasSentByUs(db: Database, messageId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: t.metaWebhookEvents.id })
    .from(t.metaWebhookEvents)
    .where(eq(t.metaWebhookEvents.id, eventKey('sent', messageId)))
    .limit(1)
  return !!row
}

/** Receipts older than the retention period are removed (by the daily maintenance job). */
export async function purgeReceipts(db: Database, olderThanDays = 30, now = new Date()): Promise<number> {
  const rows = await db
    .delete(t.metaWebhookEvents)
    .where(lt(t.metaWebhookEvents.createdAt, new Date(now.getTime() - olderThanDays * 86_400_000)))
    .returning({ id: t.metaWebhookEvents.id })
  return rows.length
}
