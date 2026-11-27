import { connection } from 'next/server'
import { KnowledgeEditor, type KnowledgeValues } from '@/components/admin/assistant/forms'
import { knowledgeTopic, topicLabel } from '@/lib/knowledge-topics'
import { AssistantTabs } from '@/components/admin/assistant/tabs'
import { Card, EmptyState, PageHeader } from '@/components/admin/ui'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/datetime'
import { requireAdminPage } from '@/server/auth/current'
import { listKnowledge } from '@/server/queries/admin-assistant'

export const metadata = { title: 'Мэдлэг · AI туслах' }

const EMPTY: KnowledgeValues = {
  id: null,
  topic: 'general',
  question: '',
  answer: '',
  keywords: '',
  isActive: true,
  verified: false,
}

export default async function KnowledgePage() {
  const session = await requireAdminPage('assistant.view')
  await connection()
  const items = await listKnowledge(session.salonId)
  const canEdit = session.permissions.includes('assistant.manage')
  const quoted = items.filter((k) => k.isActive && k.verifiedAt).length
  return (
    <>
      <PageHeader
        title="AI туслах"
        description="Салоны баталгаажсан асуулт, хариулт. Туслах зөвхөн идэвхтэй, баталгаажсан хариултыг үгчлэн хэлнэ; хариултыг засвал дахин баталгаажуулна. Үнэ энд бичихгүй — туслах үнийг үйлчилгээний каталогоос уншина. Ажлын цаг, хаяг, цуцлалт, урьдчилгааны журмыг «Тохиргоо» хэсгээс шууд авна."
      />
      <AssistantTabs current="knowledge" />
      <p className="mb-4 text-sm text-ink-3">
        Нийт {items.length} · туслах иш татах: {quoted}
      </p>
      <div className="space-y-4">
        {items.length ? (
          items.map((k) => (
            <Card
              key={k.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {k.question}
                  <Badge tone="muted">{topicLabel(k.topic)}</Badge>
                  {k.verifiedAt ? (
                    <Badge tone="success">Баталгаажсан</Badge>
                  ) : (
                    <Badge tone="warning">Баталгаажаагүй</Badge>
                  )}
                  {!k.isActive ? <Badge tone="muted">Идэвхгүй</Badge> : null}
                </span>
              }
              action={<span className="text-xs text-ink-3">{formatDateTime(k.updatedAt)}</span>}
            >
              <KnowledgeEditor
                canEdit={canEdit}
                initial={{
                  id: k.id,
                  topic: knowledgeTopic(k.topic),
                  question: k.question,
                  answer: k.answer,
                  keywords: k.keywords,
                  isActive: k.isActive,
                  verified: Boolean(k.verifiedAt),
                }}
              />
            </Card>
          ))
        ) : (
          <EmptyState title="Мэдлэг алга">Доорх маягтаар эхний асуулт, хариултаа нэмнэ үү.</EmptyState>
        )}
        {canEdit ? (
          <Card title="Шинэ асуулт, хариулт">
            <KnowledgeEditor canEdit initial={EMPTY} />
          </Card>
        ) : null}
      </div>
    </>
  )
}
