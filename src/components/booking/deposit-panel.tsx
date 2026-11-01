'use client'

import { Loader2, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/money'
import { checkPaymentAction, simulatePaymentAction, startPaymentAction } from '@/server/actions/customer-booking'
import type { PaymentView } from '@/server/payments/service'

/** A decorative, deliberately non-scannable QR illustration for the simulation. */
function FakeQr() {
  const cells: boolean[] = []
  let x = 7
  for (let i = 0; i < 21 * 21; i++) {
    x = (x * 1103515245 + 12345) % 2147483648
    cells.push(x % 3 === 0)
  }
  const finder = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c > 13) || (r > 13 && c < 7)
  return (
    <svg viewBox="0 0 21 21" className="size-44 opacity-80" aria-hidden>
      <rect width="21" height="21" fill="#fcfaf6" />
      {cells.map((on, i) => {
        const r = Math.floor(i / 21)
        const c = i % 21
        if (finder(r, c)) return null
        return on ? <rect key={i} x={c} y={r} width="1" height="1" fill="#33251e" /> : null
      })}
      {[
        [0, 0],
        [0, 14],
        [14, 0],
      ].map(([r, c]) => (
        <g key={`${r}-${c}`}>
          <rect x={c} y={r} width="7" height="7" fill="#33251e" />
          <rect x={c + 1} y={r + 1} width="5" height="5" fill="#fcfaf6" />
          <rect x={c + 2} y={r + 2} width="3" height="3" fill="#33251e" />
        </g>
      ))}
      <line x1="0" y1="21" x2="21" y2="0" stroke="#a3473a" strokeWidth="0.6" />
    </svg>
  )
}

function useCountdown(until: string | null) {
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    if (!until) return
    const tick = () => setLeft(Math.max(0, new Date(until).getTime() - Date.now()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [until])
  return left
}

export function DepositPanel({
  reference,
  token,
  amount,
  holdExpiresAt,
}: {
  reference: string
  token: string | null
  amount: number
  holdExpiresAt: string | null
}) {
  const router = useRouter()
  const [payment, setPayment] = useState<PaymentView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const left = useCountdown(holdExpiresAt)

  useEffect(() => {
    let cancelled = false
    startPaymentAction({ reference, token }).then((res) => {
      if (cancelled) return
      if (res.ok) setPayment(res.data)
      else setError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [reference, token])

  const run = (fn: typeof simulatePaymentAction) =>
    start(async () => {
      setError(null)
      const res = await fn({ reference, token })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setPayment(res.data)
      if (res.data.status === 'paid') router.refresh()
      else setError('Төлбөр хараахан баталгаажаагүй байна. Төлсний дараа дахин шалгана уу.')
    })

  const expired = left !== null && left <= 0
  const minutes = left !== null ? Math.floor(left / 60000) : null
  const seconds = left !== null ? Math.floor((left % 60000) / 1000) : null

  return (
    <section aria-labelledby="deposit-title" className="surface p-5 sm:p-6">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-2 rounded-xs border border-line bg-porcelain p-3">
          {payment?.mode === 'mock' || !payment ? (
            <FakeQr />
          ) : payment.qrText ? (
            <p className="max-w-44 text-center text-xs break-all text-ink-3">QPay QR</p>
          ) : null}
          <span className="text-[0.68rem] text-ink-3">
            {payment?.mode === 'mock' || !payment ? 'Туршилтын QR — уншуулах боломжгүй' : 'QPay'}
          </span>
        </div>
        <div className="flex-1 space-y-3">
          <h2 id="deposit-title" className="font-display text-2xl text-cocoa-900">
            Урьдчилгаа {formatMoney(amount)}
          </h2>
          {payment?.mode === 'mock' || !payment ? (
            <p className="rounded-xs bg-amber-50 px-3 py-2 text-sm text-amber-700">
              Энэ бол симуляц: QPay-тэй холбогдохгүй, мөнгө шилжихгүй. «Туршилтын төлбөр хийх» товч нь таны банкны
              аппаар төлсөнтэй адил төлбөрийн систем талд бүртгэл үүсгэж, сервер түүнийг шалгаж баталгаажуулна.
            </p>
          ) : (
            <p className="text-sm text-ink-2">QPay-ээр төлсний дараа «Төлбөр шалгах» товчийг дарна уу.</p>
          )}
          {!expired && left !== null ? (
            <p className="text-sm text-ink-2" aria-live="polite">
              Цаг тань{' '}
              <span className="tabular font-medium">
                {minutes}:{String(seconds).padStart(2, '0')}
              </span>{' '}
              минут хадгалагдана.
            </p>
          ) : expired ? (
            <p className="text-sm text-rose-700">Хадгалах хугацаа дууссан. Хуудсаа шинэчилж төлөвөө шалгана уу.</p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3 pt-1">
            {payment?.mode === 'mock' ? (
              <Button
                onClick={() => run(simulatePaymentAction)}
                disabled={pending || expired || payment?.status !== 'pending'}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <ShieldCheck className="size-4" aria-hidden />
                )}
                Туршилтын төлбөр хийх
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => run(checkPaymentAction)} disabled={pending || !payment}>
              Төлбөр шалгах
            </Button>
          </div>
          <p className="text-xs text-ink-3">
            QPay-ийн гүйлгээний шимтгэлийг QPay тооцдог; Ursgal Digital-ын холболтын үйлчилгээний төлбөр тусдаа бөгөөд
            үйлчлүүлэгчээс авахгүй.
          </p>
        </div>
      </div>
    </section>
  )
}
