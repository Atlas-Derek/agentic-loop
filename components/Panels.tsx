'use client';

import type { Memory, Provider, Session, SessionState } from '@/lib/api-types';
import { MODELS } from '@/lib/models';

// ---------------------------------------------------------------- left column

export function SessionList(props: { sessions: Session[]; activeId: string | null; onSelect: (id: string) => void; onNew: () => void }) {
  return (
    <>
      <h3>Sessions</h3>
      <button onClick={props.onNew} style={{ width: '100%', marginBottom: 8 }}>+ New session</button>
      {props.sessions.map((s) => (
        <button key={s.id} className={`session ${s.id === props.activeId ? 'active' : ''}`} onClick={() => props.onSelect(s.id)} title={s.id}>
          {s.title}
          <div className="muted">{s.model} · {new Date(s.updatedAt).toLocaleString()}</div>
        </button>
      ))}
    </>
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
        style={{ width: '100%' }}
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
            {c.error && <div className="fail" style={{ fontSize: 12 }}>{c.error}</div>}
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
            <div style={{ marginTop: 4 }}>
              <button onClick={() => onSetStatus(m.id, 'approved')}>Approve</button>{' '}
              <button onClick={() => onSetStatus(m.id, 'rejected')}>Reject</button>
            </div>
          )}
          {m.status === 'approved' && <button style={{ marginTop: 4 }} onClick={() => onSetStatus(m.id, 'rejected')}>Forget</button>}
        </div>
      ))}
    </>
  );
}
