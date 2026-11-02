'use client'

import { FlaskConical, Loader2, RotateCcw, Send } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChatPartView } from '@/components/assistant/chat-widget'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import type { ChatAction, ChatMessage, QuickReply } from '@/lib/assistant/types'
import { cn } from '@/lib/cn'
import { testChatAction } from '@/server/actions/admin-assistant'

type Turn = ChatMessage & { debug?: string }

/** «Try it»: the real assistant, its bookings and changes validated and rolled back. */
export function TestChat() {
  const [messages, setMessages] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  async function send(body: { message?: string; action?: ChatAction }, label?: string) {
    setBusy(true)
    setError(null)
    if (label) setMessages((m) => [...m, { id: `u-${Date.now()}`, role: 'user', parts: [{ type: 'text', text: label }] }])
    const res = await testChatAction(body)
    setBusy(false)
    if (!res.ok) return setError(res.error)
    const debug = [res.data.mode === 'ai' ? 'AI' : 'дүрэм', res.data.intent, ...(res.data.events ?? [])].filter(Boolean).join(' · ')
    setMessages((m) => [...m, ...res.data.messages.map((x) => ({ ...x, debug }))])
  }

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, busy])

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
    <div className="surface flex h-[38rem] flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <p className="flex items-center gap-2 text-sm text-ink-2">
          <FlaskConical className="size-4 text-blush-700" aria-hidden />
          Туршилтын яриа: бодит каталог, сул цаг; захиалга, цуцлалт хадгалагдахгүй.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setMessages([])
            void send({ action: { type: 'reset' } })
          }}
        >
          <RotateCcw className="size-4" aria-hidden /> Шинээр
        </Button>
      </div>
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-[0.9rem]" aria-live="polite">
        {!messages.length && !busy ? (
          <p className="text-sm text-ink-3">
            Жишээ: «margaash 3 tsagt manikyur», «gel budalt hed ve», «tsagaa tsutsalmaar baina», «huntei yarimaar baina».
          </p>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={cn('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
            <div
              className={cn(
                'max-w-[85%] space-y-2 rounded-card px-3.5 py-2.5',
                m.role === 'user' ? 'bg-cocoa-800 text-ivory' : 'border border-line bg-porcelain',
              )}
            >
              {m.parts.map((p, i) => (
                <ChatPartView key={i} part={p} onAction={onAction} onQuick={onQuick} busy={busy} />
              ))}
            </div>
            {m.debug ? <p className="mt-1 text-[0.68rem] text-ink-3">{m.debug}</p> : null}
          </div>
        ))}
        {busy ? (
          <p className="flex items-center gap-2 text-xs text-ink-3">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Шалгаж байна…
          </p>
        ) : null}
        {error ? <p className="text-xs text-rose-700">{error}</p> : null}
      </div>
      <form onSubmit={onSubmit} className="flex gap-2 border-t border-line p-3">
        <label htmlFor="test-chat-input" className="sr-only">
          Туршилтын мессеж
        </label>
        <Input id="test-chat-input" value={input} maxLength={500} onChange={(e) => setInput(e.target.value)} placeholder="Үйлчлүүлэгчийн мессеж…" />
        <Button type="submit" disabled={busy || !input.trim()} aria-label="Илгээх">
          <Send className="size-4" aria-hidden />
        </Button>
      </form>
    </div>
  )
}
