import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/cn'

/** "65,000₮" or "35,000₮-өөс" for "from" prices. */
export function Money({ amount, from, className }: { amount: number; from?: boolean; className?: string }) {
  return (
    <span className={cn('tabular whitespace-nowrap', className)}>
      {formatMoney(amount)}
      {from ? <span className="text-[0.85em] text-ink-3">-өөс</span> : null}
    </span>
  )
}
