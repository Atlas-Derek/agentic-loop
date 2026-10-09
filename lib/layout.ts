/**
 * Resizable side panels. Client-safe (no server imports).
 *
 * Widths live in CSS variables on <html> (--left-w / --right-w), which the .app grid reads.
 * Saved widths are applied by LAYOUT_INIT_SCRIPT in <head> before first paint, so the layout
 * never jumps on load. With nothing saved, the defaults in app/globals.css apply.
 */
export type PanelSide = 'left' | 'right';

/** Pixel limits for dragging/keyboard. The CSS grid also caps each side by viewport width. */
export const PANEL_LIMITS = {
  left: { min: 200, max: 420, fallback: 264 },
  right: { min: 280, max: 640, fallback: 360 },
} as const;

const cssVar = (side: PanelSide): string => (side === 'left' ? '--left-w' : '--right-w');
export const panelStorageKey = (side: PanelSide): string => `panel-width:${side}`;

export const LAYOUT_INIT_SCRIPT = `(function(){try{var l=${JSON.stringify(PANEL_LIMITS)};["left","right"].forEach(function(s){var v=Number(localStorage.getItem("panel-width:"+s));if(v>=l[s].min&&v<=l[s].max)document.documentElement.style.setProperty(s==="left"?"--left-w":"--right-w",v+"px")})}catch(e){}})()`;

export function clampPanelWidth(side: PanelSide, width: number): number {
  const { min, max } = PANEL_LIMITS[side];
  return Math.round(Math.min(max, Math.max(min, width)));
}

/** Apply a width (clamped) and optionally remember it. Returns the width actually applied. */
export function setPanelWidth(side: PanelSide, width: number, persist: boolean): number {
  const applied = clampPanelWidth(side, width);
  document.documentElement.style.setProperty(cssVar(side), `${applied}px`);
  if (persist) {
    try {
      localStorage.setItem(panelStorageKey(side), String(applied));
    } catch {
      // Storage unavailable: the width still applies for this page view.
    }
  }
  return applied;
}

/** Forget a custom width and fall back to the stylesheet default. */
export function resetPanelWidth(side: PanelSide): void {
  document.documentElement.style.removeProperty(cssVar(side));
  try {
    localStorage.removeItem(panelStorageKey(side));
  } catch {
    // Storage unavailable: nothing was saved.
  }
}
