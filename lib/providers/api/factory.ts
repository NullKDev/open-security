import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOllama } from 'ollama-ai-provider'
import { readConfig } from '@/lib/config/store'
import type { LanguageModel } from 'ai'

/**
 * Supported API provider identifiers.
 * Maps to the @ai-sdk/* or ollama-ai-provider packages.
 */
export type ApiProviderId = 'anthropic' | 'openai' | 'google' | 'ollama'

/**
 * Create a Vercel AI SDK language model instance for the given provider.
 *
 * Reads API keys from `.obt/config.json` via the config store.
 * Ollama uses a local endpoint (no API key required).
 *
 * @param providerId Which provider to create a model for
 * @param modelId The specific model identifier (e.g. "claude-sonnet-4-5-20250929")
 * @returns A LanguageModelV2 instance ready for `streamText` / `generateText`
 */
export function createApiModel(
  providerId: ApiProviderId,
  modelId: string,
): LanguageModel {
  const config = readConfig()

  switch (providerId) {
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: config.providers.anthropicKey,
      })
      return anthropic(modelId) as unknown as LanguageModel
    }

    case 'openai': {
      const openai = createOpenAI({
        apiKey: config.providers.openaiKey,
      })
      return openai(modelId) as unknown as LanguageModel
    }

    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey: config.providers.googleKey,
      })
      return google(modelId) as unknown as LanguageModel
    }

    case 'ollama': {
      const ollama = createOllama()
      return ollama(modelId) as unknown as LanguageModel
    }
  }
}
