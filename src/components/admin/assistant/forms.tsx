'use client'

import { Loader2, Send } from 'lucide-react'
import { useState, useTransition } from 'react'
import { ActionButton, FeedbackLine, feedbackFrom, type Feedback } from '@/components/admin/action-button'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/field'
import { TOPIC_LABELS, type KnowledgeTopic } from '@/lib/knowledge-topics'
import {
  deleteKnowledgeAction,
  saveAssistantSettingsAction,
  saveKnowledgeAction,
  setConversationStatusAction,
  staffReplyAction,
} from '@/server/actions/admin-assistant'

function Submit({ pending, label = 'Хадгалах' }: { pending: boolean; label?: string }) {
  return (
    <Button type="submit" variant="secondary" disabled={pending} className="shrink-0">
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {label}
    </Button>
  )
}

export interface SettingsValues {
  enabled: boolean
  provider: 'auto' | 'openai' | 'anthropic'
  model: string
  dailyBudgetUsd: number
  useModelForUnderstanding: boolean
  useModelForAnswers: boolean
  englishReplies: boolean
  handoverAutoResumeHours: number
  greeting: string | null
  handoverMessage: string | null
}

export function AssistantSettingsForm({
  initial,
  models,
  canEdit,
}: {
  initial: SettingsValues
  models: { model: string; label: string; provider: string; price: [number, number]; configured: boolean }[]
  canEdit: boolean
}) {
  const [v, setV] = useState(initial)
  const [pending, start] = useTransition()
  const [feedback, setFeedback] = useState<Feedback>(null)
  const set = <K extends keyof SettingsValues>(k: K, value: SettingsValues[K]) => setV((x) => ({ ...x, [k]: value }))
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => setFeedback(feedbackFrom(await saveAssistantSettingsAction(v), 'Тохиргоо хадгалагдлаа.')))
      }}
    >
      <fieldset disabled={!canEdit} className="space-y-5">
        <Checkbox
          label="Туслах идэвхтэй (унтраавал вэбсайтын чат утасны дугаар өгөөд зогсоно)"
          checked={v.enabled}
          onChange={(e) => set('enabled', e.target.checked)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Үйлчилгээ үзүүлэгч"
            htmlFor="as-provider"
            hint="Автомат: OpenAI түлхүүр байвал түүнийг, үгүй бол Anthropic-ийг."
          >
            <Select
              id="as-provider"
              value={v.provider}
              onChange={(e) => set('provider', e.target.value as SettingsValues['provider'])}
            >
              <option value="auto">Автомат</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </Select>
          </Field>
          <Field
            label="Загвар"
            htmlFor="as-model"
            hint="Анхдагч: GPT-4.1 mini. Үнэ — 1 сая токен тутамд (оролт / гаралт)."
          >
            <Select id="as-model" value={v.model} onChange={(e) => set('model', e.target.value)}>
              {models.map((m) => (
                <option key={m.model} value={m.model}>
                  {m.label} — ${m.price[0]} / ${m.price[1]}
                  {m.configured ? '' : ' (түлхүүр тохируулаагүй)'}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Өдрийн дээд зардал (USD)"
            htmlFor="as-budget"
            hint="Хэтэрвэл туслах дүрмээрээ хариулсаар байна. 0 = хязгааргүй."
          >
            <Input
              id="as-budget"
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={v.dailyBudgetUsd}
              onChange={(e) => set('dailyBudgetUsd', Number(e.target.value))}
            />
          </Field>
          <Field
            label="Ажилтан чимээгүй болвол туслах буцаж хариулах хугацаа (цаг)"
            htmlFor="as-resume"
            hint="0 = ажилтан гараар буцаана."
          >
            <Input
              id="as-resume"
              type="number"
              min={0}
              max={168}
              value={v.handoverAutoResumeHours}
              onChange={(e) => set('handoverAutoResumeHours', Math.trunc(Number(e.target.value)))}
            />
          </Field>
        </div>
        <div className="space-y-2">
          <Checkbox
            label="Дүрэм ойлгоогүй мессежийг AI-аар уншуулах (үр дүнг каталогоор шалгана)"
            checked={v.useModelForUnderstanding}
            onChange={(e) => set('useModelForUnderstanding', e.target.checked)}
          />
          <Checkbox
            label="Нээлттэй асуултад AI хариулт бичүүлэх (үнэ, цаг, утсыг баталгаажсан мэдээллээр шалгана)"
            checked={v.useModelForAnswers}
            onChange={(e) => set('useModelForAnswers', e.target.checked)}
          />
          <Checkbox
            label="Англиар бичсэн хүнд англиар хариулах"
            checked={v.englishReplies}
            onChange={(e) => set('englishReplies', e.target.checked)}
          />
        </div>
        <Field label="Мэндчилгээ" htmlFor="as-greeting" optional hint="Хоосон бол анхдагч мэндчилгээ.">
          <Textarea
            id="as-greeting"
            value={v.greeting ?? ''}
            onChange={(e) => set('greeting', e.target.value || null)}
          />
        </Field>
        <Field label="Ажилтанд шилжүүлэх үеийн мессеж" htmlFor="as-handover" optional>
          <Textarea
            id="as-handover"
            value={v.handoverMessage ?? ''}
            onChange={(e) => set('handoverMessage', e.target.value || null)}
          />
        </Field>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        {canEdit ? (
          <Submit pending={pending} />
        ) : (
          <p className="text-sm text-ink-3">Тохиргоог эзэмшигч, менежер өөрчилнө.</p>
        )}
        <FeedbackLine feedback={feedback} />
      </div>
    </form>
  )
}

export interface KnowledgeValues {
  id: string | null
  topic: KnowledgeTopic
  question: string
  answer: string
  keywords: string
  isActive: boolean
  verified: boolean
}

export function KnowledgeEditor({ initial, canEdit }: { initial: KnowledgeValues; canEdit: boolean }) {
  const [v, setV] = useState(initial)
  const [pending, start] = useTransition()
  const [feedback, setFeedback] = useState<Feedback>(null)
  const set = <K extends keyof KnowledgeValues>(k: K, value: KnowledgeValues[K]) => setV((x) => ({ ...x, [k]: value }))
  const key = v.id ?? 'new'
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const res = await saveKnowledgeAction(v)
          setFeedback(feedbackFrom(res, 'Хадгалагдлаа.'))
          if (res.ok && !v.id && !res.simulated) setV({ ...initial })
        })
      }}
    >
      <fieldset disabled={!canEdit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <Field label="Сэдэв" htmlFor={`kn-topic-${key}`}>
            <Select
              id={`kn-topic-${key}`}
              value={v.topic}
              onChange={(e) => set('topic', e.target.value as KnowledgeValues['topic'])}
            >
              {Object.entries(TOPIC_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Асуулт" htmlFor={`kn-q-${key}`}>
            <Input id={`kn-q-${key}`} value={v.question} onChange={(e) => set('question', e.target.value)} />
          </Field>
        </div>
        <Field label="Хариулт (үнэгүй, туслах үгчлэн хэлнэ)" htmlFor={`kn-a-${key}`}>
          <Textarea id={`kn-a-${key}`} value={v.answer} onChange={(e) => set('answer', e.target.value)} />
        </Field>
        <Field label="Түлхүүр үг (таслалаар)" htmlFor={`kn-k-${key}`} hint="Жишээ: зогсоол, машин, parking">
          <Input id={`kn-k-${key}`} value={v.keywords} onChange={(e) => set('keywords', e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-4">
          <Checkbox label="Идэвхтэй" checked={v.isActive} onChange={(e) => set('isActive', e.target.checked)} />
          <Checkbox
            label="Баталгаажуулсан (бодит мэдээлэлтэй тулгасан)"
            checked={v.verified}
            onChange={(e) => set('verified', e.target.checked)}
          />
        </div>
      </fieldset>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <Submit pending={pending} label={v.id ? 'Хадгалах' : 'Нэмэх'} />
          {v.id ? (
            <ActionButton
              variant="danger"
              confirm="Энэ мэдээллийг устгах уу?"
              okText="Устгагдлаа."
              action={() => deleteKnowledgeAction({ id: v.id })}
            >
              Устгах
            </ActionButton>
          ) : null}
          <FeedbackLine feedback={feedback} />
        </div>
      ) : null}
    </form>
  )
}

export function ConversationActions({
  sessionId,
  status,
  canReply,
}: {
  sessionId: string
  status: string
  canReply: boolean
}) {
  const [text, setText] = useState('')
  const [pending, start] = useTransition()
  const [feedback, setFeedback] = useState<Feedback>(null)
  if (!canReply) return <p className="text-xs text-ink-3">Хариулах эрх эзэмшигч, менежер, ресепшнд байна.</p>
  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          start(async () => {
            const res = await staffReplyAction({ sessionId, text })
            setFeedback(feedbackFrom(res, 'Хариулт илгээгдлээ — үйлчлүүлэгчийн чатад харагдана.'))
            if (res.ok && !res.simulated) setText('')
          })
        }}
      >
        <label htmlFor={`reply-${sessionId}`} className="sr-only">
          Ажилтны хариулт
        </label>
        <Input
          id={`reply-${sessionId}`}
          value={text}
          maxLength={1000}
          placeholder="Үйлчлүүлэгчид хариулах…"
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" disabled={pending || !text.trim()} aria-label="Илгээх">
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
        </Button>
      </form>
      <FeedbackLine feedback={feedback} />
      <div className="flex flex-wrap gap-2">
        {status !== 'staff' ? (
          <ActionButton
            okText="Та энэ яриаг хариулахаар авлаа — туслах чимээгүй болно."
            action={() => setConversationStatusAction({ sessionId, status: 'staff' })}
          >
            Хариулахаар авах
          </ActionButton>
        ) : (
          <ActionButton
            okText="Туслах дахин хариулна."
            action={() => setConversationStatusAction({ sessionId, status: 'bot' })}
          >
            Туслахад буцаах
          </ActionButton>
        )}
        {status !== 'closed' ? (
          <ActionButton
            variant="ghost"
            okText="Шийдвэрлэсэн гэж тэмдэглэлээ."
            action={() => setConversationStatusAction({ sessionId, status: 'closed' })}
          >
            Шийдвэрлэсэн
          </ActionButton>
        ) : null}
      </div>
    </div>
  )
}
