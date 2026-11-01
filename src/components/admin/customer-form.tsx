'use client'

import { useState, useTransition } from 'react'
import { FeedbackLine, feedbackFrom, type Feedback } from '@/components/admin/action-button'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Textarea } from '@/components/ui/field'
import { updateCustomerAction } from '@/server/actions/admin-customers'

export function CustomerNotesForm({
  id,
  notes,
  preferences,
  marketingOptIn,
}: {
  id: string
  notes: string | null
  preferences: string | null
  marketingOptIn: boolean
}) {
  const [v, setV] = useState({ notes: notes ?? '', preferences: preferences ?? '', marketingOptIn })
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [pending, start] = useTransition()
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () =>
          setFeedback(
            feedbackFrom(
              await updateCustomerAction({
                id,
                notes: v.notes || null,
                preferences: v.preferences || null,
                marketingOptIn: v.marketingOptIn,
              }),
              'Хадгалагдлаа.',
            ),
          ),
        )
      }}
    >
      <Field label="Сонголт (хэлбэр, өнгө…)" htmlFor="cu-pref">
        <Input
          id="cu-pref"
          value={v.preferences}
          onChange={(e) => setV({ ...v, preferences: e.target.value })}
          maxLength={300}
        />
      </Field>
      <Field label="Дотоод тэмдэглэл" htmlFor="cu-notes" hint="Зөвхөн ажилтанд харагдана">
        <Textarea
          id="cu-notes"
          value={v.notes}
          onChange={(e) => setV({ ...v, notes: e.target.value })}
          maxLength={2000}
        />
      </Field>
      <Checkbox
        label="Мэдээ, урамшуулал авахыг зөвшөөрсөн"
        checked={v.marketingOptIn}
        onChange={(e) => setV({ ...v, marketingOptIn: e.target.checked })}
      />
      <Button type="submit" variant="secondary" disabled={pending}>
        Хадгалах
      </Button>
      <FeedbackLine feedback={feedback} />
    </form>
  )
}
