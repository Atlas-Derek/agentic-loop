/**
 * Light/dark theme. Client-safe (no server imports).
 *
 * The active theme is the `data-theme` attribute on <html>. THEME_INIT_SCRIPT runs inline in <head>
 * (app/layout.tsx) before first paint, so a saved or system dark preference never flashes light.
 */
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'theme';

/**
 * Saved choice if valid, otherwise the OS preference. Storage can be blocked, so reading it has its own
 * try/catch: a blocked read must still fall through to the OS preference rather than skip theming.
 */
export const THEME_INIT_SCRIPT = `(function(){var t;try{t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}try{if(t!=="light"&&t!=="dark")t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

export function readTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable (private mode, blocked): the theme still applies for this page view.
  }
}
