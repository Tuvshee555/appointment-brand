'use server'

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { chatRequestSchema } from '@/lib/assistant/schema'
import type { ChatResponse } from '@/lib/assistant/types'
import { id, optionalText } from '@/lib/validation/common'
import { answerHasAmount } from '@/server/assistant/engine/knowledge'
import { MODEL_OPTIONS } from '@/server/assistant/engine/model'
import { handleChat, postStaffReply, setConversationStatus } from '@/server/assistant/handler'
import { adminContext } from '@/server/auth/current'
import * as t from '@/server/db/schema'
import { ServiceError } from '@/server/context'
import { sha256Hex } from '@/server/security/crypto'
import { enforceRateLimit, LIMITS } from '@/server/security/rate-limit'
import { audit, runAdminAction, safeParse } from './admin-run'
import { toFailure, type ActionResult } from './result'

const settingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['auto', 'openai', 'anthropic']),
  model: z.string().refine((m) => MODEL_OPTIONS.some((o) => o.model === m), 'Загвар жагсаалтад алга.'),
  dailyBudgetUsd: z.number().min(0).max(100),
  useModelForUnderstanding: z.boolean(),
  useModelForAnswers: z.boolean(),
  englishReplies: z.boolean(),
  handoverAutoResumeHours: z.number().int().min(0).max(168),
  greeting: optionalText(600),
  handoverMessage: optionalText(600),
})

export async function saveAssistantSettingsAction(input: unknown) {
  const p = safeParse(settingsSchema, input)
  if (!p.ok) return p
  const v = p.data
  if (v.greeting && answerHasAmount(v.greeting))
    return { ok: false as const, error: 'Мэндчилгээнд үнэ бичихгүй — үнийг үйлчилгээний хэсэгт оруулна.' }
  return runAdminAction('assistant.manage', async (ctx) => {
    const values = { ...v, updatedAt: ctx.now, updatedBy: ctx.actor.adminUserId }
    await ctx.db
      .insert(t.assistantSettings)
      .values({ salonId: ctx.salonId, ...values })
      .onConflictDoUpdate({ target: t.assistantSettings.salonId, set: values })
    await audit(ctx, {
      action: 'assistant.settings',
      entity: 'assistant',
      summary: `AI туслахын тохиргоо: ${v.enabled ? 'идэвхтэй' : 'унтраасан'}, ${v.model}, өдрийн төсөв $${v.dailyBudgetUsd}`,
      detail: { provider: v.provider, model: v.model, budget: v.dailyBudgetUsd },
    })
    return null
  })
}

const knowledgeSchema = z.object({
  id: id.nullish(),
  topic: z.enum(['general', 'preparation', 'aftercare', 'payment', 'parking', 'policy']),
  question: z.string().trim().min(3).max(300),
  answer: z.string().trim().min(3).max(1500),
  keywords: z.string().trim().max(300),
  isActive: z.boolean(),
  verified: z.boolean(),
})

export async function saveKnowledgeAction(input: unknown) {
  const p = safeParse(knowledgeSchema, input)
  if (!p.ok) return p
  const v = p.data
  if (answerHasAmount(v.answer))
    return {
      ok: false as const,
      error: 'Хариултад үнэ бичихгүй: үнэ өөрчлөгдөхөд хуучирдаг. Үнийг «Үйлчилгээ, үнэ» хэсэгт оруулна уу.',
      fieldErrors: { answer: 'Үнэ бичихгүй' },
    }
  return runAdminAction('assistant.manage', async (ctx) => {
    const keywords = v.keywords
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
      .join(', ')
    if (v.id) {
      const [current] = await ctx.db
        .select()
        .from(t.assistantKnowledge)
        .where(and(eq(t.assistantKnowledge.id, v.id), eq(t.assistantKnowledge.salonId, ctx.salonId)))
      if (!current) throw new ServiceError('not_found', 'Мэдээлэл олдсонгүй.')
      // A changed answer must be checked again before the assistant quotes it.
      const changed = current.answer !== v.answer || current.question !== v.question
      const verifiedAt =
        v.verified && !changed ? (current.verifiedAt ?? ctx.now) : v.verified && changed ? ctx.now : null
      await ctx.db
        .update(t.assistantKnowledge)
        .set({
          topic: v.topic,
          question: v.question,
          answer: v.answer,
          keywords,
          isActive: v.isActive,
          verifiedAt,
          verifiedBy: verifiedAt ? ctx.actor.adminUserId : null,
          updatedAt: ctx.now,
          updatedBy: ctx.actor.adminUserId,
        })
        .where(eq(t.assistantKnowledge.id, v.id))
      await audit(ctx, {
        action: 'assistant.knowledge.update',
        entity: 'assistant',
        entityId: v.id,
        summary: `Мэдлэг засав: «${v.question.slice(0, 80)}»${verifiedAt ? '' : ' (баталгаажаагүй)'}`,
      })
      return { id: v.id }
    }
    const [row] = await ctx.db
      .insert(t.assistantKnowledge)
      .values({
        salonId: ctx.salonId,
        topic: v.topic,
        question: v.question,
        answer: v.answer,
        keywords,
        isActive: v.isActive,
        verifiedAt: v.verified ? ctx.now : null,
        verifiedBy: v.verified ? ctx.actor.adminUserId : null,
        sortOrder: 100,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        updatedBy: ctx.actor.adminUserId,
      })
      .returning({ id: t.assistantKnowledge.id })
    await audit(ctx, {
      action: 'assistant.knowledge.create',
      entity: 'assistant',
      entityId: row.id,
      summary: `Мэдлэг нэмэв: «${v.question.slice(0, 80)}»`,
    })
    return { id: row.id }
  })
}

export async function deleteKnowledgeAction(input: unknown) {
  const p = safeParse(z.object({ id }), input)
  if (!p.ok) return p
  return runAdminAction('assistant.manage', async (ctx) => {
    const [row] = await ctx.db
      .delete(t.assistantKnowledge)
      .where(and(eq(t.assistantKnowledge.id, p.data.id), eq(t.assistantKnowledge.salonId, ctx.salonId)))
      .returning({ question: t.assistantKnowledge.question })
    if (!row) throw new ServiceError('not_found', 'Мэдээлэл олдсонгүй.')
    await audit(ctx, {
      action: 'assistant.knowledge.delete',
      entity: 'assistant',
      entityId: p.data.id,
      summary: `Мэдлэг устгав: «${row.question.slice(0, 80)}»`,
    })
    return null
  })
}

const conversationSchema = z.object({ sessionId: id, status: z.enum(['staff', 'bot', 'closed']) })

export async function setConversationStatusAction(input: unknown) {
  const p = safeParse(conversationSchema, input)
  if (!p.ok) return p
  return runAdminAction('assistant.reply', async (ctx) => {
    await setConversationStatus(ctx, { ...p.data, adminUserId: ctx.actor.adminUserId })
    await audit(ctx, {
      action: `assistant.conversation.${p.data.status}`,
      entity: 'assistant',
      entityId: p.data.sessionId,
      summary:
        p.data.status === 'staff'
          ? 'Харилцан яриаг ажилтан хариулахаар авав'
          : p.data.status === 'bot'
            ? 'Харилцан яриаг туслахад буцаав'
            : 'Харилцан яриаг шийдвэрлэсэн гэж тэмдэглэв',
    })
    return null
  })
}

export async function staffReplyAction(input: unknown) {
  const p = safeParse(z.object({ sessionId: id, text: z.string().trim().min(1).max(1000) }), input)
  if (!p.ok) return p
  return runAdminAction('assistant.reply', async (ctx) => {
    await postStaffReply(ctx, {
      sessionId: p.data.sessionId,
      text: p.data.text,
      adminUserId: ctx.actor.adminUserId,
      staffName: ctx.actor.name.split(' ')[0] || 'Ажилтан',
    })
    await audit(ctx, {
      action: 'assistant.conversation.reply',
      entity: 'assistant',
      entityId: p.data.sessionId,
      summary: 'Чатад ажилтан хариулав',
    })
    return null
  })
}

/**
 * «Try it»: the real assistant on the real catalogue and availability, in a test conversation
 * whose bookings, cancellations and moves are validated and rolled back. Kept out of statistics.
 */
export async function testChatAction(
  input: unknown,
): Promise<ActionResult<ChatResponse & { intent?: string; events?: string[] }>> {
  try {
    const p = chatRequestSchema.parse(input)
    const ctx = await adminContext()
    if (!ctx.actor.permissions.includes('assistant.view')) throw new ServiceError('forbidden', 'Эрх алга.')
    await enforceRateLimit(ctx.db, LIMITS.chat, `test:${ctx.actor.adminUserId}`)
    const result = await handleChat(
      ctx,
      'message' in p ? { message: p.message, clientMessageId: crypto.randomUUID() } : { action: p.action },
      { channel: 'test', visitorHash: sha256Hex(`test:${ctx.actor.adminUserId}`), demoVisitorHash: null },
    )
    return {
      ok: true,
      data: {
        messages: result.messages,
        mode: result.mode,
        status: result.status,
        intent: result.intent,
        events: result.events,
      },
    }
  } catch (err) {
    return toFailure(err)
  }
}
