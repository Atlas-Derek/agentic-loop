'use client';

import { useRef, useState } from 'react';
import type { Memory, Provider, Session, SessionState } from '@/lib/api-types';
import { MAX_TITLE_LENGTH } from '@/lib/limits';
import { MODELS } from '@/lib/models';

// ---------------------------------------------------------------- left column

export function SessionList(props: {
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (session: Session) => void;
  onRename: (session: Session, title: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <>
      <h3>Sessions</h3>
      <button onClick={props.onNew} className="btn-primary new-session">+ New session</button>
      {props.sessions.map((s) => (
        // Sibling buttons (a button can't contain another button).
        <div key={s.id} className="session-row">
          {editingId === s.id ? (
            <RenameInput
              initial={s.title}
              onDone={(title) => {
                setEditingId(null);
                if (title !== null && title !== s.title) props.onRename(s, title);
              }}
            />
          ) : (
            <button
              className={`session ${s.id === props.activeId ? 'active' : ''}`}
              onClick={() => props.onSelect(s.id)}
              onDoubleClick={() => setEditingId(s.id)}
              title={`${s.title} (double-click to rename)`}
            >
              {s.title}
              <div className="muted">{s.model} · {new Date(s.updatedAt).toLocaleString()}</div>
            </button>
          )}
          <button className="session-action" onClick={() => setEditingId(s.id)} aria-label={`Rename session ${s.title}`} title="Rename session">
            <PencilIcon />
          </button>
          <button className="session-action session-delete" onClick={() => props.onDelete(s)} aria-label={`Delete session ${s.title}`} title="Delete session">
            ×
          </button>
        </div>
      ))}
    </>
  );
}

/**
 * Inline name editor. Enter or clicking away saves, Escape cancels. Calls onDone exactly once:
 * with the trimmed name, or null to cancel (also for an empty name, which keeps the old one).
 */
function RenameInput({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const finished = useRef(false);
  const finish = (title: string | null) => {
    // Enter/Escape unmount the input, which can also fire blur; only act on the first event.
    if (finished.current) return;
    finished.current = true;
    onDone(title === null || title.trim() === '' ? null : title.trim());
  };
  return (
    <input
      className="session-rename"
      aria-label="Session name"
      defaultValue={initial}
      maxLength={MAX_TITLE_LENGTH}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value);
        if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function ModelSelector(props: {
  provider: string;
  model: string;
  available: Record<Provider, boolean>;
  onChange: (provider: Provider, model: string) => void;
}) {
  return (
    <>
      <h3>Model</h3>
      <select
        className="model-select"
        value={`${props.provider}:${props.model}`}
        onChange={(e) => {
          const [provider, model] = e.target.value.split(':') as [Provider, string];
          props.onChange(provider, model);
        }}
      >
        {MODELS.map((m) => (
          <option key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`} disabled={!props.available[m.provider]}>
            {m.label}{props.available[m.provider] ? '' : ' (no API key)'}
          </option>
        ))}
      </select>
      <p className="muted">Switching applies to the next message, mid-session too.</p>
    </>
  );
}

// ---------------------------------------------------------------- right column

export function WorkflowPanel({ state }: { state: SessionState }) {
  const { phase, tasks, counts } = state.workflow;
  return (
    <>
      <h3>Workflow</h3>
      <div>
        Phase: <span className={`badge ${phase}`}>{phase}</span>{' '}
        <span className="muted">{counts.done}/{tasks.length} done{counts.blocked ? `, ${counts.blocked} blocked` : ''}</span>
      </div>
      {tasks.map((t) => (
        <div key={t.id} className="task">
          <span className={`badge status-${t.status}`}>{t.status}</span> #{t.id} {t.title}
          {t.note && <div className="muted">{t.note}</div>}
        </div>
      ))}
      {state.finalSummary && (
        <>
          <h3>Final summary</h3>
          <div className="box">{state.finalSummary.content}</div>
        </>
      )}
    </>
  );
}

export function ToolCallLog({ state }: { state: SessionState }) {
  return (
    <>
      <h3>Tool calls ({state.toolCalls.length})</h3>
      {state.toolCalls.length === 0 && <p className="muted">None yet.</p>}
      {[...state.toolCalls].reverse().map((c) => (
        <details key={c.id} className="call">
          <summary>
            <span className={c.success ? 'ok' : 'fail'}>{c.success ? '✓' : '✗'}</span> <b>{c.toolName}</b>{' '}
            <span className="muted">{c.durationMs}ms · {new Date(c.createdAt).toLocaleTimeString()}</span>
            {c.error && <div className="fail call-error">{c.error}</div>}
          </summary>
          <pre>input: {JSON.stringify(c.input, null, 2)}</pre>
          <pre>result: {JSON.stringify(c.output, null, 2)}</pre>
        </details>
      ))}
    </>
  );
}

export function CompactionPanel({ state }: { state: SessionState }) {
  const compactedCount = state.messages.filter((m) => m.compacted).length;
  return (
    <>
      <h3>Compaction</h3>
      {state.compaction ? (
        <>
          <p className="muted">
            {compactedCount} older message(s) replaced by this summary in the prompt (originals kept in DB).
          </p>
          <div className="box">{state.compaction.content}</div>
        </>
      ) : (
        <p className="muted">Not compacted yet ({state.messages.length} messages).</p>
      )}
    </>
  );
}

export function MemoryPanel({ memories, onSetStatus }: { memories: Memory[]; onSetStatus: (id: number, status: Memory['status']) => void }) {
  return (
    <>
      <h3>Memory (global)</h3>
      {memories.length === 0 && <p className="muted">No memories yet. The agent proposes them; you approve.</p>}
      {memories.map((m) => (
        <div key={m.id} className="task">
          <span className={`badge ${m.status === 'approved' ? 'complete' : m.status === 'proposed' ? 'executing' : ''}`}>{m.status}</span> {m.content}
          {m.reason && <div className="muted">why: {m.reason}</div>}
          {m.status === 'proposed' && (
            <div className="actions">
              <button className="btn-primary" onClick={() => onSetStatus(m.id, 'approved')}>Approve</button>{' '}
              <button onClick={() => onSetStatus(m.id, 'rejected')}>Reject</button>
            </div>
          )}
          {m.status === 'approved' && (
            <div className="actions">
              <button onClick={() => onSetStatus(m.id, 'rejected')}>Forget</button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
