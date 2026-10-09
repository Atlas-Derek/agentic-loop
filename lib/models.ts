/**
 * Model registry. Client-safe (no provider SDK imports) so the UI can render the selector.
 * Server-side model construction lives in lib/agent/model.ts.
 */
import type { Provider } from './db/repo';

export type ModelOption = { provider: Provider; id: string; label: string };

export const MODELS: ModelOption[] = [
  { provider: 'openai', id: 'gpt-5-mini', label: 'OpenAI · GPT-5 mini' },
  { provider: 'openai', id: 'gpt-5', label: 'OpenAI · GPT-5' },
  { provider: 'google', id: 'gemini-3.8-flash', label: 'Google · Gemini 3.8 Flash' },
  { provider: 'google', id: 'gemini-pro-latest', label: 'Google · Gemini Pro (latest)' },
];

export const DEFAULT_MODEL: ModelOption = MODELS[0];

export function findModel(provider: string, id: string): ModelOption | undefined {
  return MODELS.find((m) => m.provider === provider && m.id === id);
}
