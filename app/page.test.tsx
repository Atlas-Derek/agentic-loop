// @vitest-environment jsdom
/**
 * DOM test for the main page: clicking "+ New session" creates a session via the API,
 * selects it, and mounts the chat pane without errors.
 */
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Session, SessionState } from '@/lib/api-types';
import Home from './page';

const session: Session = {
  id: 'sess-1',
  title: 'New session',
  provider: 'openai',
  model: 'gpt-5-mini',
  createdAt: '2026-10-09T00:00:00.000Z',
  updatedAt: '2026-10-09T00:00:00.000Z',
};

const sessionState: SessionState = {
  session,
  messages: [],
  workflow: { phase: 'clarifying', tasks: [], counts: { pending: 0, in_progress: 0, done: 0, blocked: 0 } },
  toolCalls: [],
  compaction: null,
  finalSummary: null,
};

let created = false;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  if (url === '/api/sessions' && method === 'POST') {
    created = true;
    return Response.json(session);
  }
  if (url === '/api/sessions') return Response.json({ sessions: created ? [session] : [], providers: { openai: true, google: false } });
  if (url === '/api/memories') return Response.json([]);
  if (url === `/api/sessions/${session.id}`) return Response.json(sessionState);
  return Response.json({ error: `unexpected ${method} ${url}` }, { status: 500 });
});

beforeEach(() => {
  created = false;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState(null, '', '/');
  // jsdom does not implement scrollIntoView. Current Chrome returns a Promise from it, which is what
  // made an expression-bodied effect hand React a non-function "cleanup" (destroy is not a function).
  Element.prototype.scrollIntoView = vi.fn(() => Promise.resolve()) as unknown as Element['scrollIntoView'];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Home', () => {
  it('creates and opens a new session when "+ New session" is clicked', async () => {
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => errors.push(e.error);
    window.addEventListener('error', onError);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    // StrictMode mirrors `next dev`: effects mount, clean up and mount again.
    render(
      <StrictMode>
        <Home />
      </StrictMode>,
    );
    expect(screen.getByText('Create or select a session to start.')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: '+ New session' }));

    // The chat composer appears and the session id is reflected in the sidebar and URL.
    await waitFor(() => expect(screen.getByPlaceholderText(/Message the agent/)).toBeTruthy());
    expect(screen.getByText(`Session ID: ${session.id}`)).toBeTruthy();
    expect(window.location.search).toBe(`?s=${session.id}`);
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({ method: 'POST' }));

    // Unmounting runs every effect cleanup; a non-function cleanup would throw here.
    cleanup();

    window.removeEventListener('error', onError);
    expect(errors).toEqual([]);
    expect(consoleError.mock.calls.map((c) => String(c[0]))).toEqual([]);
    consoleError.mockRestore();
  });

});
