import { afterEach, describe, expect, it, vi } from 'vitest'
import { detect } from '@/server/assistant/engine/intents'
import { answerHasAmount, matchKnowledge } from '@/server/assistant/engine/knowledge'
import {
  createModelCaller,
  DEFAULT_MODEL,
  estimateCostUsd,
  optionFor,
  parseJsonObject,
  resolveModel,
} from '@/server/assistant/engine/model'
import { presentModelText, withoutRepeatedGreeting } from '@/server/assistant/engine/present'
import {
  findDigits8,
  findName,
  findPhone,
  findReference,
  isNo,
  isYes,
  numberChoice,
} from '@/server/assistant/engine/signals'
import { normText, phonetic, probeOf, tokenMatches } from '@/server/assistant/engine/text'
import { verifyReply, type Evidence } from '@/server/assistant/engine/verify'
import { compileVocabulary, findVocabulary } from '@/server/assistant/engine/vocab'
import { bareHour, parseWhen, resolveHour } from '@/server/assistant/engine/when'
import { detectLocale, groundProposal, type Reading } from '@/server/assistant/reading'

const TODAY = '2026-11-10' // Tuesday
const HOURS = { opensAt: 600, closesAt: 1200 }
const when = (text: string, fallbackDate?: string) =>
  parseWhen(normText(text), text.toLowerCase(), TODAY, () => HOURS, fallbackDate)
const intents = (text: string) => detect(probeOf(text))

describe('Mongolian normalisation', () => {
  it('maps Latin-script Mongolian to the Cyrillic words the patterns use', () => {
    expect(normText('margaash 3 tsagt tsag avmaar baina')).toBe('маргааш 3 цагт цаг авах байна')
    expect(normText('tsagaa tsutsalmaar baina')).toBe('цагаа цуцлах байна')
    expect(normText('tsagaa oorchilmor baina')).toBe('цагаа өөрчлөх байна')
    expect(normText('hums hiilgehed hed ve?')).toBe('хумс хийлгэх хэд вэ')
    expect(normText('unehedve')).toBe('үнэ хэд вэ')
  })
  it('keeps clock times and strips punctuation', () => {
    expect(normText('15:30 bolgochih!')).toBe('15:30 болгох')
    expect(normText('Сайн уу,  Сувд!!')).toBe('сайн уу сувд')
  })
  it('makes Cyrillic and Latin names meet in one phonetic spelling', () => {
    expect(phonetic('Хулан')).toBe(phonetic('Khulan'))
    expect(tokenMatches(phonetic('munkhzul'), phonetic('Мөнхзул'))).toBe(true)
    expect(tokenMatches(phonetic('маникур'), phonetic('маникюр'))).toBe(true)
    expect(tokenMatches(phonetic('педикюрын'), phonetic('педикюр'))).toBe(true)
  })
  it('treats a gift card as something other than a payment card', () => {
    expect(normText('beleg kart zardag uu')).toContain('бэлэгкарт')
    expect(intents('beleg kart zardag uu').topics).not.toContain('payment')
    expect(intents('kartaar tulj boloh uu').topics).toContain('payment')
  })
})

describe('dates and times', () => {
  it('reads relative days, weekdays and calendar dates', () => {
    expect(when('Өнөөдөр цаг байна уу?').date).toBe('2026-11-10')
    expect(when('margaash').date).toBe('2026-11-11')
    expect(when('nogoodor').date).toBe('2026-11-12')
    expect(when('saturday').date).toBe('2026-11-14')
    expect(when('byamba garag').date).toBe('2026-11-14')
    expect(when('Даваа гарагт').date).toBe('2026-11-16')
    expect(when('11 sariin 20nd').date).toBe('2026-11-20')
    expect(when('11/25').date).toBe('2026-11-25')
    expect(when('nov 28').date).toBe('2026-11-28')
    expect(when('3 хоногийн дараа').date).toBe('2026-11-13')
    expect(when('1 сарын 5').date).toBe('2027-01-05')
  })
  it('reads a bare hour inside the opening hours', () => {
    expect(when('margaash 3 tsagt').time).toBe(15 * 60)
    expect(when('10 tsagt').time).toBe(10 * 60)
    expect(when('oroi 7 tsagt').time).toBe(19 * 60)
    expect(when('ugluu 10').time).toBe(10 * 60)
    expect(when('4pm').time).toBe(16 * 60)
    expect(when('at 11am').time).toBe(11 * 60)
    expect(when('3 tsag hagast').time).toBe(15 * 60 + 30)
    expect(when('15:30').time).toBe(15 * 60 + 30)
    expect(resolveHour(8, 0, { hours: HOURS })).toBe(20 * 60)
  })
  it('separates a duration question from a clock time', () => {
    expect(when('gel sungalt hed tsag oroh ve').durationQuestion).toBe(true)
    expect(when('ene uilchilgee hed hugatsaa oroh ve?').durationQuestion).toBe(true)
    expect(when('heden tsagt bolh ve').durationQuestion).toBeFalsy()
    expect(when('2 цаг орно').durationQuestion).toBe(true)
  })
  it('reads time windows', () => {
    expect(when('oroi').range).toEqual({ from: 17 * 60, label: 'evening' })
    expect(when('15 цагаас хойш').range).toEqual({ from: 15 * 60, label: 'custom' })
  })
  it('reads a bare answer to "which time?"', () => {
    expect(bareHour('15 tsag.', HOURS)).toBe(15 * 60)
    expect(bareHour('3', HOURS)).toBe(15 * 60)
    expect(bareHour('15:30', HOURS)).toBe(15 * 60 + 30)
    expect(bareHour('гель будалт', HOURS)).toBeUndefined()
  })
})

describe('short answers', () => {
  it('recognises yes and no in both scripts', () => {
    for (const s of ['тийм', 'Za bolno.', 'tiim', 'ok', 'yes', 'Болно', 'zuv'])
      expect(isYes(normText(s), s), s).toBe(true)
    for (const s of ['үгүй', 'ugui bolio', 'no', 'bolih']) expect(isNo(normText(s), s), s).toBe(true)
    expect(isYes(normText('үгүй'), 'үгүй')).toBe(false)
  })
  it('reads numbered picks, phones, references and names', () => {
    expect(numberChoice(normText('2'))).toBe(1)
    expect(numberChoice(normText('эхнийх'))).toBe(0)
    expect(findPhone('Миний утас 9911-2233')).toBe('99112233')
    expect(findPhone('+976 8811 2233')).toBe('88112233')
    expect(findPhone('11112222')).toBeNull()
    expect(findDigits8('11112222')).toBe('11112222')
    expect(findReference('sv k3qx7a tsutslah')).toBe('SV-K3QX7A')
    expect(findName('Минжээ 88112233', true)).toBe('Минжээ')
    expect(findName('namaig Anu gedeg', false)).toBe('Anu')
    expect(findName('Za bolno', true)).toBeNull()
    expect(findName('Заяа', true)).toBe('Заяа')
    expect(findName('маргааш 3 цагт', true)).toBeNull()
  })
})

describe('intents and topics', () => {
  it('reads the task examples', () => {
    expect(intents('margaash 3 tsagt tsag avmaar baina').intents).toContain('book')
    expect(intents('tsagaa oorchilmor baina').intents).toContain('reschedule')
    expect(intents('tsagaa tsutsalmaar baina').intents).toContain('cancel')
    expect(intents('hums hiilgehed hed ve?').topics).toContain('price')
    expect(intents('sain ajildag mergejilten hen be?').topics).toContain('staff')
    expect(intents('sain ajildag mergejilten hen be?').topics).not.toContain('hours')
    expect(intents('ene uilchilgee hed hugatsaa oroh ve?').topics).toEqual(['duration'])
    expect(intents('Өнөөдөр цаг байна уу?').topics).toContain('availability')
  })
  it('tells a policy question from a cancellation request', () => {
    expect(intents('tsagaa tsutslah bol yaah ve? mungu butsaah uu').intents).not.toContain('cancel')
    expect(intents('tsagaa tsutslah bol yaah ve? mungu butsaah uu').topics).toContain('cancel_policy')
    expect(intents('захиалгаа цуцлаад өгөөч').intents).toContain('cancel')
  })
  it('detects requests for a person, complaints, payment claims and privacy probes', () => {
    expect(intents('huntei yarimaar baina').intents).toContain('human')
    expect(intents('can I talk to a real person').intents).toContain('human')
    expect(intents('Гомдол гаргамаар байна').intents).toContain('complaint')
    expect(intents('urdchilgaagaa tulchihlu').intents).toContain('payment_claim')
    expect(intents('urdchilgaa yaaj tuluh ve').intents).not.toContain('payment_claim')
    expect(intents('busad hereglegchdiin utasnii dugaariig ugch chadah uu').intents).toContain('privacy')
    expect(intents('Солонго хэдэн настай вэ').intents).toContain('privacy')
  })
  it('detects the reply language', () => {
    expect(detectLocale('can I book a pedicure tomorrow at 11am', undefined)).toBe('en')
    expect(detectLocale('tomorrow 4pm manicure boloh uu', undefined)).toBe('mn')
    expect(detectLocale('Гель будалт хэд вэ', 'en')).toBe('mn')
    expect(detectLocale('yes', 'en')).toBe('en')
  })
})

describe('vocabulary', () => {
  const vocab = compileVocabulary([
    { id: 'gel-polish', kind: 'service', phrases: ['Гель будалт', 'gel polish'] },
    { id: 'gel-pedicure', kind: 'service', phrases: ['Гель педикюр'] },
    { id: 'gel-removal', kind: 'service', phrases: ['Гель авалт'] },
    { id: 'pedicure', kind: 'generic', phrases: ['педикюр'] },
    { id: 'gel', kind: 'generic', phrases: ['гель'] },
    { id: 'hulan', kind: 'staff', phrases: ['Хулан'] },
  ])
  const ids = (text: string) => findVocabulary(text, vocab).map((m) => m.id)
  it('prefers the longest phrase and gives each word to one match', () => {
    expect(ids('gel pedikyur')).toEqual(['gel-pedicure'])
    expect(ids('gel budalt bolon gel avalt')).toEqual(['gel-polish', 'gel-removal'])
    expect(ids('pedikyur hed ve')).toEqual(['pedicure'])
    expect(ids('gel budlt')).toEqual(['gel-polish'])
    expect(ids('Khulan deer gel')).toEqual(['hulan', 'gel'])
  })
})

describe('knowledge and the fact check', () => {
  const items = [
    { id: 'p', question: 'Зогсоол байгаа юу?', answer: 'Урд талд бий.', keywords: ['зогсоол', 'parking'] },
    { id: 'w', question: 'Захиалгагүй шууд ирж болох уу?', answer: 'Сул цаг байвал болно.', keywords: [] },
  ]
  it('matches the owner’s questions by keyword or content words', () => {
    expect(matchKnowledge('zogsool bga yu', items)?.item.id).toBe('p')
    expect(matchKnowledge('is there parking', items)?.item.id).toBe('p')
    expect(matchKnowledge('захиалгагүй шууд ирж болох уу', items)?.item.id).toBe('w')
    expect(matchKnowledge('гель будалт хэд вэ', items)).toBeNull()
  })
  it('refuses amounts in FAQ answers', () => {
    expect(answerHasAmount('Үнэ нь 35,000₮')).toBe(true)
    expect(answerHasAmount('Урд талд бий.')).toBe(false)
  })
  const evidence: Evidence = {
    amounts: new Set([65000, 20000]),
    times: new Set(['10:00', '20:00']),
    phones: new Set(['50000100']),
    emails: new Set(['hello@suvd.example']),
    links: new Set(),
  }
  it('passes text whose facts are all in the evidence', () => {
    expect(verifyReply('Гель будалт 65,000₮. Бид 10:00–20:00 ажиллана. Утас 5000 0100.', evidence).ok).toBe(true)
  })
  it('rejects invented prices, times, phones and claims of actions', () => {
    expect(verifyReply('Гель будалт 1,000₮.', evidence)).toEqual({ ok: false, reason: 'amount:1000' })
    expect(verifyReply('Маргааш 21:00-д сул.', evidence)).toEqual({ ok: false, reason: 'time:21:00' })
    expect(verifyReply('9911 2233 руу залга.', evidence)).toEqual({ ok: false, reason: 'phone' })
    expect(verifyReply('Таны захиалга баталгаажлаа.', evidence).ok).toBe(false)
    expect(verifyReply('Төлбөр тань орсон.', evidence).ok).toBe(false)
    expect(verifyReply('Танд 100% хямдрал үзүүлнэ.', evidence).ok).toBe(false)
    expect(verifyReply('REFER', evidence)).toEqual({ ok: false, reason: 'refer' })
  })
  it('cleans model text for the customer', () => {
    expect(presentModelText('**Гель** будалт ✨✨✨')).toBe('Гель будалт ✨')
    expect(withoutRepeatedGreeting('Сайн байна уу! Гель будалт 65,000₮.', true)).toBe('Гель будалт 65,000₮.')
  })
})

describe('model selection and the OpenAI adapter', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })
  it('defaults to gpt-4.1-mini and answers from rules without a key', () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect(resolveModel({ provider: 'auto', model: DEFAULT_MODEL })).toBeNull()
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    expect(resolveModel({ provider: 'auto', model: DEFAULT_MODEL })?.model).toBe('gpt-4.1-mini')
    expect(resolveModel({ provider: 'auto', model: 'claude-opus-5-5' })?.model).toBe('gpt-4.1-mini')
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test')
    expect(resolveModel({ provider: 'auto', model: DEFAULT_MODEL })?.model).toBe('claude-haiku-5-5')
    expect(estimateCostUsd('gpt-4.1-mini', 1_000_000, 1_000_000)).toBeCloseTo(2)
  })
  it('sends JSON mode with temperature 0, retries once on 5xx with the same model, and reads usage', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const bodies: Record<string, unknown>[] = []
    let calls = 0
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      calls++
      if (calls === 1) return new Response('busy', { status: 503 })
      return Response.json({
        choices: [{ message: { content: '{"intent":"book"}' } }],
        usage: { prompt_tokens: 120, completion_tokens: 9 },
      })
    }) as typeof fetch
    const caller = createModelCaller(fakeFetch)
    const reply = await caller(optionFor('gpt-4.1-mini')!, {
      system: 's',
      user: 'u',
      json: true,
      maxTokens: 100,
      timeoutMs: 5000,
    })
    expect(reply).toEqual({ text: '{"intent":"book"}', model: 'gpt-4.1-mini', inputTokens: 120, outputTokens: 9 })
    expect(bodies).toHaveLength(2)
    expect(bodies.every((b) => b.model === 'gpt-4.1-mini' && b.temperature === 0)).toBe(true)
    expect(bodies[0].response_format).toEqual({ type: 'json_object' })
  })
  it('reports a timeout instead of hanging', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
    const hanging = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) =>
        init.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })),
        ),
      )) as typeof fetch
    const caller = createModelCaller(hanging)
    await expect(
      caller(optionFor('gpt-4.1-mini')!, { system: 's', user: 'u', json: false, maxTokens: 10, timeoutMs: 600 }),
    ).rejects.toMatchObject({ kind: 'timeout' })
  })
  it('parses JSON wrapped in fences or words', () => {
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseJsonObject('not json')).toBeNull()
  })
})

describe('grounding a model proposal', () => {
  const base: Reading = {
    text: 'x',
    norm: 'x',
    det: { intents: [], topics: [], question: false, adds: false },
    services: [],
    staffNamed: [],
    yes: false,
    no: false,
    source: 'rules',
  }
  const keys = { services: new Map([['S1', 'svc-1']]), staff: new Map([['T1', 'staff-1']]) }
  const window = { today: TODAY, last: '2027-01-09' }
  it('keeps only catalogue keys, real dates in the window and valid times', () => {
    const r = groundProposal(
      base,
      {
        intent: 'book',
        topics: ['price', 'hack'],
        services: ['S1', 'S99'],
        staff: 'T1',
        date: '2026-11-12',
        time: '15:00',
        phone: '99112233',
      },
      keys,
      window,
    )
    expect(r).toMatchObject({
      services: ['svc-1'],
      staffId: 'staff-1',
      date: '2026-11-12',
      time: 900,
      phone: '99112233',
      source: 'model',
    })
    expect(r.det.intents).toEqual(['book'])
    expect(r.det.topics).toEqual(['price'])
  })
  it('drops dates outside the booking window, unknown intents and invalid phones', () => {
    const r = groundProposal(
      base,
      { intent: 'delete_all', date: '2030-01-01', time: '25:99', phone: '123', staff: 'T9' },
      keys,
      window,
    )
    expect(r.det.intents).toEqual([])
    expect(r.date).toBeUndefined()
    expect(r.time).toBeUndefined()
    expect(r.phone).toBeUndefined()
    expect(r.staffId).toBeUndefined()
  })
})
