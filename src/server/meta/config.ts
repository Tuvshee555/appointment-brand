// Meta (Messenger, Instagram) configuration. Every value is server-only: no
// token or secret ever has a NEXT_PUBLIC_ name, reaches the browser or a log.
// The webhook stays closed (503) until the app secret, the verify token, the
// Page id and the Page token are all set. Sending is a second, separate switch.
import 'server-only'

export interface MetaConfig {
  /** Meta App → Settings → Basic → App secret. Signs every webhook delivery. */
  appSecret: string
  /** A random string you also type into the App Dashboard's webhook form. */
  verifyToken: string
  /** The one Facebook Page this deployment answers for. */
  pageId: string
  /** A Page access token for that Page (pages_messaging; instagram_manage_messages for Instagram). */
  pageToken: string
  /** The Instagram professional account linked to the Page, if Instagram is used. */
  instagramId: string | null
  /** Graph API version, e.g. v25.0. */
  graphVersion: string
  /** Replies are actually sent only when this is true; otherwise they are recorded as suppressed. */
  outbound: boolean
  /** Private replies to comments that match a trigger word (one per comment). */
  commentReplies: boolean
  /** Trigger words for comment replies. */
  commentKeywords: string[]
}

const DIGITS = /^\d{5,40}$/
const VERSION = /^v\d{1,3}\.\d$/

/** Default comment triggers: price, availability, order and "write to me" in Cyrillic and Latin Mongolian. */
export const DEFAULT_COMMENT_KEYWORDS = [
  'үнэ',
  'une',
  'хэд',
  'hed',
  'хэдээр',
  'hedeer',
  'захиал',
  'zahial',
  'zakhial',
  'байгаа юу',
  'baigaa yu',
  'bga yu',
  'үлдэгдэл',
  'uldegdel',
  'хэмжээ',
  'hemjee',
  'size',
  'price',
  'dm',
  'inbox',
  'инбокс',
  'чат',
  'chat',
  'мэдээлэл',
  'medeelel',
]

function value(name: string): string {
  return (process.env[name] ?? '').trim()
}

/** The configuration, or null while any required value is missing or malformed. */
export function metaConfig(): MetaConfig | null {
  const appSecret = value('META_APP_SECRET')
  const verifyToken = value('META_VERIFY_TOKEN')
  const pageId = value('META_PAGE_ID')
  const pageToken = value('META_PAGE_ACCESS_TOKEN')
  const instagramId = value('META_INSTAGRAM_ACCOUNT_ID')
  const graphVersion = value('META_GRAPH_API_VERSION') || 'v25.0'
  if (!appSecret || verifyToken.length < 16 || !DIGITS.test(pageId) || !pageToken) return null
  if (instagramId && !DIGITS.test(instagramId)) return null
  if (!VERSION.test(graphVersion)) return null
  const keywords = value('META_COMMENT_KEYWORDS')
  return {
    appSecret,
    verifyToken,
    pageId,
    pageToken,
    instagramId: instagramId || null,
    graphVersion,
    outbound: value('META_OUTBOUND_ENABLED') === 'true',
    commentReplies: value('META_COMMENT_REPLIES_ENABLED') === 'true',
    commentKeywords: keywords
      ? keywords
          .split(',')
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean)
      : DEFAULT_COMMENT_KEYWORDS,
  }
}

/** Which required variables are missing, by name only (for the admin's setup page and logs). */
export function missingMetaVariables(): string[] {
  const missing: string[] = []
  if (!value('META_APP_SECRET')) missing.push('META_APP_SECRET')
  if (value('META_VERIFY_TOKEN').length < 16) missing.push('META_VERIFY_TOKEN')
  if (!DIGITS.test(value('META_PAGE_ID'))) missing.push('META_PAGE_ID')
  if (!value('META_PAGE_ACCESS_TOKEN')) missing.push('META_PAGE_ACCESS_TOKEN')
  return missing
}
