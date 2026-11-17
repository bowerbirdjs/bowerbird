/** Horizontal padding that centres content within `--size-content` without a wrapper element. */
export const GUTTER = 'padding-inline: max(var(--space-lg), (100% - var(--size-content)) / 2);';

/** Muted text that adapts to whatever colour the section uses. */
export const MUTED = 'color: color-mix(in srgb, currentColor 70%, transparent);';

export function primaryButton(selector: string): string {
  return `${selector} {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--space-xs);
  padding: var(--space-sm) var(--space-lg); border-radius: var(--radius-md);
  background: var(--color-accent); color: var(--color-on-accent);
  font-size: var(--text-sm); font-weight: var(--weight-semibold); text-decoration: none;
  transition: background-color 0.15s ease;
}
${selector}:hover { background: var(--color-accent-hover); }`;
}

export function secondaryButton(selector: string): string {
  return `${selector} {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--space-xs);
  padding: var(--space-sm) var(--space-lg); border-radius: var(--radius-md);
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent); color: inherit;
  font-size: var(--text-sm); font-weight: var(--weight-semibold); text-decoration: none;
  transition: background-color 0.15s ease;
}
${selector}:hover { background: color-mix(in srgb, currentColor 8%, transparent); }`;
}

/** A soft illustrated placeholder for media slots (inline SVG, no network needed). */
export const PLACEHOLDER_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 600'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%23e0e7ff'/%3E%3Cstop offset='1' stop-color='%23c7d2fe'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='800' height='600' fill='url(%23g)'/%3E%3Crect x='80' y='90' width='640' height='420' rx='24' fill='%23fff' opacity='.9'/%3E%3Crect x='120' y='140' width='240' height='28' rx='8' fill='%234f46e5'/%3E%3Crect x='120' y='190' width='420' height='16' rx='8' fill='%23c7d2fe'/%3E%3Crect x='120' y='222' width='360' height='16' rx='8' fill='%23c7d2fe'/%3E%3Crect x='120' y='290' width='260' height='170' rx='16' fill='%23eef2ff'/%3E%3Crect x='410' y='290' width='270' height='170' rx='16' fill='%23e0e7ff'/%3E%3C/svg%3E";
