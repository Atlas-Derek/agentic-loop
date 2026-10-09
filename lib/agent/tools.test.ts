import { describe, expect, it } from 'vitest';
import { capToolOutput } from './tools';

describe('capToolOutput', () => {
  it('passes small results through unchanged', () => {
    const out = { id: 1, title: 'Pick venue' };
    expect(capToolOutput(out, 100)).toBe(out);
    expect(capToolOutput(undefined, 100)).toBeUndefined();
  });

  it('replaces large results with a marked, bounded preview', () => {
    const big = { tasks: Array.from({ length: 50 }, (_, i) => ({ id: i, title: `Task ${i}` })) };
    const capped = capToolOutput(big, 100) as { truncated: boolean; note: string; preview: string };
    expect(capped.truncated).toBe(true);
    expect(capped.preview).toHaveLength(100);
    expect(capped.note).toMatch(/only the first 100/);
  });
});
