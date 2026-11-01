import { formatShortDate } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'

/** Daily revenue bars (accessible: each bar has a text label; table fallback for screen readers). */
export function RevenueBars({ data, height = 140 }: { data: { day: string; total: number }[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.total))
  return (
    <figure>
      <div className="flex items-end gap-1.5" style={{ height }} aria-hidden>
        {data.map((d) => (
          <div key={d.day} className="group relative flex flex-1 flex-col items-center justify-end" style={{ height: '100%' }}>
            <div
              className="w-full rounded-t-[3px] bg-cocoa-300 transition-colors group-hover:bg-cocoa-600"
              style={{ height: `${Math.max(2, (d.total / max) * 100)}%` }}
              title={`${formatShortDate(d.day)}: ${formatMoney(d.total)}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5 text-[0.62rem] text-ink-3" aria-hidden>
        {data.map((d, i) => (
          <span key={d.day} className="flex-1 text-center tabular">
            {i % 2 === 0 ? formatShortDate(d.day) : ''}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Өдөр бүрийн орлого</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <th scope="row">{d.day}</th>
              <td>{formatMoney(d.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

/** Horizontal bars for ranked lists (popular services, staff performance). */
export function RankBars({ rows, format = (n: number) => String(n) }: { rows: { label: string; value: number; hint?: string }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between gap-3 text-sm">
            <span className="truncate text-ink">{r.label}</span>
            <span className="shrink-0 text-ink-2 tabular">
              {format(r.value)}
              {r.hint ? <span className="ml-1 text-xs text-ink-3">{r.hint}</span> : null}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-sand">
            <div className="h-1.5 rounded-full bg-blush-400" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
