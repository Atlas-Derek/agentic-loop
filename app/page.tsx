'use client';

/**
 * Single-page prototype UI.
 * Left: sessions + model selector. Center: chat. Right: workflow, tool calls, compaction, memory.
 * The active session id is kept in the URL (?s=...) so a reload resumes it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Chat } from '@/components/Chat';
import { ThemeToggle } from '@/components/ThemeToggle';
import { CompactionPanel, MemoryPanel, ModelSelector, SessionList, ToolCallLog, WorkflowPanel } from '@/components/Panels';
import type { Memory, Provider, SessionState, SessionsResponse } from '@/lib/api-types';

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${url} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export default function Home() {
  const [list, setList] = useState<SessionsResponse>({ sessions: [], providers: { openai: false, google: false } });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [state, setState] = useState<SessionState | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshList = useCallback(async () => setList(await getJson<SessionsResponse>('/api/sessions')), []);
  const refreshMemories = useCallback(async () => setMemories(await getJson<Memory[]>('/api/memories')), []);
  const refreshSession = useCallback(async (id: string) => setState(await getJson<SessionState>(`/api/sessions/${id}`)), []);

  const selectSession = useCallback(
    async (id: string) => {
      try {
        setLoadError(null);
        await refreshSession(id);
        setActiveId(id);
        window.history.replaceState(null, '', `?s=${id}`);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    },
    [refreshSession],
  );

  // Initial load: session list, memories, and resume the session from the URL if present.
  useEffect(() => {
    void refreshList();
    void refreshMemories();
    const fromUrl = new URLSearchParams(window.location.search).get('s');
    if (fromUrl) void selectSession(fromUrl);
  }, [refreshList, refreshMemories, selectSession]);

  /** Run a UI action and show any failure in the error banner instead of an unhandled rejection. */
  const run = async (action: () => Promise<void>) => {
    try {
      setLoadError(null);
      await action();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  };

  const newSession = () =>
    run(async () => {
      const body = state ? { provider: state.session.provider, model: state.session.model } : {};
      const s = await getJson<{ id: string }>('/api/sessions', { method: 'POST', body: JSON.stringify(body) });
      await refreshList();
      await selectSession(s.id);
    });

  const deleteSession = (id: string, title: string) =>
    run(async () => {
      if (!window.confirm(`Delete "${title}"? Its messages, tasks and tool log are removed permanently.`)) return;
      await getJson(`/api/sessions/${id}`, { method: 'DELETE' });
      if (id === activeId) {
        // Unmounting the chat pane also aborts any turn still streaming for this session.
        setActiveId(null);
        setState(null);
        window.history.replaceState(null, '', window.location.pathname);
      }
      await refreshList();
    });

  const changeModel = (provider: Provider, model: string) =>
    run(async () => {
      if (!activeId) return;
      await getJson(`/api/sessions/${activeId}`, { method: 'PATCH', body: JSON.stringify({ provider, model }) });
      await refreshSession(activeId);
    });

  const setMemoryStatus = (id: number, status: Memory['status']) =>
    run(async () => {
      await getJson(`/api/memories/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await refreshMemories();
    });

  // After every agent turn, pull fresh workflow / tool log / memory state from the server.
  const onTurnEnd = useCallback(() => {
    if (!activeId) return;
    void refreshSession(activeId);
    void refreshMemories();
    void refreshList();
  }, [activeId, refreshSession, refreshMemories, refreshList]);

  return (
    <div className="app">
      <aside className="col sidebar">
        <header className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Workflow Agent</span>
          <ThemeToggle />
        </header>
        <SessionList
          sessions={list.sessions}
          activeId={activeId}
          onSelect={(id) => void selectSession(id)}
          onNew={() => void newSession()}
          onDelete={(s) => void deleteSession(s.id, s.title)}
        />
        {state && (
          <ModelSelector provider={state.session.provider} model={state.session.model} available={list.providers} onChange={(p, m) => void changeModel(p, m)} />
        )}
        {activeId && <p className="muted session-id">Session ID: {activeId}</p>}
      </aside>

      <main className="col chat">
        {loadError && <div className="error">{loadError}</div>}
        {state && activeId ? (
          <Chat
            key={activeId}
            sessionId={activeId}
            initialMessages={state.messages}
            provider={state.session.provider}
            model={state.session.model}
            onTurnEnd={onTurnEnd}
          />
        ) : (
          <div className="empty-state">
            <span className="brand-mark large" aria-hidden="true" />
            <p className="muted">Create or select a session to start.</p>
          </div>
        )}
      </main>

      <aside className="col inspector">
        {state && (
          <>
            <section className="panel">
              <WorkflowPanel state={state} />
            </section>
            <section className="panel">
              <ToolCallLog state={state} />
            </section>
            <section className="panel">
              <CompactionPanel state={state} />
            </section>
          </>
        )}
        <section className="panel">
          <MemoryPanel memories={memories} onSetStatus={(id, s) => void setMemoryStatus(id, s)} />
        </section>
      </aside>
    </div>
  );
}
