// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LAYOUT_INIT_SCRIPT, PANEL_LIMITS, panelStorageKey } from '@/lib/layout';
import { ResizeHandle } from './ResizeHandle';

const html = document.documentElement;
const cssWidth = (side: 'left' | 'right') => html.style.getPropertyValue(side === 'left' ? '--left-w' : '--right-w');

beforeEach(() => {
  localStorage.clear();
  html.removeAttribute('style');
  document.body.className = '';
  // jsdom has no layout; give the viewport a width for right-panel drag maths.
  Object.defineProperty(html, 'clientWidth', { configurable: true, value: 1400 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const drag = (handle: HTMLElement, toX: number) => {
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0 });
  expect(document.body.classList.contains('resizing')).toBe(true);
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: toX });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: toX });
  expect(document.body.classList.contains('resizing')).toBe(false);
};

describe('ResizeHandle', () => {
  it('drags the left panel to the pointer position and saves it', () => {
    render(<ResizeHandle side="left" />);
    const handle = screen.getByRole('separator', { name: 'Resize sessions sidebar' });

    drag(handle, 330);

    expect(cssWidth('left')).toBe('330px');
    expect(localStorage.getItem(panelStorageKey('left'))).toBe('330');
    expect(handle.getAttribute('aria-valuenow')).toBe('330');
  });

  it('measures the right panel from the right edge and clamps to its limits', () => {
    render(<ResizeHandle side="right" />);
    const handle = screen.getByRole('separator', { name: 'Resize inspector sidebar' });

    drag(handle, 1000); // 1400 - 1000 = 400
    expect(cssWidth('right')).toBe('400px');

    drag(handle, 100); // 1300 > max
    expect(cssWidth('right')).toBe(`${PANEL_LIMITS.right.max}px`);
    drag(handle, 1390); // 10 < min
    expect(cssWidth('right')).toBe(`${PANEL_LIMITS.right.min}px`);
  });

  it('resizes with arrow keys in the direction the border moves', () => {
    render(
      <>
        <ResizeHandle side="left" />
        <ResizeHandle side="right" />
      </>,
    );
    const [left, right] = screen.getAllByRole('separator');
    // jsdom can't measure panels, so steps start from the fallback widths.
    fireEvent.keyDown(left, { key: 'ArrowRight' });
    expect(cssWidth('left')).toBe(`${PANEL_LIMITS.left.fallback + 16}px`);
    fireEvent.keyDown(right, { key: 'ArrowLeft', shiftKey: true });
    expect(cssWidth('right')).toBe(`${PANEL_LIMITS.right.fallback + 64}px`);
    expect(localStorage.getItem(panelStorageKey('right'))).toBe(String(PANEL_LIMITS.right.fallback + 64));
  });

  it('resets to the stylesheet default on double-click', () => {
    render(<ResizeHandle side="left" />);
    const handle = screen.getByRole('separator');
    drag(handle, 380);

    fireEvent.doubleClick(handle);

    expect(cssWidth('left')).toBe('');
    expect(localStorage.getItem(panelStorageKey('left'))).toBeNull();
  });

  it('ignores non-primary mouse buttons', () => {
    render(<ResizeHandle side="left" />);
    const handle = screen.getByRole('separator');
    fireEvent.pointerDown(handle, { button: 2, pointerId: 1, clientX: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 380 });
    expect(cssWidth('left')).toBe('');
    expect(document.body.classList.contains('resizing')).toBe(false);
  });
});

describe('layout init script', () => {
  it('applies valid saved widths and ignores invalid or out-of-range ones', () => {
    localStorage.setItem(panelStorageKey('left'), '300');
    localStorage.setItem(panelStorageKey('right'), '9999');
    new Function(LAYOUT_INIT_SCRIPT)();
    expect(cssWidth('left')).toBe('300px');
    expect(cssWidth('right')).toBe('');

    html.removeAttribute('style');
    localStorage.setItem(panelStorageKey('left'), 'wide');
    new Function(LAYOUT_INIT_SCRIPT)();
    expect(cssWidth('left')).toBe('');
  });

  it('does not throw when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => new Function(LAYOUT_INIT_SCRIPT)()).not.toThrow();
  });
});
