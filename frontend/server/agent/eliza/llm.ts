import { AgentError } from './_errors.js'
import { DailyBudgetGuard, parsePositiveNumber } from './_rateLimit.js'
import { logger } from '../../_lib/logger.js'

declare const process: { env: Record<string, string | undefined> }

export type LlmProvider = {
  name: string
  envKey: string
  apiUrl: string
  model: string
  transformBody?: (messages: Array<{ role: string; content: string }>, maxTokens: number) => unknown
  extractContent?: (json: any) => string | null
  estimateUsdPer1kTokens: number
}

type ProviderAttempt = {
  provider: string
  ok: boolean
  error?: string
}

type ProviderCircuitState = {
  consecutiveFailures: number
  openUntilMs: number
  lastError?: string
}

export type LlmGenerateResult = {
  text: string | null
  provider: string | null
  attempts: ProviderAttempt[]
}

type GenerateParams = {
  agentKey: string
  userMessage: string
  systemPrompt: string
  vaultContext: string
  correlationId: string
  preferredModel?: string
}

const PROVIDERS: LlmProvider[] = [
  {
    name: 'Groq',
    envKey: 'GROQ_API_KEY',
    apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    estimateUsdPer1kTokens: 0.0008,
  },
  {
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    estimateUsdPer1kTokens: 0.00075,
  },
  {
    name: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    apiUrl: 'https://api.anthropic.com/v1/messages',
    model: 'claude-3-5-haiku-20241022',
    transformBody: (messages, maxTokens) => ({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: maxTokens,
      system: messages.find((m) => m.role === 'system')?.content ?? '',
      messages: messages.filter((m) => m.role !== 'system'),
    }),
    extractContent: (json) => json?.content?.[0]?.text ?? null,
    estimateUsdPer1kTokens: 0.0012,
  },
  {
    name: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'meta-llama/llama-3.3-70b-instruct',
    estimateUsdPer1kTokens: 0.0009,
  },
]

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

function parsePriority(raw: string | undefined): string[] {
  const fallback = ['Groq', 'OpenAI', 'Anthropic', 'OpenRouter']
  const source = String(raw ?? '').trim()
  if (!source) return fallback
  const requested = source
    .split(/[,\s]+/g)
    .map((v) => v.trim())
    .filter(Boolean)
  if (requested.length === 0) return fallback
  return requested
}

function toHeaders(provider: LlmProvider, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (provider.name === 'Anthropic') {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
    return headers
  }
  headers.Authorization = `Bearer ${apiKey}`
  return headers
}

function toRequestBody(
  provider: LlmProvider,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  preferredModel?: string,
): unknown {
  if (provider.transformBody) return provider.transformBody(messages, maxTokens)
  return {
    model: preferredModel || provider.model,
    messages,
    max_tokens: maxTokens,
    temperature: 0.7,
  }
}

class ElizaLlmService {
  private readonly maxRetries: number
  private readonly timeoutMs: number
  private readonly retryBaseMs: number
  private readonly maxInputChars: number
  private readonly maxOutputTokens: number
  private readonly circuitFailureThreshold: number
  private readonly circuitOpenMs: number
  private readonly budgetGuard: DailyBudgetGuard
  private readonly circuits = new Map<string, ProviderCircuitState>()

  constructor() {
    this.maxRetries = Math.floor(parsePositiveNumber(process.env.ELIZA_LLM_MAX_RETRIES, 3))
    this.timeoutMs = Math.floor(parsePositiveNumber(process.env.ELIZA_LLM_TIMEOUT_MS, 30_000))
    this.retryBaseMs = Math.floor(parsePositiveNumber(process.env.ELIZA_LLM_RETRY_BASE_MS, 1_000))
    this.maxInputChars = Math.floor(parsePositiveNumber(process.env.ELIZA_LLM_MAX_INPUT_CHARS, 4_000))
    this.maxOutputTokens = Math.floor(parsePositiveNumber(process.env.ELIZA_LLM_MAX_OUTPUT_TOKENS, 512))
    this.circuitFailureThreshold = Math.floor(parsePositiveNumber(process.env.ELIZA_PROVIDER_CIRCUIT_FAILS, 3))
    this.circuitOpenMs = Math.floor(parsePositiveNumber(process.env.ELIZA_PROVIDER_CIRCUIT_OPEN_MS, 60_000))
    const tokenBudget = Number(String(process.env.ELIZA_DAILY_LLM_TOKEN_BUDGET ?? '').trim())
    const usdBudget = Number(String(process.env.ELIZA_DAILY_LLM_USD_BUDGET ?? '').trim())
    this.budgetGuard = new DailyBudgetGuard(
      Number.isFinite(tokenBudget) && tokenBudget > 0 ? tokenBudget : null,
      Number.isFinite(usdBudget) && usdBudget > 0 ? usdBudget : null,
    )
  }

  getAvailableProviders(): LlmProvider[] {
    const available = PROVIDERS.filter((provider) => {
      return Boolean(String(process.env[provider.envKey] ?? '').trim())
    })
    const byName = new Map(available.map((provider) => [provider.name.toLowerCase(), provider]))
    const ordered: LlmProvider[] = []
    for (const name of parsePriority(process.env.ELIZA_LLM_PROVIDER_PRIORITY)) {
      const provider = byName.get(name.toLowerCase())
      if (provider) ordered.push(provider)
    }
    for (const provider of available) {
      if (!ordered.includes(provider)) ordered.push(provider)
    }
    return ordered
  }

  getHealth() {
    const providers = this.getAvailableProviders().map((provider) => {
      const state = this.circuits.get(provider.name)
      const isOpen = Boolean(state && state.openUntilMs > Date.now())
      return {
        name: provider.name,
        model: provider.model,
        circuitOpen: isOpen,
        openForMs: isOpen && state ? Math.max(0, state.openUntilMs - Date.now()) : 0,
        consecutiveFailures: state?.consecutiveFailures ?? 0,
        lastError: state?.lastError ?? null,
      }
    })
    return { providers }
  }

  private markProviderFailure(provider: LlmProvider, error: string): void {
    const current = this.circuits.get(provider.name) ?? {
      consecutiveFailures: 0,
      openUntilMs: 0,
    }
    current.consecutiveFailures += 1
    current.lastError = error
    if (current.consecutiveFailures >= this.circuitFailureThreshold) {
      current.openUntilMs = Date.now() + this.circuitOpenMs
    }
    this.circuits.set(provider.name, current)
  }

  private markProviderSuccess(provider: LlmProvider): void {
    this.circuits.set(provider.name, {
      consecutiveFailures: 0,
      openUntilMs: 0,
      lastError: undefined,
    })
  }

  private providerIsCircuitOpen(provider: LlmProvider): boolean {
    const state = this.circuits.get(provider.name)
    if (!state) return false
    return state.openUntilMs > Date.now()
  }

  private async requestWithRetry(params: {
    provider: LlmProvider
    apiKey: string
    body: unknown
    correlationId: string
  }): Promise<string> {
    let lastError = 'request_failed'
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        const response = await fetch(params.provider.apiUrl, {
          method: 'POST',
          headers: toHeaders(params.provider, params.apiKey),
          body: JSON.stringify(params.body),
          signal: controller.signal,
        })
        if (!response.ok) {
          const message = `provider_status_${response.status}`
          if (attempt < this.maxRetries && shouldRetryStatus(response.status)) {
            const waitMs = this.retryBaseMs * Math.pow(2, attempt)
            await sleep(waitMs)
            continue
          }
          throw new AgentError('UPSTREAM_ERROR', message, {
            retryable: shouldRetryStatus(response.status),
            details: { provider: params.provider.name, status: response.status, correlationId: params.correlationId },
          })
        }
        const json = (await response.json()) as any
        const content = params.provider.extractContent
          ? params.provider.extractContent(json)
          : json?.choices?.[0]?.message?.content ?? null
        if (!content || !String(content).trim()) {
          throw new AgentError('UPSTREAM_ERROR', 'provider_empty_response', {
            retryable: false,
            details: { provider: params.provider.name, correlationId: params.correlationId },
          })
        }
        return String(content).trim()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        lastError = message
        const aborted = message.toLowerCase().includes('abort')
        const retryable = aborted || message.includes('provider_status_429') || message.includes('provider_status_5')
        if (attempt < this.maxRetries && retryable) {
          const waitMs = this.retryBaseMs * Math.pow(2, attempt)
          await sleep(waitMs)
          continue
        }
        if (aborted) {
          throw new AgentError('UPSTREAM_TIMEOUT', `provider_timeout_${params.provider.name.toLowerCase()}`, {
            retryable: true,
            details: { provider: params.provider.name, correlationId: params.correlationId },
          })
        }
        throw error
      } finally {
        clearTimeout(timeout)
      }
    }
    throw new AgentError('UPSTREAM_ERROR', lastError, { retryable: true })
  }

  async generateResponse(params: GenerateParams): Promise<LlmGenerateResult> {
    const providers = this.getAvailableProviders()
    if (providers.length === 0) {
      return { text: null, provider: null, attempts: [] }
    }

    const trimmedUserMessage = params.userMessage.slice(0, this.maxInputChars)
    const systemBlock = `${params.systemPrompt}\n\n${params.vaultContext}`.trim()
    const messages = [
      { role: 'system', content: systemBlock },
      { role: 'user', content: trimmedUserMessage },
    ]
    const inputTokens = estimateTokens(systemBlock) + estimateTokens(trimmedUserMessage)
    const budgetCheck = this.budgetGuard.canConsume(params.agentKey, { inputTokens })
    if (!budgetCheck.allowed) {
      throw new AgentError('BUDGET_EXCEEDED', `daily_${budgetCheck.reason ?? 'budget'}_exceeded`, {
        retryable: false,
      })
    }

    const attempts: ProviderAttempt[] = []
    for (const provider of providers) {
      if (this.providerIsCircuitOpen(provider)) {
        attempts.push({
          provider: provider.name,
          ok: false,
          error: 'circuit_open',
        })
        continue
      }

      const apiKey = String(process.env[provider.envKey] ?? '').trim()
      if (!apiKey) continue

      const body = toRequestBody(provider, messages, this.maxOutputTokens, params.preferredModel)
      try {
        const text = await this.requestWithRetry({
          provider,
          apiKey,
          body,
          correlationId: params.correlationId,
        })
        const outputTokens = estimateTokens(text)
        const estimatedUsd = ((inputTokens + outputTokens) / 1_000) * provider.estimateUsdPer1kTokens
        const postBudget = this.budgetGuard.canConsume(params.agentKey, {
          inputTokens,
          outputTokens,
          estimatedUsd,
        })
        if (!postBudget.allowed) {
          throw new AgentError('BUDGET_EXCEEDED', `daily_${postBudget.reason ?? 'budget'}_exceeded`, {
            retryable: false,
          })
        }
        this.budgetGuard.record(params.agentKey, { inputTokens, outputTokens, estimatedUsd })
        this.markProviderSuccess(provider)
        attempts.push({ provider: provider.name, ok: true })
        return {
          text,
          provider: provider.name,
          attempts,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.markProviderFailure(provider, message)
        attempts.push({ provider: provider.name, ok: false, error: message })
        logger.warn('[eliza/llm] provider attempt failed', {
          provider: provider.name,
          correlationId: params.correlationId,
          error: message,
        })
      }
    }
    return { text: null, provider: null, attempts }
  }

  async *streamResponse(params: GenerateParams): AsyncGenerator<{ type: string; data: unknown }, void, void> {
    const result = await this.generateResponse(params)
    yield {
      type: 'meta',
      data: {
        provider: result.provider,
        attempts: result.attempts,
      },
    }

    const text = result.text ?? ''
    if (!text) {
      yield { type: 'error', data: { message: 'No LLM response available' } }
      return
    }
    const chunks = text.split(/\s+/g)
    let cumulative = ''
    for (const chunk of chunks) {
      cumulative = cumulative ? `${cumulative} ${chunk}` : chunk
      yield { type: 'delta', data: { text: `${chunk} ` } }
      await sleep(20)
    }
    yield { type: 'done', data: { text: cumulative } }
  }
}

let singleton: ElizaLlmService | null = null

export function getElizaLlmService(): ElizaLlmService {
  if (!singleton) singleton = new ElizaLlmService()
  return singleton
}

