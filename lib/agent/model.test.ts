import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCompactionModel } from './model';

afterEach(() => vi.unstubAllEnvs());

describe('getCompactionModel', () => {
  it("uses the provider's cheap summarizer model, whatever the chat model is", () => {
    vi.stubEnv('OPENAI_API_KEY', 'test');
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'test');
    expect(getCompactionModel('openai')).toMatchObject({ modelId: 'gpt-5-mini' });
    expect(getCompactionModel('google')).toMatchObject({ modelId: 'gemini-3.8-flash' });
  });

  it('fails clearly without an API key', () => {
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '');
    expect(() => getCompactionModel('google')).toThrow(/No API key/);
  });
});
