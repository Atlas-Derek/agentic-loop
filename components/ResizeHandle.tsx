'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { PANEL_LIMITS, resetPanelWidth, setPanelWidth, type PanelSide } from '@/lib/layout';

const STEP = 16;
const BIG_STEP = 64;

/**
 * Drag handle between a side panel and the chat. Rendered as its own zero-width grid column so it
 * always sits exactly on the panel border. Drag (mouse/touch/pen), arrow keys (Shift = bigger
 * steps), or double-click to reset to the default width.
 */
export function ResizeHandle({ side }: { side: PanelSide }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const widthRef = useRef<number>(PANEL_LIMITS[side].fallback);
  const [width, setWidth] = useState<number | null>(null);
  const [active, setActive] = useState(false);
  const { min, max } = PANEL_LIMITS[side];

  /** Current rendered width of the panel this handle controls (its neighbour in the grid). */
  const measure = (): number => {
    const panel = side === 'left' ? ref.current?.previousElementSibling : ref.current?.nextElementSibling;
    const w = panel?.getBoundingClientRect().width ?? 0;
    return w > 0 ? Math.round(w) : PANEL_LIMITS[side].fallback;
  };

  const update = (w: number, persist: boolean) => {
    widthRef.current = setPanelWidth(side, w, persist);
    setWidth(widthRef.current);
  };

  useEffect(() => {
    widthRef.current = measure();
    setWidth(widthRef.current);
    // If the component unmounts mid-drag, don't leave the page stuck in "resizing" mode.
    return () => {
      document.body.classList.remove('resizing');
    };
  }, []); // measure once on mount

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragging.current = true;
    widthRef.current = measure();
    setActive(true);
    document.body.classList.add('resizing');
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    // The left panel starts at x=0; the right panel ends at the viewport's right edge.
    update(side === 'left' ? e.clientX : document.documentElement.clientWidth - e.clientX, false);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setActive(false);
    document.body.classList.remove('resizing');
    update(widthRef.current, true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const step = e.shiftKey ? BIG_STEP : STEP;
    // Moving the border right widens the left panel and narrows the right one.
    const direction = (e.key === 'ArrowRight' ? 1 : -1) * (side === 'left' ? 1 : -1);
    update(measure() + direction * step, true);
  };

  const onDoubleClick = () => {
    resetPanelWidth(side);
    widthRef.current = measure();
    setWidth(widthRef.current);
  };

  const label = side === 'left' ? 'Resize sessions sidebar' : 'Resize inspector sidebar';
  return (
    <div
      ref={ref}
      className={`resize-handle ${active ? 'active' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width ?? undefined}
      tabIndex={0}
      title={`${label} (double-click to reset)`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
    />
  );
}
