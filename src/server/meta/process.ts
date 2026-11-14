// Works through stored webhook receipts: a customer message is answered by
// the business's own assistant (the adapter), a staff reply typed in the Page
// inbox makes the assistant step back, and a comment that asks for price or
// availability gets one private reply — only when the owner has enabled it.
//
// Safety rules, in order:
// - a receipt is handled once (claim + lease); its reply parts are counted, so
//   a retry never repeats a part that was delivered;
// - nothing is sent unless META_OUTBOUND_ENABLED=true (replies are still
//   generated and logged, marked "suppressed");
// - only replies to what the person just did, inside Meta's windows (24 hours
//   for messages, 7 days for a comment's private reply), never a broadcast;
// - an uncertain delivery (timeout) is never resent automatically.
import 'server-only'
import type { Database } from '@/server/db/client'
import type { MetaConfig } from './config'
import { commentMatches, type MetaPlatform } from './events'
import { BOT_METADATA, chunkText, quickReplies, sendMessage, type Chip, type Delivery } from './graph'
import {
  claimReceipt,
  failReceipt,
  finishReceipt,
  rememberSent,
  REPLY_WINDOW_MS,
  saveProgress,
  staleReceipts,
  wasSentByUs,
  type ReceiptPayload,
} from './receipts'

const COMMENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export interface MetaReply {
  text: string
  /** Quick-reply chips under the last message: a label, or a label with its own payload (e.g. a confirmation). */
  suggestions?: Chip[]
}

/** What each business plugs in: its own assistant and its own takeover rules. */
export interface MetaAdapter {
  /**
   * Runs the business's assistant for one customer message. `messageId` is
   * stable across retries (the engine's own de-duplication uses it). Returns
   * null when no automated reply is due (assistant switched off, a person has
   * taken the conversation over).
   */
  answer(
    db: Database,
    input: { platform: MetaPlatform; accountId: string; senderId: string; text: string; messageId: string; at: Date },
  ): Promise<MetaReply | null>
  /** A person replied from the Page inbox: the assistant leaves this conversation to staff. */
  staffReplied(
    db: Database,
    input: { platform: MetaPlatform; accountId: string; customerId: string; text: string; messageId: string; at: Date },
  ): Promise<void>
  /** The one private reply sent to a matching comment. */
  commentReply: string
  /** Sent when someone sends only a photo or a sticker. */
  attachmentReply: string
}

function log(code: string, details: Record<string, string | number | null> = {}) {
  // Codes and ids only — never message text or tokens.
  console.info(JSON.stringify({ scope: 'meta', code, ...details }))
}

async function deliver(
  db: Database,
  config: MetaConfig,
  receipt: ReceiptPayload,
  platform: MetaPlatform,
  recipient: { id: string } | { comment_id: string },
  reply: MetaReply,
): Promise<{ status: 'done' | 'retry'; outcome: string }> {
  if (!config.outbound) return { status: 'done', outcome: 'suppressed' }
  const parts = 'comment_id' in recipient ? [reply.text.slice(0, 1_000)] : chunkText(reply.text)
  let sent = receipt.sentChunks ?? 0
  for (let i = sent; i < parts.length; i++) {
    const last = i === parts.length - 1
    const result: Delivery = await sendMessage(config, platform, recipient, {
      text: parts[i],
      ...(last && reply.suggestions?.length ? { quick_replies: quickReplies(reply.suggestions) } : {}),
    })
    if (result.status === 'uncertain') return { status: 'done', outcome: 'uncertain' }
    if (result.status === 'failed') return { status: 'retry', outcome: `send_failed:${result.code}` }
    if (result.messageId) await rememberSent(db, platform, receipt.accountId, result.messageId).catch(() => undefined)
    sent = i + 1
    await saveProgress(db, receipt.key, { ...receipt, sentChunks: sent })
  }
  return { status: 'done', outcome: 'sent' }
}

async function ownEcho(db: Database, mid: string, metadata: string | null, appId: string | null): Promise<boolean> {
  if (metadata === BOT_METADATA) return true
  const ourApp = process.env.META_APP_ID?.trim()
  if (ourApp && appId === ourApp) return true
  if (await wasSentByUs(db, mid)) return true
  // The echo can overtake our own bookkeeping of the send by a moment.
  await new Promise((r) => setTimeout(r, 1_500))
  return wasSentByUs(db, mid)
}

/** Handles one stored receipt. Never throws: failures are written to the receipt. */
export async function processReceipt(
  db: Database,
  config: MetaConfig,
  adapter: MetaAdapter,
  key: string,
  now = new Date(),
): Promise<void> {
  const row = await claimReceipt(db, key, now)
  if (!row) return
  const event = row.payload as ReceiptPayload
  try {
    if (event.kind === 'message' || event.kind === 'postback') {
      if (now.getTime() - event.at > REPLY_WINDOW_MS) return finishReceipt(db, key, 'expired', 'outside_24h_window')
      const reply =
        event.kind === 'message' && event.attachmentOnly
          ? { text: adapter.attachmentReply }
          : await adapter.answer(db, {
              platform: event.platform,
              accountId: event.accountId,
              senderId: event.senderId,
              text: event.text,
              messageId: event.mid,
              at: new Date(event.at),
            })
      if (!reply || !reply.text.trim()) return finishReceipt(db, key, 'done', 'no_reply')
      const result = await deliver(db, config, event, event.platform, { id: event.senderId }, reply)
      if (result.status === 'retry') return failReceipt(db, key, result.outcome)
      log('meta.replied', { platform: event.platform, outcome: result.outcome })
      return finishReceipt(db, key, 'done', result.outcome)
    }
    if (event.kind === 'echo') {
      if (await ownEcho(db, event.mid, event.metadata, event.appId))
        return finishReceipt(db, key, 'skipped', 'own_message')
      await adapter.staffReplied(db, {
        platform: event.platform,
        accountId: event.accountId,
        customerId: event.recipientId,
        text: event.text,
        messageId: event.mid,
        at: new Date(event.at),
      })
      log('meta.staff_reply', { platform: event.platform })
      return finishReceipt(db, key, 'done', 'staff_took_over')
    }
    if (event.kind === 'comment') {
      if (!config.commentReplies) return finishReceipt(db, key, 'skipped', 'comment_replies_off')
      if (!commentMatches(event.text, config.commentKeywords))
        return finishReceipt(db, key, 'skipped', 'no_trigger_word')
      if (now.getTime() - event.at > COMMENT_WINDOW_MS) return finishReceipt(db, key, 'expired', 'outside_7d_window')
      const result = await deliver(
        db,
        config,
        event,
        event.platform,
        { comment_id: event.commentId },
        { text: adapter.commentReply },
      )
      if (result.status === 'retry') return failReceipt(db, key, result.outcome)
      log('meta.comment_reply', { platform: event.platform, outcome: result.outcome })
      return finishReceipt(db, key, 'done', result.outcome)
    }
    return finishReceipt(db, key, 'skipped', 'unsupported')
  } catch (err) {
    log('meta.process_error', { kind: event.kind, error: err instanceof Error ? err.name : 'unknown' })
    await failReceipt(
      db,
      key,
      `error:${err instanceof Error ? ((err as { code?: string }).code ?? err.name) : 'unknown'}`,
    ).catch(() => undefined)
  }
}

/** Runs after Meta has its 200: the new receipts, then a few left over from an interrupted run. */
export async function runMetaQueue(
  db: Database,
  config: MetaConfig,
  adapter: MetaAdapter,
  keys: string[],
): Promise<void> {
  for (const key of keys) await processReceipt(db, config, adapter, key)
  const stale = await staleReceipts(db).catch(() => [])
  for (const key of stale) if (!keys.includes(key)) await processReceipt(db, config, adapter, key)
}
