// Turns a verified webhook body into a short list of normalized events.
// Only the Page and Instagram account configured for THIS deployment are
// accepted: an app subscribed to other Pages can never feed their messages
// into this business's assistant. Everything else (reads, deliveries,
// reactions, other Pages) is dropped here.
import { createHash } from 'node:crypto'
import type { MetaConfig } from './config'

export type MetaPlatform = 'messenger' | 'instagram'

interface Base {
  /** Stable id of the event: a webhook retry carries the same one. */
  key: string
  platform: MetaPlatform
  /** The Page id (Messenger) or Instagram account id the event arrived for. */
  accountId: string
  /** When Meta says it happened (ms). */
  at: number
}

export type MetaEvent =
  | (Base & { kind: 'message'; senderId: string; mid: string; text: string; attachmentOnly: boolean })
  | (Base & { kind: 'postback'; senderId: string; mid: string; text: string })
  | (Base & {
      kind: 'echo'
      recipientId: string
      mid: string
      text: string
      metadata: string | null
      appId: string | null
    })
  | (Base & { kind: 'comment'; commentId: string; fromId: string; text: string })

export const MAX_TEXT = 1200
export const MAX_EVENTS = 50
const ID = /^\d{1,40}$/

type Json = Record<string, unknown>
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export function eventKey(...parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex')
}

function time(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n < 1e12 ? n * 1000 : n // comments use seconds, messaging uses milliseconds
}

export class MetaPayloadError extends Error {}

export function parseWebhook(
  body: unknown,
  config: Pick<MetaConfig, 'pageId' | 'instagramId'>,
  now = Date.now(),
): MetaEvent[] {
  const root = obj(body)
  if (!root || (root.object !== 'page' && root.object !== 'instagram')) throw new MetaPayloadError('object')
  const platform: MetaPlatform = root.object === 'instagram' ? 'instagram' : 'messenger'
  const account = platform === 'instagram' ? config.instagramId : config.pageId
  const events: MetaEvent[] = []
  for (const rawEntry of list(root.entry)) {
    const entry = obj(rawEntry)
    if (!entry) continue
    const accountId = str(entry.id)
    // Routing: only this deployment's own Page / Instagram account.
    if (!account || accountId !== account) continue

    for (const rawEvent of list(entry.messaging)) {
      const event = obj(rawEvent)
      if (!event) continue
      const senderId = str(obj(event.sender)?.id)
      const recipientId = str(obj(event.recipient)?.id)
      const at = time(event.timestamp, now)
      const message = obj(event.message)
      const postback = obj(event.postback)
      if (message) {
        const mid = str(message.mid)
        if (!mid || mid.length > 400) continue
        if (message.is_echo === true) {
          if (!ID.test(recipientId)) continue
          events.push({
            kind: 'echo',
            key: eventKey('echo', platform, accountId, mid),
            platform,
            accountId,
            at,
            recipientId,
            mid,
            text: str(message.text).trim().slice(0, MAX_TEXT),
            metadata: str(message.metadata) || null,
            appId: str(message.app_id) || null,
          })
          continue
        }
        if (!ID.test(senderId) || senderId === accountId) continue
        // A tapped quick reply carries the full label as its payload; the visible text may be shortened.
        const text = (str(obj(message.quick_reply)?.payload) || str(message.text)).trim().slice(0, MAX_TEXT)
        const attachmentOnly = !text && list(message.attachments).length > 0
        if (!text && !attachmentOnly) continue
        events.push({
          kind: 'message',
          key: eventKey('message', platform, accountId, mid),
          platform,
          accountId,
          at,
          senderId,
          mid,
          text,
          attachmentOnly,
        })
      } else if (postback) {
        if (!ID.test(senderId) || senderId === accountId) continue
        // A button's payload is used when it carries a structured action; otherwise its visible title.
        const payload = str(postback.payload)
        const text = (/^(?:action:|\{)/.test(payload) ? payload : str(postback.title) || payload)
          .trim()
          .slice(0, MAX_TEXT)
        if (!text) continue
        const mid = str(postback.mid) || `${senderId}:${at}:${str(postback.payload).slice(0, 200)}`
        events.push({
          kind: 'postback',
          key: eventKey('postback', platform, accountId, mid),
          platform,
          accountId,
          at,
          senderId,
          mid,
          text,
        })
      }
    }

    for (const rawChange of list(entry.changes)) {
      const change = obj(rawChange)
      const v = obj(change?.value)
      if (!change || !v) continue
      if (platform === 'messenger' && change.field === 'feed' && v.item === 'comment' && v.verb === 'add') {
        const commentId = str(v.comment_id)
        const fromId = str(obj(v.from)?.id)
        if (!commentId || !ID.test(fromId) || fromId === accountId) continue
        events.push({
          kind: 'comment',
          key: eventKey('comment', platform, accountId, commentId),
          platform,
          accountId,
          at: time(v.created_time, now),
          commentId,
          fromId,
          text: str(v.message).trim().slice(0, MAX_TEXT),
        })
      }
      if (platform === 'instagram' && change.field === 'comments') {
        const commentId = str(v.id)
        const fromId = str(obj(v.from)?.id)
        if (!commentId || !ID.test(fromId) || fromId === accountId) continue
        events.push({
          kind: 'comment',
          key: eventKey('comment', platform, accountId, commentId),
          platform,
          accountId,
          at: time(entry.time, now),
          commentId,
          fromId,
          text: str(v.text).trim().slice(0, MAX_TEXT),
        })
      }
    }
  }
  if (events.length > MAX_EVENTS) throw new MetaPayloadError('too_many_events')
  return events
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Whether a comment contains a trigger word. A keyword matches at the start of
 * a word (Mongolian stems take suffixes: «захиал» matches «захиалъя»), so a
 * short one like «dm» does not fire inside «admin». Cyrillic and Latin alike.
 */
export function commentMatches(text: string, keywords: string[]): boolean {
  const t = text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')
  return keywords.some((k) => k && new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(k.toLowerCase())}`, 'u').test(t))
}
