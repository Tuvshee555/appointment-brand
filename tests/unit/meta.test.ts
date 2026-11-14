// Meta webhook building blocks: signatures, routing by Page / Instagram id,
// event normalisation, comment triggers (Cyrillic and Latin Mongolian) and
// message sizing. No network, no database.
import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_COMMENT_KEYWORDS, metaConfig, missingMetaVariables } from '@/server/meta/config'
import { commentMatches, MetaPayloadError, parseWebhook } from '@/server/meta/events'
import { chunkText, quickReplies } from '@/server/meta/graph'
import { validSignature, validVerifyToken } from '@/server/meta/signature'

const PAGE = '1111111111'
const IG = '2222222222'
const config = { pageId: PAGE, instagramId: IG }

afterEach(() => vi.unstubAllEnvs())

describe('signature', () => {
  const body = Buffer.from('{"object":"page","entry":[{"id":"1","messaging":[{"message":{"text":"Сайн уу 👋"}}]}]}')
  const sign = (secret: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

  it('accepts the app secret signature of the exact bytes, including non-ASCII text', () => {
    expect(validSignature(body, sign('secret'), 'secret')).toBe(true)
  })
  it('rejects a wrong secret, a changed body, a missing or malformed header', () => {
    expect(validSignature(body, sign('other'), 'secret')).toBe(false)
    expect(validSignature(Buffer.from(body.toString().replace('Сайн', 'Сайн!')), sign('secret'), 'secret')).toBe(false)
    expect(validSignature(body, null, 'secret')).toBe(false)
    expect(validSignature(body, 'sha1=abc', 'secret')).toBe(false)
    expect(validSignature(body, sign('secret'), '')).toBe(false)
  })
  it('compares the verify token exactly', () => {
    expect(validVerifyToken('token-1234567890ab', 'token-1234567890ab')).toBe(true)
    expect(validVerifyToken('token-1234567890aB', 'token-1234567890ab')).toBe(false)
    expect(validVerifyToken(null, 'token-1234567890ab')).toBe(false)
  })
})

describe('configuration', () => {
  it('stays closed until every required server-side value is set', () => {
    vi.stubEnv('META_APP_SECRET', 'secret')
    vi.stubEnv('META_VERIFY_TOKEN', 'verify-token-123456')
    vi.stubEnv('META_PAGE_ID', PAGE)
    vi.stubEnv('META_PAGE_ACCESS_TOKEN', '')
    expect(metaConfig()).toBeNull()
    expect(missingMetaVariables()).toEqual(['META_PAGE_ACCESS_TOKEN'])
    vi.stubEnv('META_PAGE_ACCESS_TOKEN', 'page-token')
    const c = metaConfig()!
    expect(c.outbound).toBe(false)
    expect(c.commentReplies).toBe(false)
    expect(c.instagramId).toBeNull()
    vi.stubEnv('META_OUTBOUND_ENABLED', 'true')
    expect(metaConfig()!.outbound).toBe(true)
  })
  it('rejects a short verify token, a malformed Page id or Graph version', () => {
    vi.stubEnv('META_APP_SECRET', 'secret')
    vi.stubEnv('META_PAGE_ACCESS_TOKEN', 'page-token')
    vi.stubEnv('META_VERIFY_TOKEN', 'short')
    vi.stubEnv('META_PAGE_ID', PAGE)
    expect(metaConfig()).toBeNull()
    vi.stubEnv('META_VERIFY_TOKEN', 'verify-token-123456')
    vi.stubEnv('META_PAGE_ID', 'my-page')
    expect(metaConfig()).toBeNull()
    vi.stubEnv('META_PAGE_ID', PAGE)
    vi.stubEnv('META_GRAPH_API_VERSION', 'latest')
    expect(metaConfig()).toBeNull()
  })
})

const message = (sender: string, mid: string, text: string, extra: Record<string, unknown> = {}) => ({
  sender: { id: sender },
  recipient: { id: PAGE },
  timestamp: 1_790_000_000_000,
  message: { mid, text, ...extra },
})

describe('parseWebhook', () => {
  it('normalises Messenger messages, postbacks and quick replies', () => {
    const events = parseWebhook(
      {
        object: 'page',
        entry: [
          {
            id: PAGE,
            messaging: [
              message('333', 'm_1', 'Хар hoodie L байгаа юу?'),
              message('333', 'm_2', 'Үнэ…', { quick_reply: { payload: 'Үнэ, хэмжээ асуух' } }),
              {
                sender: { id: '333' },
                recipient: { id: PAGE },
                timestamp: 1,
                postback: { mid: 'm_3', title: 'Эхлэх', payload: 'GET_STARTED' },
              },
              { sender: { id: '333' }, recipient: { id: PAGE }, delivery: { mids: ['m_1'] } },
            ],
          },
        ],
      },
      config,
    )
    expect(events.map((e) => e.kind)).toEqual(['message', 'message', 'postback'])
    expect(events[0]).toMatchObject({
      platform: 'messenger',
      accountId: PAGE,
      senderId: '333',
      text: 'Хар hoodie L байгаа юу?',
    })
    expect(events[1]).toMatchObject({ text: 'Үнэ, хэмжээ асуух' })
    expect(events[2]).toMatchObject({ text: 'Эхлэх' })
    // The same Meta message always has the same key (a webhook retry is recognised).
    expect(
      parseWebhook(
        { object: 'page', entry: [{ id: PAGE, messaging: [message('333', 'm_1', 'Хар hoodie L байгаа юу?')] }] },
        config,
      )[0].key,
    ).toBe(events[0].key)
  })

  it('routes by Page and Instagram id: another Page subscribed to the same app is ignored', () => {
    const other = { object: 'page', entry: [{ id: '9999999999', messaging: [message('333', 'm_x', 'hi')] }] }
    expect(parseWebhook(other, config)).toEqual([])
    const ig = parseWebhook(
      {
        object: 'instagram',
        entry: [
          {
            id: IG,
            messaging: [
              {
                sender: { id: '444' },
                recipient: { id: IG },
                timestamp: 2,
                message: { mid: 'ig_1', text: 'une hed ve' },
              },
            ],
          },
        ],
      },
      config,
    )
    expect(ig[0]).toMatchObject({
      kind: 'message',
      platform: 'instagram',
      accountId: IG,
      senderId: '444',
      text: 'une hed ve',
    })
    expect(
      parseWebhook({ object: 'instagram', entry: [{ id: IG, messaging: [] }] }, { pageId: PAGE, instagramId: null }),
    ).toEqual([])
  })

  it('keeps echoes apart and drops the account talking to itself', () => {
    const events = parseWebhook(
      {
        object: 'page',
        entry: [
          {
            id: PAGE,
            messaging: [
              {
                sender: { id: PAGE },
                recipient: { id: '333' },
                timestamp: 3,
                message: { mid: 'm_e', text: 'Сайн байна уу, ажилтан байна', is_echo: true, app_id: 263902037430900 },
              },
              message(PAGE, 'm_self', 'self'),
            ],
          },
        ],
      },
      config,
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'echo', recipientId: '333', appId: '263902037430900', metadata: null })
  })

  it("reads Page and Instagram comments, never the account's own", () => {
    const fb = parseWebhook(
      {
        object: 'page',
        entry: [
          {
            id: PAGE,
            changes: [
              {
                field: 'feed',
                value: {
                  item: 'comment',
                  verb: 'add',
                  comment_id: '10_20',
                  post_id: '10',
                  message: 'Үнэ хэд вэ?',
                  from: { id: '555' },
                  created_time: 1_790_000_000,
                },
              },
              {
                field: 'feed',
                value: { item: 'comment', verb: 'add', comment_id: '10_21', message: 'Баярлалаа', from: { id: PAGE } },
              },
              { field: 'feed', value: { item: 'reaction', verb: 'add', from: { id: '555' } } },
            ],
          },
        ],
      },
      config,
    )
    expect(fb).toHaveLength(1)
    expect(fb[0]).toMatchObject({ kind: 'comment', commentId: '10_20', fromId: '555', at: 1_790_000_000_000 })
    const ig = parseWebhook(
      {
        object: 'instagram',
        entry: [
          {
            id: IG,
            time: 1_790_000_000,
            changes: [
              { field: 'comments', value: { id: '1789', text: 'size L bga yu', from: { id: '666', username: 'x' } } },
            ],
          },
        ],
      },
      config,
    )
    expect(ig[0]).toMatchObject({ kind: 'comment', platform: 'instagram', commentId: '1789' })
  })

  it('rejects other objects and oversized batches', () => {
    expect(() => parseWebhook({ object: 'user', entry: [] }, config)).toThrow(MetaPayloadError)
    const many = Array.from({ length: 60 }, (_, i) => message('333', `m_${i}`, 'hi'))
    expect(() => parseWebhook({ object: 'page', entry: [{ id: PAGE, messaging: many }] }, config)).toThrow(
      MetaPayloadError,
    )
  })
})

describe('comment triggers', () => {
  it('match price, availability and order words in Cyrillic and Latin Mongolian', () => {
    for (const text of ['Үнэ хэд вэ?', 'une hed ve', 'L размер байгаа юу', 'bga yu?', 'Захиалъя', 'zahialya', 'DM'])
      expect(commentMatches(text, DEFAULT_COMMENT_KEYWORDS), text).toBe(true)
  })
  it('do not fire on ordinary comments or inside other words', () => {
    for (const text of ['Гоё байна 😍', 'admin', 'Баярлалаа'])
      expect(commentMatches(text, DEFAULT_COMMENT_KEYWORDS), text).toBe(false)
  })
})

describe('message sizing', () => {
  it('splits long replies at line breaks into at most four Messenger messages', () => {
    const parts = chunkText(`${'а'.repeat(1500)}\n${'б'.repeat(1500)}`)
    expect(parts).toHaveLength(2)
    expect(parts.every((p) => p.length <= 1900)).toBe(true)
    expect(chunkText('x'.repeat(20_000))).toHaveLength(4)
  })
  it('keeps quick-reply titles within 20 characters and the payload whole', () => {
    const chips = quickReplies(['Үнэ, хэмжээний мэдээлэл авах', 'Ажилтантай холбогдох', ''])!
    expect(chips).toHaveLength(2)
    expect(chips[0].title.length).toBeLessThanOrEqual(20)
    expect(chips[0].payload).toBe('Үнэ, хэмжээний мэдээлэл авах')
    expect(quickReplies([])).toBeUndefined()
  })
})
