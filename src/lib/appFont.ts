export interface FontOption {
  id: string;
  label: string;
  stack: string;
}

export const FONT_FAMILIES: FontOption[] = [
  { id: 'system', label: 'System default', stack: `-apple-system, 'Segoe UI', 'Helvetica Neue', system-ui, sans-serif` },
  { id: 'inter', label: 'Inter', stack: `'Inter', -apple-system, 'Segoe UI', sans-serif` },
  { id: 'segoe', label: 'Segoe UI', stack: `'Segoe UI', -apple-system, system-ui, sans-serif` },
  { id: 'arial', label: 'Arial', stack: `Arial, Helvetica, sans-serif` },
  { id: 'verdana', label: 'Verdana', stack: `Verdana, Geneva, sans-serif` },
  { id: 'georgia', label: 'Georgia (serif)', stack: `Georgia, 'Times New Roman', serif` },
  { id: 'comic', label: 'Comic Sans (fun)', stack: `'Comic Sans MS', 'Comic Sans', 'Chalkboard SE', 'Comic Neue', cursive` },
  { id: 'mono', label: 'Cascadia Code (mono)', stack: `'Cascadia Code', Consolas, 'Courier New', monospace` },
];

export const SIZE_MIN = 70;
export const SIZE_MAX = 200;
export const SIZE_DEFAULT = 100;

const FAMILY_KEY = 'brian-font-family';
// Unified with the chat panel's keyboard zoom (Ctrl +/-) so changes from either
// place stay in sync. Stored as a multiplier (e.g. "1.2") not a percent.
const SIZE_KEY = 'brian-chat-zoom';

export function getStoredFamilyId(): string {
  return localStorage.getItem(FAMILY_KEY) || 'system';
}

export function getStoredSizePercent(): number {
  const raw = parseFloat(localStorage.getItem(SIZE_KEY) || '');
  if (!Number.isFinite(raw)) return SIZE_DEFAULT;
  return clampSizePercent(Math.round(raw * 100));
}

export function setStoredFamilyId(id: string) {
  localStorage.setItem(FAMILY_KEY, id);
}

export function setStoredSizePercent(percent: number) {
  const clamped = clampSizePercent(percent);
  localStorage.setItem(SIZE_KEY, String(clamped / 100));
}

export function clampSizePercent(p: number): number {
  if (!Number.isFinite(p)) return SIZE_DEFAULT;
  return Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(p)));
}

export function resolveFamily(id: string): FontOption {
  return FONT_FAMILIES.find(f => f.id === id) || FONT_FAMILIES[0];
}

export function applyAppFont(familyId?: string, sizePercent?: number) {
  const fam = resolveFamily(familyId ?? getStoredFamilyId());
  const pct = clampSizePercent(sizePercent ?? getStoredSizePercent());
  document.documentElement.style.setProperty('--app-font-family', fam.stack);
  // Chat-only scaling: drives the existing `--chat-zoom` CSS var that the
  // chat bubble styles consume. Avoids body{zoom} which broke layout/scrolling.
  document.documentElement.style.setProperty('--chat-zoom', String(pct / 100));
  // Clear any stale body-zoom from a previous build that scaled the whole UI.
  document.body.style.removeProperty('zoom');
  // Notify in-tab listeners (storage events don't fire in the originating tab).
  try {
    window.dispatchEvent(new CustomEvent('brian:font-changed', { detail: { familyId: fam.id, sizePercent: pct } }));
  } catch {}
}
