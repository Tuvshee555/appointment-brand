'use client'

import { CalendarCheck2, Loader2, MessageCircle, RotateCcw, Send, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ChatAction, ChatMessage, ChatPart, ChatResponse, QuickReply } from '@/lib/assistant/types'
import { withBasePath } from '@/lib/base-path'
import { formatDuration } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/cn'

async function callChat(body: { message?: string; action?: ChatAction }): Promise<ChatResponse> {
  const res = await fetch(withBasePath('/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => null)) as ChatResponse | null
  if (!data) return { messages: [], mode: 'rules', error: 'Холболтын алдаа гарлаа. Дахин оролдоно уу.' }
  return data
}

function Part({ part, onAction, onQuick, busy }: { part: ChatPart; onAction: (a: ChatAction, label: string) => void; onQuick: (q: QuickReply) => void; busy: boolean }) {
  switch (part.type) {
    case 'text':
      return <p className="whitespace-pre-line">{part.text}</p>
    case 'handoff':
      return <p className="rounded-xs bg-amber-50 px-3 py-2 text-[0.85rem] text-amber-700">{part.text}</p>
    case 'quick_replies':
      return (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {part.options.map((o) => (
            <button
              key={o.label}
              type="button"
              disabled={busy}
              onClick={() => onQuick(o)}
              className="rounded-full border border-cocoa-300 bg-porcelain px-3 py-1.5 text-[0.8rem] text-cocoa-800 hover:border-cocoa-700 disabled:opacity-50"
            >
              {o.label}
            </button>
          ))}
        </div>
      )
    case 'slots':
      return (
        <div className="space-y-2">
          <p className="text-[0.8rem] text-ink-3">
            {part.dateLabel} · {part.serviceLabel}
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {part.slots.map((s) => (
              <button
                key={s.start}
                type="button"
                disabled={busy}
                onClick={() => onAction({ type: 'choose_slot', date: part.date, start: s.start }, s.label)}
                className="rounded-xs border border-line-strong bg-porcelain py-2 text-sm tabular text-cocoa-900 hover:border-cocoa-700 disabled:opacity-50"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )
    case 'draft': {
      const s = part.summary
      return (
        <div className="space-y-3 rounded-xs border border-cocoa-200 bg-porcelain p-3">
          <p className="text-[0.75rem] font-semibold tracking-wide text-cocoa-600 uppercase">Захиалгын хураангуй</p>
          <ul className="space-y-1 text-[0.85rem]">
            {s.services.map((svc) => (
              <li key={svc.name}>
                <div className="flex justify-between gap-3">
                  <span>{svc.name}</span>
                  <span className="tabular">
                    {formatMoney(svc.price)}
                    {svc.from ? '-өөс' : ''}
                  </span>
                </div>
                {svc.addons.map((a) => (
                  <div key={a.name} className="flex justify-between gap-3 pl-3 text-ink-3">
                    <span>+ {a.name}</span>
                    <span className="tabular">{formatMoney(a.price)}</span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-line pt-2 text-[0.82rem]">
            <dt className="text-ink-3">Мастер</dt>
            <dd>{s.staffName}</dd>
            <dt className="text-ink-3">Өдөр</dt>
            <dd>{s.dateLabel}</dd>
            <dt className="text-ink-3">Цаг</dt>
            <dd className="tabular">
              {s.timeRange} ({formatDuration(s.durationMinutes)})
            </dd>
            <dt className="text-ink-3">Нийт</dt>
            <dd className="font-medium tabular">
              {formatMoney(s.total)}
              {s.hasFromPrice ? '-өөс' : ''}
            </dd>
            {s.deposit > 0 ? (
              <>
                <dt className="text-ink-3">Урьдчилгаа</dt>
                <dd className="tabular">{formatMoney(s.deposit)}</dd>
              </>
            ) : null}
            <dt className="text-ink-3">Нэр, утас</dt>
            <dd>
              {s.customerName}, {s.customerPhone}
            </dd>
          </dl>
          <p className="text-[0.75rem] text-ink-3">Баталгаажуулсны дараа төлөв: {s.statusAfter}</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction({ type: 'confirm_draft', draftId: part.draftId }, 'Баталгаажуулах')}
              className="flex-1 rounded-xs bg-cocoa-800 py-2 text-sm text-ivory hover:bg-cocoa-900 disabled:opacity-50"
            >
              Баталгаажуулах
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction({ type: 'cancel_draft', draftId: part.draftId }, 'Болих')}
              className="rounded-xs border border-line-strong px-3 py-2 text-sm text-ink-2 hover:bg-sand disabled:opacity-50"
            >
              Болих
            </button>
          </div>
        </div>
      )
    }
    case 'booking':
      return (
        <div className="space-y-2 rounded-xs border border-sage-600/30 bg-sage-50 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-sage-700">
            <CalendarCheck2 className="size-4" aria-hidden /> {part.reference} · {part.statusLabel}
          </p>
          <p className="text-[0.82rem] text-ink-2">{part.explanation}</p>
          <Link href={part.link} className="inline-block text-[0.82rem] font-medium text-cocoa-800 underline underline-offset-4">
            Захиалгаа харах
          </Link>
        </div>
      )
  }
}

export function ChatWidget({ salonName }: { salonName: string }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [mode, setMode] = useState<'ai' | 'rules'>('rules')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const started = useRef(false)

  async function send(body: { message?: string; action?: ChatAction }, userLabel?: string) {
    setBusy(true)
    setError(null)
    if (userLabel) setMessages((m) => [...m, { id: `u-${Date.now()}`, role: 'user', parts: [{ type: 'text', text: userLabel }] }])
    const res = await callChat(body)
    setBusy(false)
    if (res.error) setError(res.error)
    setMode(res.mode)
    setMessages((m) => [...m, ...res.messages])
  }

  useEffect(() => {
    if (open && !started.current) {
      started.current = true
      void send({ action: { type: 'hello' } })
    }
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  useEffect(() => {
    const openChat = () => setOpen(true)
    window.addEventListener('suvd:open-chat', openChat)
    return () => window.removeEventListener('suvd:open-chat', openChat)
  }, [])

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    void send({ message: text }, text)
  }

  const onQuick = (q: QuickReply) => void send(q.action ? { action: q.action } : { message: q.message ?? q.label }, q.label)
  const onAction = (a: ChatAction, label: string) => void send({ action: a }, label)

  return (
    <div className="no-print">
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-4 bottom-24 z-40 flex size-13 items-center justify-center gap-2 rounded-full bg-cocoa-900 text-sm text-ivory shadow-lift hover:bg-cocoa-800 sm:bottom-6 sm:h-14 sm:w-auto sm:pr-5 sm:pl-4"
          aria-label="Чат туслах нээх"
        >
          <MessageCircle className="size-5" aria-hidden />
          <span className="max-sm:sr-only">Асуух</span>
        </button>
      )}
      {open && (
        <section
          aria-label="Сувдын туслах"
          className="fixed inset-x-2 bottom-2 z-50 flex max-h-[min(42rem,calc(100dvh-1rem))] flex-col overflow-hidden rounded-card border border-line bg-ivory shadow-lift sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[25rem]"
        >
          <header className="flex items-center justify-between gap-3 border-b border-line bg-porcelain px-4 py-3">
            <div>
              <p className="font-display text-xl leading-none text-cocoa-900">{salonName} · туслах</p>
              <p className="mt-1 text-[0.7rem] text-ink-3">
                {mode === 'ai' ? 'AI загвар · ' : 'Дүрэмд суурилсан туслах · '}
                салоны бодит үнэ, сул цагаас хариулна
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setMessages([])
                  void send({ action: { type: 'reset' } })
                }}
                className="inline-flex size-9 items-center justify-center rounded-xs text-ink-3 hover:bg-sand"
                aria-label="Яриаг шинээр эхлүүлэх"
              >
                <RotateCcw className="size-4" />
              </button>
              <button type="button" onClick={() => setOpen(false)} className="inline-flex size-9 items-center justify-center rounded-xs text-ink-2 hover:bg-sand" aria-label="Чат хаах">
                <X className="size-5" />
              </button>
            </div>
          </header>
          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-[0.9rem] leading-relaxed" aria-live="polite">
            {messages.map((m) => (
              <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[88%] space-y-2 rounded-card px-3.5 py-2.5',
                    m.role === 'user' ? 'rounded-br-xs bg-cocoa-800 text-ivory' : 'rounded-bl-xs border border-line bg-porcelain text-ink',
                  )}
                >
                  {m.parts.map((p, i) => (
                    <Part key={i} part={p} onAction={onAction} onQuick={onQuick} busy={busy} />
                  ))}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-ink-3">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Шалгаж байна…
              </div>
            )}
            {error && <p className="text-xs text-rose-700">{error}</p>}
          </div>
          <form onSubmit={onSubmit} className="border-t border-line bg-porcelain p-3">
            <label htmlFor="chat-input" className="sr-only">
              Асуултаа бичих
            </label>
            <div className="flex gap-2">
              <input
                id="chat-input"
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                maxLength={500}
                autoComplete="off"
                placeholder="Жишээ: Гель будалт хэд вэ?"
                className="min-w-0 flex-1 rounded-xs border border-line-strong bg-ivory px-3 py-2.5 text-sm focus:border-cocoa-600 focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="inline-flex size-11 items-center justify-center rounded-xs bg-cocoa-800 text-ivory hover:bg-cocoa-900 disabled:opacity-40"
                aria-label="Илгээх"
              >
                <Send className="size-4" />
              </button>
            </div>
            <p className="mt-2 text-[0.68rem] text-ink-3">Демо: зохиомол салон. Бодит хувийн мэдээлэл бүү оруулна уу.</p>
          </form>
        </section>
      )}
    </div>
  )
}
