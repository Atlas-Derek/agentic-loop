import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import type { Provider } from '../db/repo';
import { AgentError } from '../db/repo';
import { findModel } from '../models';

/** Which providers have an API key configured (used to disable options in the UI). */
export function configuredProviders(): Record<Provider, boolean> {
  return {
    openai: Boolean(process.env.OPENAI_API_KEY),
    google: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY),
  };
}

export function getModel(provider: Provider, modelId: string): LanguageModel {
  if (!findModel(provider, modelId)) throw new AgentError(`Unknown model ${provider}/${modelId}`);
  if (!configuredProviders()[provider]) throw new AgentError(`No API key configured for ${provider}`);
  return provider === 'openai' ? openai(modelId) : google(modelId);
}
