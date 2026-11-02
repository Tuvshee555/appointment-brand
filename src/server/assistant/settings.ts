// The owner's assistant settings, with defaults when the salon has not saved any.
import { eq } from 'drizzle-orm'
import type { Database } from '@/server/db/client'
import * as t from '@/server/db/schema'
import { DEFAULT_MODEL, type Provider } from './engine/model'

export interface AssistantSettings {
  enabled: boolean
  provider: 'auto' | Provider
  model: string
  dailyBudgetUsd: number
  useModelForUnderstanding: boolean
  useModelForAnswers: boolean
  englishReplies: boolean
  handoverAutoResumeHours: number
  greeting: string | null
  handoverMessage: string | null
  updatedAt: Date | null
}

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  enabled: true,
  provider: 'auto',
  model: DEFAULT_MODEL,
  dailyBudgetUsd: Number(process.env.AI_DAILY_BUDGET_USD || 2),
  useModelForUnderstanding: true,
  useModelForAnswers: true,
  englishReplies: true,
  handoverAutoResumeHours: 24,
  greeting: null,
  handoverMessage: null,
  updatedAt: null,
}

export async function loadAssistantSettings(db: Database, salonId: string): Promise<AssistantSettings> {
  const [row] = await db.select().from(t.assistantSettings).where(eq(t.assistantSettings.salonId, salonId))
  if (!row) return { ...DEFAULT_ASSISTANT_SETTINGS }
  return {
    enabled: row.enabled,
    provider: row.provider === 'openai' || row.provider === 'anthropic' ? row.provider : 'auto',
    model: row.model,
    dailyBudgetUsd: row.dailyBudgetUsd,
    useModelForUnderstanding: row.useModelForUnderstanding,
    useModelForAnswers: row.useModelForAnswers,
    englishReplies: row.englishReplies,
    handoverAutoResumeHours: row.handoverAutoResumeHours,
    greeting: row.greeting,
    handoverMessage: row.handoverMessage,
    updatedAt: row.updatedAt,
  }
}
