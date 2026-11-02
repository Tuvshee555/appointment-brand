import { connection } from 'next/server'
import { AssistantSettingsForm } from '@/components/admin/assistant/forms'
import { AssistantTabs } from '@/components/admin/assistant/tabs'
import { Card, PageHeader } from '@/components/admin/ui'
import { formatDateTime } from '@/lib/datetime'
import { MODEL_OPTIONS, providerConfigured } from '@/server/assistant/engine/model'
import { loadAssistantSettings } from '@/server/assistant/settings'
import { requireAdminPage } from '@/server/auth/current'
import { db } from '@/server/db'

export const metadata = { title: 'Тохиргоо · AI туслах' }

export default async function AssistantSettingsPage() {
  const session = await requireAdminPage('assistant.view')
  await connection()
  const s = await loadAssistantSettings(db, session.salonId)
  return (
    <>
      <PageHeader
        title="AI туслах"
        description="Туслахын ажиллагаа, AI загвар, зардлын хязгаар, хэл, мэдээллийн бичвэр. API түлхүүрүүд зөвхөн серверийн орчны хувьсагчид хадгалагдана — энд харагдахгүй."
      />
      <AssistantTabs current="settings" />
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_22rem]">
        <Card title="Тохиргоо" action={s.updatedAt ? <span className="text-xs text-ink-3">{formatDateTime(s.updatedAt)}</span> : null}>
          <AssistantSettingsForm
            canEdit={session.permissions.includes('assistant.manage')}
            initial={{
              enabled: s.enabled,
              provider: s.provider,
              model: s.model,
              dailyBudgetUsd: s.dailyBudgetUsd,
              useModelForUnderstanding: s.useModelForUnderstanding,
              useModelForAnswers: s.useModelForAnswers,
              englishReplies: s.englishReplies,
              handoverAutoResumeHours: s.handoverAutoResumeHours,
              greeting: s.greeting,
              handoverMessage: s.handoverMessage,
            }}
            models={MODEL_OPTIONS.map((m) => ({ ...m, configured: providerConfigured(m.provider) }))}
          />
        </Card>
        <Card title="Юуг AI шийддэггүй вэ">
          <ul className="space-y-2 text-sm text-ink-2">
            <li>Сул цаг, үнэ, хугацаа, мастерын ур чадварыг салоны систем тодорхойлно.</li>
            <li>Захиалга, цуцлалт, цаг өөрчлөлт үйлчлүүлэгч хураангуйг «Тийм» гэж баталгаажуулсны дараа, ижил шалгалтаар хийгдэнэ.</li>
            <li>Бусад үйлчлүүлэгчийн захиалгыг дугаар, утасны тохирол шалгалгүйгээр харуулахгүй.</li>
            <li>Түлхүүр алга эсвэл төсөв дуусвал туслах дүрмээр үргэлжлэн ажиллана.</li>
          </ul>
        </Card>
      </div>
    </>
  )
}
