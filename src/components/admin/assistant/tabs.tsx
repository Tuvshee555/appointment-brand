import Link from 'next/link'
import { cn } from '@/lib/cn'

export type AssistantTab =
  'overview' | 'conversations' | 'knowledge' | 'settings' | 'analytics' | 'activity' | 'try' | 'problems'

const TABS: { key: AssistantTab; label: string; href: string }[] = [
  { key: 'overview', label: 'Тойм', href: '/admin/assistant' },
  { key: 'conversations', label: 'Харилцан яриа', href: '/admin/assistant/conversations' },
  { key: 'knowledge', label: 'Мэдлэг', href: '/admin/assistant/knowledge' },
  { key: 'settings', label: 'Тохиргоо', href: '/admin/assistant/settings' },
  { key: 'analytics', label: 'Аналитик', href: '/admin/assistant/analytics' },
  { key: 'activity', label: 'Үйл ажиллагаа', href: '/admin/assistant/activity' },
  { key: 'try', label: 'Туршиж үзэх', href: '/admin/assistant/try' },
  { key: 'problems', label: 'Асуудал', href: '/admin/assistant/problems' },
]

/** The AI section's tabs; each page passes its own key (no URL hooks needed). */
export function AssistantTabs({ current, problems = 0 }: { current: AssistantTab; problems?: number }) {
  return (
    <nav aria-label="AI туслахын хэсгүүд" className="-mt-4 mb-6 overflow-x-auto border-b border-line">
      <ul className="flex min-w-max gap-1">
        {TABS.map((tab) => (
          <li key={tab.key}>
            <Link
              href={tab.href}
              aria-current={tab.key === current ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap',
                tab.key === current
                  ? 'border-cocoa-800 font-medium text-cocoa-900'
                  : 'border-transparent text-ink-3 hover:text-cocoa-900',
              )}
            >
              {tab.label}
              {tab.key === 'problems' && problems > 0 ? (
                <span className="tabular rounded-full bg-rose-100 px-1.5 text-[0.7rem] text-rose-700">{problems}</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
