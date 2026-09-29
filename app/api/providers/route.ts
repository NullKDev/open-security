import { ok } from '@/lib/api/envelope'
import { probeAllAgents } from '@/lib/providers/cli/resolve'
import type { AgentProbeResult } from '@/lib/providers/cli/resolve'

export interface ApiProviderInfo {
  id: string
  type: 'api'
  label: string
  models: Array<{ id: string; label: string }>
}

const API_PROVIDERS: ApiProviderInfo[] = [
  {
    id: 'anthropic',
    type: 'api',
    label: 'Anthropic API',
    models: [
      { id: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    ],
  },
  {
    id: 'openai',
    type: 'api',
    label: 'OpenAI API',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'o3', label: 'O3' },
      { id: 'o4-mini', label: 'O4 Mini' },
    ],
  },
  {
    id: 'google',
    type: 'api',
    label: 'Google AI API',
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    ],
  },
  {
    id: 'ollama',
    type: 'api',
    label: 'Ollama (local)',
    models: [
      { id: 'llama3', label: 'Llama 3' },
      { id: 'codellama', label: 'Code Llama' },
      { id: 'deepseek-coder', label: 'DeepSeek Coder' },
    ],
  },
]

export async function GET(): Promise<Response> {
  const agents: AgentProbeResult[] = await probeAllAgents()

  const cli = agents.map((a) => ({
    id: a.id,
    type: 'cli' as const,
    name: a.name,
    bin: a.bin,
    available: a.available,
    path: a.path,
    version: a.version,
    models: a.models,
    streamFormat: a.streamFormat,
  }))

  return ok({ cli, api: API_PROVIDERS })
}
