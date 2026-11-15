// Language-model adapters (Lorentz model-selection pattern). The model only reads customers'
// words into a structured interpretation and, behind the fact check, words answers to open
// questions; bookings, times and prices always come from the application. Keys stay server-side.
// OpenAI is called over plain fetch (no extra dependency); Anthropic through the existing SDK.
import Anthropic from '@anthropic-ai/sdk'

export type Provider = 'openai' | 'anthropic'

export interface ModelOption {
  provider: Provider
  model: string
  label: string
  /** USD per million tokens [input, output] — an estimate for the budget, never a bill. */
  price: [number, number]
}

/** Models the owner may choose in the admin. gpt-4.1-mini is the default (Lorentz V1 evaluation). */
export const MODEL_OPTIONS: ModelOption[] = [
  { provider: 'openai', model: 'gpt-4.1-mini', label: 'GPT-4.1 mini', price: [0.4, 1.6] },
  { provider: 'openai', model: 'gpt-4.1', label: 'GPT-4.1', price: [2, 8] },
  { provider: 'openai', model: 'gpt-4o-mini', label: 'GPT-4o mini', price: [0.15, 0.6] },
  { provider: 'anthropic', model: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', price: [0.1, 0.5] },
  { provider: 'anthropic', model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', price: [2, 10] },
  { provider: 'anthropic', model: 'claude-opus-5-5', label: 'Claude Opus 5.5', price: [4, 20] },
]

export const DEFAULT_MODEL = 'gpt-4.1-mini'
const DEFAULT_FOR: Record<Provider, string> = { openai: 'gpt-4.1-mini', anthropic: 'claude-haiku-5-5' }

export function providerConfigured(provider: Provider): boolean {
  return Boolean(provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY)
}

export function optionFor(model: string): ModelOption | undefined {
  return MODEL_OPTIONS.find((o) => o.model === model)
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = optionFor(model)?.price ?? [5, 25]
  return (inputTokens * price[0] + outputTokens * price[1]) / 1_000_000
}

/**
 * Which model to call: the owner's allow-listed choice when its provider has a key; with
 * "auto", OpenAI first (gpt-4.1-mini unless chosen otherwise), then Anthropic. Null when no
 * provider is configured — the assistant then answers from its rules alone.
 */
export function resolveModel(setting: { provider: 'auto' | Provider; model: string | null }): ModelOption | null {
  const chosen = setting.model ? optionFor(setting.model) : undefined
  const order: Provider[] =
    setting.provider === 'auto'
      ? chosen
        ? [chosen.provider, 'openai', 'anthropic']
        : ['openai', 'anthropic']
      : [setting.provider]
  for (const provider of order) {
    if (!providerConfigured(provider)) continue
    if (chosen?.provider === provider) return chosen
    const envModel = optionFor(process.env.AI_MODEL ?? '')
    return envModel?.provider === provider ? envModel : optionFor(DEFAULT_FOR[provider])!
  }
  return null
}

export interface ModelRequest {
  system: string
  user: string
  /** Ask for a JSON object (OpenAI JSON mode; Anthropic by instruction). */
  json: boolean
  maxTokens: number
  timeoutMs: number
}

export interface ModelReply {
  text: string
  model: string
  inputTokens: number
  outputTokens: number
}

export class ModelError extends Error {
  constructor(
    public readonly kind: 'timeout' | 'rate_limited' | 'unavailable' | 'bad_response' | 'not_configured',
    message: string,
  ) {
    super(message)
    this.name = 'ModelError'
  }
}

export type ModelCaller = (option: ModelOption, request: ModelRequest) => Promise<ModelReply>

async function callOpenAI(option: ModelOption, req: ModelRequest, fetchImpl: typeof fetch): Promise<ModelReply> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new ModelError('not_configured', 'OPENAI_API_KEY is not set')
  const body: Record<string, unknown> = {
    model: option.model,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    max_completion_tokens: req.maxTokens,
  }
  // The gpt-5 family accepts only its default temperature.
  if (!/^gpt-5/.test(option.model)) body.temperature = 0
  if (req.json) body.response_format = { type: 'json_object' }
  const deadline = Date.now() + req.timeoutMs
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetchImpl(`${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Math.max(500, deadline - Date.now())),
      })
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      if (!timedOut && attempt === 0 && deadline - Date.now() > 1500) continue
      throw new ModelError(timedOut ? 'timeout' : 'unavailable', err instanceof Error ? err.message : String(err))
    }
    if (res.status === 429 || res.status >= 500) {
      // One quick retry with the same model; never a silent switch to a cheaper one.
      if (attempt === 0 && deadline - Date.now() > 2000) {
        await new Promise((r) => setTimeout(r, 400))
        continue
      }
      throw new ModelError(res.status === 429 ? 'rate_limited' : 'unavailable', `OpenAI HTTP ${res.status}`)
    }
    if (!res.ok) throw new ModelError('unavailable', `OpenAI HTTP ${res.status}`)
    const data = (await res.json().catch(() => null)) as {
      model?: string
      choices?: { message?: { content?: string | null } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    } | null
    const text = data?.choices?.[0]?.message?.content?.trim() ?? ''
    if (!text) throw new ModelError('bad_response', 'empty completion')
    return {
      text,
      model: option.model,
      inputTokens: data?.usage?.prompt_tokens ?? 0,
      outputTokens: data?.usage?.completion_tokens ?? 0,
    }
  }
}

async function callAnthropic(option: ModelOption, req: ModelRequest): Promise<ModelReply> {
  if (!process.env.ANTHROPIC_API_KEY) throw new ModelError('not_configured', 'ANTHROPIC_API_KEY is not set')
  const client = new Anthropic({ timeout: req.timeoutMs, maxRetries: 1 })
  try {
    const response = await client.messages.create({
      model: option.model,
      max_tokens: req.maxTokens,
      system: req.json ? `${req.system}\n\nReply with one JSON object only, no other text.` : req.system,
      messages: [{ role: 'user', content: req.user }],
    })
    const text = response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim()
    if (!text) throw new ModelError('bad_response', `empty reply (${response.stop_reason})`)
    return {
      text,
      model: option.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }
  } catch (err) {
    if (err instanceof ModelError) throw err
    if (err instanceof Anthropic.APIConnectionTimeoutError) throw new ModelError('timeout', err.message)
    if (err instanceof Anthropic.RateLimitError) throw new ModelError('rate_limited', err.message)
    throw new ModelError('unavailable', err instanceof Error ? err.message : String(err))
  }
}

/** The production caller. Tests pass their own ModelCaller (or a fetch double for OpenAI). */
export function createModelCaller(fetchImpl: typeof fetch = fetch): ModelCaller {
  return (option, request) =>
    option.provider === 'openai' ? callOpenAI(option, request, fetchImpl) : callAnthropic(option, request)
}

/** The first JSON object in a reply (tolerates ``` fences and leading words). */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1))
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}
