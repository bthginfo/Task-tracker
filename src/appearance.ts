type AccentTokens = { accent: string; text: string; ink: string; soft: string; softHover: string; hover: string };
type AccentPalette = { id: string; label: string; dark: AccentTokens; light: AccentTokens };

export const accentPalettes = [
  { id: 'sage', label: 'Salbei',
    dark: { accent: '#c0dbae', text: '#c0dbae', ink: '#23311b', soft: '#283225', softHover: '#323e2d', hover: '#cee6bf' },
    light: { accent: '#bcd6a9', text: '#4b7135', ink: '#26361e', soft: '#e4eddc', softHover: '#d9e7ce', hover: '#b0cc9b' } },
  { id: 'blue', label: 'Blau',
    dark: { accent: '#a9c7ef', text: '#a9c7ef', ink: '#1c304c', soft: '#243044', softHover: '#2d3b52', hover: '#bfd7f7' },
    light: { accent: '#bad2f2', text: '#305e91', ink: '#203a5c', soft: '#e5edf8', softHover: '#d7e4f5', hover: '#acc7eb' } },
  { id: 'violet', label: 'Violett',
    dark: { accent: '#c9b8ec', text: '#c9b8ec', ink: '#34244d', soft: '#30283f', softHover: '#3c3250', hover: '#d9caf5' },
    light: { accent: '#d4c4ee', text: '#6a4696', ink: '#3a2854', soft: '#efe8f8', softHover: '#e5d9f3', hover: '#c7b3e7' } },
  { id: 'rose', label: 'Rosé',
    dark: { accent: '#e9b8cd', text: '#e9b8cd', ink: '#482636', soft: '#3e2933', softHover: '#4c333f', hover: '#f3cadd' },
    light: { accent: '#edc4d4', text: '#954967', ink: '#4b2938', soft: '#f7e8ee', softHover: '#f1dae4', hover: '#e7b4c9' } },
  { id: 'apricot', label: 'Apricot',
    dark: { accent: '#ecc5a6', text: '#ecc5a6', ink: '#493022', soft: '#3a2e26', softHover: '#49392d', hover: '#f3d5bd' },
    light: { accent: '#edc7a9', text: '#925226', ink: '#4c3120', soft: '#f8ecdf', softHover: '#f3e1cc', hover: '#e6b994' } },
  { id: 'teal', label: 'Türkis',
    dark: { accent: '#a3d7cc', text: '#a3d7cc', ink: '#1c3932', soft: '#233730', softHover: '#2b443c', hover: '#bbe7dd' },
    light: { accent: '#b5ddd2', text: '#326f5c', ink: '#224438', soft: '#e2f0e9', softHover: '#d2e7dc', hover: '#a3d1c3' } },
] as const satisfies readonly AccentPalette[];

export type AccentId = typeof accentPalettes[number]['id'];
const storageKey = 'fokus-accent-v1';

export function readAccent(): AccentId {
  try { const stored = localStorage.getItem(storageKey); return accentPalettes.find(palette => palette.id === stored)?.id || 'sage'; }
  catch { return 'sage'; }
}

export function applyAccent(id: AccentId, theme: string) {
  const palette = accentPalettes.find(item => item.id === id) || accentPalettes[0];
  const tokens = theme === 'light' ? palette.light : palette.dark;
  const properties: Record<keyof AccentTokens, string> = { accent: '--accent', text: '--accent-text', ink: '--accent-ink', soft: '--accent-soft', softHover: '--accent-soft-hover', hover: '--accent-hover' };
  for (const key of Object.keys(properties) as (keyof AccentTokens)[]) document.documentElement.style.setProperty(properties[key], tokens[key]);
  document.documentElement.dataset.accent = palette.id;
  try { localStorage.setItem(storageKey, palette.id); } catch { /* unavailable browser storage must not block appearance changes */ }
}
