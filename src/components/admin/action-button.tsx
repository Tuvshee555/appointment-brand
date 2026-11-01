'use client'

import { CheckCircle2, FlaskConical, Loader2 } from 'lucide-react'
import { useState, useTransition, type ReactNode } from 'react'
import { buttonClass } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import type { ActionResult } from '@/server/actions/result'

export type Feedback = { kind: 'ok' | 'simulated' | 'error'; text: string } | null

/** Renders the outcome of an admin action, making simulated (demo) results explicit. */
export function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null
  return (
    <p
      role={feedback.kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-xs px-3 py-2 text-[0.82rem]',
        feedback.kind === 'ok' && 'bg-sage-50 text-sage-700',
        feedback.kind === 'simulated' && 'bg-blush-50 text-blush-700',
        feedback.kind === 'error' && 'bg-rose-50 text-rose-700',
      )}
    >
      {feedback.kind === 'simulated' ? (
        <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
      ) : feedback.kind === 'ok' ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
      ) : null}
      <span>{feedback.text}</span>
    </p>
  )
}

export function feedbackFrom<T>(res: ActionResult<T>, okText: string): Feedback {
  if (!res.ok) return { kind: 'error', text: res.error }
  if (res.simulated) return { kind: 'simulated', text: res.message ?? 'Демо: хадгалагдаагүй.' }
  return { kind: 'ok', text: res.message ?? okText }
}

export function ActionButton({
  action,
  children,
  okText = 'Хадгалагдлаа.',
  variant = 'secondary',
  size = 'sm',
  confirm,
  className,
  onDone,
}: {
  action: () => Promise<ActionResult<unknown>>
  children: ReactNode
  okText?: string
  variant?: 'primary' | 'secondary' | 'ghost' | 'blush' | 'danger'
  size?: 'sm' | 'md'
  confirm?: string
  className?: string
  onDone?: (res: ActionResult<unknown>) => void
}) {
  const [pending, start] = useTransition()
  const [feedback, setFeedback] = useState<Feedback>(null)
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        className={buttonClass(variant, size, className)}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return
          start(async () => {
            const res = await action()
            setFeedback(feedbackFrom(res, okText))
            onDone?.(res)
          })
        }}
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {children}
      </button>
      <FeedbackLine feedback={feedback} />
    </div>
  )
}
