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
const defaultFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  if (url === '/api/sessions' && method === 'POST') {
    created = true;
    return Response.json(session);
  }
  if (url === '/api/sessions') return Response.json({ sessions: created ? [session] : [], providers: { openai: true, google: false } });
  if (url === '/api/memories') return Response.json([]);
  if (url === `/api/sessions/${session.id}` && method === 'DELETE') {
    created = false;
    return Response.json({ deleted: true, id: session.id });
  }
  if (url === `/api/sessions/${session.id}`) return Response.json(sessionState);
  return Response.json({ error: `unexpected ${method} ${url}` }, { status: 500 });
};
const fetchMock = vi.fn(defaultFetch);

beforeEach(() => {
  created = false;
  fetchMock.mockReset().mockImplementation(defaultFetch);
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

  it('deletes the open session after confirmation and returns to the empty state', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Home />);
    await userEvent.click(screen.getByRole('button', { name: '+ New session' }));
    await waitFor(() => expect(screen.getByPlaceholderText(/Message the agent/)).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: `Delete session ${session.title}` }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining(`Delete "${session.title}"?`));
    await waitFor(() => expect(screen.getByText('Create or select a session to start.')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(`/api/sessions/${session.id}`, expect.objectContaining({ method: 'DELETE' }));
    expect(screen.queryByPlaceholderText(/Message the agent/)).toBeNull();
    expect(screen.queryByRole('button', { name: `Delete session ${session.title}` })).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('keeps the session when deletion is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Home />);
    await userEvent.click(screen.getByRole('button', { name: '+ New session' }));
    await waitFor(() => expect(screen.getByPlaceholderText(/Message the agent/)).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: `Delete session ${session.title}` }));

    expect(fetchMock).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'DELETE' }));
    expect(screen.getByPlaceholderText(/Message the agent/)).toBeTruthy();
  });

  it('shows an error banner when creating a session fails, instead of an unhandled rejection', async () => {
    fetchMock.mockImplementationOnce(async () => Response.json({ sessions: [], providers: { openai: true, google: false } }));
    render(<Home />);
    fetchMock.mockImplementationOnce(async () => new Response('db locked', { status: 500 }));

    await userEvent.click(screen.getByRole('button', { name: '+ New session' }));

    await waitFor(() => expect(screen.getByText(/POST \/api\/sessions failed: 500 db locked/)).toBeTruthy());
    expect(screen.getByText('Create or select a session to start.')).toBeTruthy();
  });

  it('renders assistant replies as markdown but keeps user text and raw HTML literal', async () => {
    window.history.replaceState(null, '', `/?s=${session.id}`);
    const withMessages: SessionState = {
      ...sessionState,
      messages: [
        { id: 'u1', seq: 1, role: 'user', parts: [{ type: 'text', text: 'I said **this**' }], compacted: false, createdAt: 'x' },
        { id: 'a1', seq: 2, role: 'assistant', parts: [{ type: 'text', text: '**Plan**\n\n- Venue\n- Agenda <img src=x onerror=alert(1)>' }], compacted: false, createdAt: 'x' },
      ],
    };
    fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
      String(input) === `/api/sessions/${session.id}`
        ? Response.json(withMessages)
        : String(input) === '/api/memories'
          ? Response.json([])
          : Response.json({ sessions: [session], providers: { openai: true, google: false } }),
    );

    const { container } = render(<Home />);

    await waitFor(() => expect(container.querySelector('.msg.assistant strong')?.textContent).toBe('Plan'));
    expect(container.querySelectorAll('.msg.assistant li')).toHaveLength(2);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('I said **this**')).toBeTruthy();
  });
});
