import Link from 'next/link'
import { connection } from 'next/server'
import { AssistantTabs } from '@/components/admin/assistant/tabs'
import { Card, PageHeader, StatCard } from '@/components/admin/ui'
import { Badge } from '@/components/ui/badge'
import { buttonClass } from '@/components/ui/button'
import { requireAdminPage } from '@/server/auth/current'
import { assistantOverview } from '@/server/queries/admin-assistant'

export const metadata = { title: 'AI туслах' }

function Channel({
  name,
  tone,
  status,
  children,
}: {
  name: string
  tone: 'success' | 'muted' | 'warning'
  status: string
  children: React.ReactNode
}) {
  return (
    <div className="surface p-4 text-sm">
      <p className="flex items-center justify-between gap-2 font-medium">
        {name} <Badge tone={tone}>{status}</Badge>
      </p>
      <p className="mt-1 text-xs text-ink-3">{children}</p>
    </div>
  )
}

export default async function AssistantOverviewPage() {
  const session = await requireAdminPage('assistant.view')
  await connection()
  const o = await assistantOverview(session.salonId, new Date())
  const budget = o.settings.dailyBudgetUsd
  return (
    <>
      <PageHeader
        title="AI туслах"
        description="Үйлчлүүлэгчийн асуултад салоны бодит каталог, мастерын хуваарь, сул цагаас хариулж, цаг захиалах, өөрчлөх, цуцлахыг гүйцэтгэнэ. Захиалга зөвхөн үйлчлүүлэгч хураангуйг баталгаажуулсны дараа, системийн шалгалтаар үүснэ."
      />
      <AssistantTabs current="overview" problems={o.problems24} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Төлөв"
          value={o.settings.enabled ? 'Идэвхтэй' : 'Унтраалттай'}
          tone={o.settings.enabled ? 'default' : 'warning'}
          hint={o.model ? `AI: ${o.model.label}` : 'Салоны өгөгдлөөс хариулж байна'}
        />
        <StatCard
          label="Ажилтан хүлээж буй"
          value={o.waiting}
          tone={o.waiting ? 'warning' : 'default'}
          hint={o.staff ? `${o.staff} яриаг ажилтан хариулж байна` : 'Хүн хэрэгтэй гэсэн яриа'}
        />
        <StatCard label="7 хоногт" value={o.conversations7} hint={`яриа · туслахаар ${o.bookings7} захиалга үүссэн`} />
        {o.model ? (
          <StatCard
            label="Өнөөдрийн AI зардал"
            value={`$${o.spent.toFixed(2)}`}
            tone={budget > 0 && o.spent >= budget ? 'danger' : 'default'}
            hint={budget > 0 ? `Өдрийн хязгаар $${budget}` : 'Хязгааргүй'}
          />
        ) : (
          // Without an AI key there is no cost to show; say what the owner gets instead.
          <StatCard label="Хариулдаг" value="24/7" hint="Үнэ, сул цагийг салоны өгөгдлөөс уншина" />
        )}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card title="Сувгууд">
          <div className="grid gap-3 sm:grid-cols-2">
            <Channel
              name="Вэбсайт чат"
              tone={o.settings.enabled ? 'success' : 'warning'}
              status={o.settings.enabled ? 'Идэвхтэй' : 'Унтраалттай'}
            >
              Вэбсайтын баруун доод буланд.
            </Channel>
            <Channel
              name="Facebook Messenger"
              tone={o.messenger ? 'success' : 'muted'}
              status={o.messenger ? 'Холбогдсон' : 'Холбоход бэлэн'}
            >
              Салоны Facebook хуудсанд холбоход Messenger-т ирсэн асуултад вэбсайтын туслахтай ижил хариулна.
            </Channel>
            <Channel
              name="Ажилтанд мэдэгдэл"
              tone={o.telegram && !o.demoMode ? 'success' : 'muted'}
              status={o.demoMode ? 'Демо: бүртгэлд' : o.telegram ? 'Telegram' : 'Тохируулаагүй'}
            >
              Хүн хэрэгтэй үед мэдэгдэл үүсгэнэ. Демо горимд гадагш илгээхгүй.
            </Channel>
            <Channel name="SMS" tone="muted" status="Холбоогүй">
              Монголын SMS үйлчилгээний гэрээ шаардлагатай.
            </Channel>
          </div>
        </Card>
        <Card title="AI загвар">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-3">Сонгосон</dt>
            <dd>{o.settings.model}</dd>
            <dt className="text-ink-3">Ажиллаж буй</dt>
            <dd>{o.model ? `${o.model.label} (${o.model.provider})` : 'Салоны өгөгдөл (AI-гүй горим)'}</dd>
            {o.demoMode ? null : (
              <>
                <dt className="text-ink-3">OpenAI түлхүүр</dt>
                <dd>{o.keys.openai ? 'Тохируулсан' : 'Алга'}</dd>
                <dt className="text-ink-3">Anthropic түлхүүр</dt>
                <dd>{o.keys.anthropic ? 'Тохируулсан' : 'Алга'}</dd>
              </>
            )}
            <dt className="text-ink-3">AI хэрэглэх</dt>
            <dd>
              {[
                o.settings.useModelForUnderstanding && 'ойлгоогүй мессеж унших',
                o.settings.useModelForAnswers && 'нээлттэй асуултад хариулах',
              ]
                .filter(Boolean)
                .join(', ') || 'Унтраасан'}
            </dd>
          </dl>
          <p className="mt-4 text-xs text-ink-3">
            Үнэ, хугацаа, сул цаг, захиалгыг AI биш, салоны систем тодорхойлно. AI-ийн бичсэн хариултыг илгээхийн өмнө
            үнэ, цаг, утасны дугаар бүрийг баталгаажсан мэдээлэлтэй тулгана.
          </p>
        </Card>
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/admin/assistant/conversations?filter=attention" className={buttonClass('secondary', 'sm')}>
          Анхаарах яриа ({o.waiting})
        </Link>
        <Link href="/admin/assistant/problems" className={buttonClass('ghost', 'sm')}>
          24 цагийн асуудал ({o.problems24})
        </Link>
        <Link href="/admin/assistant/try" className={buttonClass('ghost', 'sm')}>
          Туршиж үзэх
        </Link>
      </div>
    </>
  )
}
