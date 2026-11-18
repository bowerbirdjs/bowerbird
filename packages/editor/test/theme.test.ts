import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { CANVAS_CSS } from '../src/canvas.js';
import { iconForType, iconMarkup } from '../src/icons.js';
import { EDITOR_TOKENS, isEditorToken, TOKEN_CSS } from '../src/theme.js';

const source = (file: string) => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
const tokens = Object.keys(EDITOR_TOKENS);

describe('editor tokens', () => {
  test('the CSS only uses tokens from the table, and every token is used', async () => {
    const css = (await Promise.all(['styles.ts', 'canvas.ts', 'field-panel.ts'].map(source))).join(
      '\n',
    );
    const used = new Set([...css.matchAll(/var\(--bbe-([a-z-]+)/g)].map((m) => m[1]!));
    const defaults = Object.values(EDITOR_TOKENS)
      .flatMap((spec) => [spec.value, ...('dark' in spec ? [spec.dark] : [])])
      .join(' ');
    for (const m of defaults.matchAll(/var\(--bbe-([a-z-]+)/g)) used.add(m[1]!);
    expect([...used].filter((name) => !isEditorToken(name))).toEqual([]);
    expect(tokens.filter((name) => !used.has(name))).toEqual([]);
  });

  test('every token gets a default, and the dark and compact variants override only theirs', () => {
    for (const name of tokens)
      expect(TOKEN_CSS).toContain(`--bbe-${name}: var(--bb-editor-${name}, `);
    expect(TOKEN_CSS).toContain(`:host([appearance='dark'])`);
    expect(TOKEN_CSS).toContain(`--bbe-bg: var(--bb-editor-bg, ${EDITOR_TOKENS.bg.dark});`);
    expect(TOKEN_CSS).toContain(`--bbe-space: var(--bb-editor-space, 3px);`);
    // The canvas chrome resolves the same tokens itself (it is light DOM).
    expect(CANVAS_CSS).toContain(`[appearance='dark'] > .bbx-host`);
    expect(CANVAS_CSS).toContain(`--bbe-selection: var(--bb-editor-selection, var(--bbe-accent));`);
  });

  test('chrome colours come from tokens, not from the stylesheets', async () => {
    // White text on peer avatars, whose background is each person's own colour.
    const allowed: Record<string, string[]> = { 'styles.ts': ['#fff'], 'field-panel.ts': [] };
    for (const [file, hexes] of Object.entries(allowed)) {
      const hex = [...(await source(file)).matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => m[0]);
      expect({ file, hex }).toEqual({ file, hex: hexes });
    }
    // The canvas keeps white behind the page (sites paint their own background), the empty-page
    // hint sits on the page and falls back to a slate muted text, and peer tags are white.
    const canvasHex = [
      ...CANVAS_CSS.replace(/var\(--bb-editor-[a-z-]+, [^;]+;/g, '').matchAll(/#[0-9a-f]{3,8}\b/gi),
    ].map((m) => m[0]);
    expect(canvasHex).toEqual(['#fff', '#64748b', '#fff']);
  });

  test('icons are static stroke drawings', () => {
    const svg = iconMarkup('trash');
    expect(svg).toMatch(/^<svg class="bb-icon" viewBox="0 0 24 24"[^>]*aria-hidden="true"/);
    expect(svg).not.toMatch(/fill="currentColor"/);
    expect(iconForType('text', { tag: 'h2' })).toBe('heading');
    expect(iconForType('my-widget')).toBe('blocks');
    expect(iconForType('box', { section: true })).toBe('section');
  });

  test('the README documents every token', async () => {
    const readme = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');
    const section = readme.slice(readme.indexOf('### Make it look like your product'));
    expect(tokens.filter((name) => !section.includes(`\`${name}\``))).toEqual([]);
  });
});
