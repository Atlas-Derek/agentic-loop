import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { selectMessagesToCompact, toTranscript } from './compaction';

const msgs = (roles: string): { role: string; i: number }[] =>
  roles.split('').map((r, i) => ({ role: r === 'u' ? 'user' : 'assistant', i }));

describe('selectMessagesToCompact', () => {
  it('does nothing at or under the threshold', () => {
    expect(selectMessagesToCompact(msgs('uaua'), 4, 2)).toEqual([]);
  });

  it('keeps the last `keep` messages when the tail starts with a user turn', () => {
    const picked = selectMessagesToCompact(msgs('uauaua'), 4, 2);
    expect(picked.map((m) => m.i)).toEqual([0, 1, 2, 3]);
  });

  it('keeps extra messages so the tail starts on a user turn', () => {
    // keep=3 would start on an assistant message (index 3), so cut moves back to index 2
    const picked = selectMessagesToCompact(msgs('uauaua'), 4, 3);
    expect(picked.map((m) => m.i)).toEqual([0, 1]);
  });

  it('compacts nothing if no user message exists before the cut', () => {
    expect(selectMessagesToCompact(msgs('uaaaaa'), 4, 2)).toEqual([]);
  });
});

describe('toTranscript', () => {
  it('renders text and tool parts', () => {
    const m = [
      { role: 'user', parts: [{ type: 'text', text: 'Plan an offsite' }] },
      {
        role: 'assistant',
        parts: [
          { type: 'tool-createTask', toolCallId: '1', state: 'output-available', input: { title: 'Pick venue' }, output: { id: 1 } },
          { type: 'text', text: 'Created.' },
        ],
      },
    ] as Pick<UIMessage, 'role' | 'parts'>[];
    expect(toTranscript(m)).toBe(
      'USER: Plan an offsite\n\nASSISTANT: [tool createTask({"title":"Pick venue"}) -> {"id":1}]\nCreated.',
    );
  });
});
