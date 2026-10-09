// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from '@/lib/theme';
import { ThemeToggle } from './ThemeToggle';

const html = document.documentElement;
/** Run the <head> script the way the browser would, with a given OS preference. */
const runInitScript = (prefersDark: boolean) => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: prefersDark && q.includes('dark') }));
  new Function(THEME_INIT_SCRIPT)();
};

beforeEach(() => {
  localStorage.clear();
  html.dataset.theme = 'light';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('theme init script', () => {
  it('follows the OS preference when nothing is saved', () => {
    runInitScript(true);
    expect(html.dataset.theme).toBe('dark');
    runInitScript(false);
    expect(html.dataset.theme).toBe('light');
  });

  it('prefers the saved choice and ignores invalid saved values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    runInitScript(true);
    expect(html.dataset.theme).toBe('light');

    localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    runInitScript(true);
    expect(html.dataset.theme).toBe('dark');
  });

  it('does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => runInitScript(true)).not.toThrow();
  });
});

describe('ThemeToggle', () => {
  it('toggles between light and dark and remembers the choice', async () => {
    render(<ThemeToggle />);
    const button = await screen.findByRole('button', { name: 'Switch to dark mode' });

    await userEvent.click(button);
    expect(html.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeTruthy();

    await userEvent.click(button);
    expect(html.dataset.theme).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('starts from the theme the init script already applied', async () => {
    html.dataset.theme = 'dark';
    render(<ThemeToggle />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeTruthy());
  });

  it('still switches the theme when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    render(<ThemeToggle />);
    await userEvent.click(await screen.findByRole('button', { name: 'Switch to dark mode' }));
    expect(html.dataset.theme).toBe('dark');
  });
});
