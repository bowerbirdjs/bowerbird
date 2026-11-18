import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createStore } from '@bowerbirdjs/core';
import { renderDocument } from '@bowerbirdjs/html';
import type { Page } from 'playwright';
import { describe, expect, test } from 'vitest';
import { PAGE_OPS } from '../examples/hostile-css/page.js';
import { apps, useBrowser } from './browser.js';

// Computed properties compared node by node. Inherited ones catch leaks from host ancestors.
const PROPS = [
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-transform',
  'text-align',
  'text-decoration-style',
  'margin-top',
  'margin-left',
  'padding-top',
  'padding-left',
  'border-top-style',
  'background-color',
  'box-sizing',
  'display',
  'justify-content',
  'list-style-type',
  'border-radius',
  'opacity',
  'filter',
] as const;

type Styles = Record<string, Record<string, string>>;

function collect(page: Page, rootSelector: string): Promise<Styles> {
  return page.locator(rootSelector).evaluate((root, props) => {
    const out: Record<string, Record<string, string>> = {};
    for (const el of [root, ...root.querySelectorAll('*')]) {
      const id = el.getAttribute('data-bb-node');
      if (!id) continue;
      const cs = getComputedStyle(el);
      const after = getComputedStyle(el, '::after').content;
      out[id] = {
        ...Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)])),
        '::after content': after,
      };
    }
    return out;
  }, PROPS);
}

function diff(expected: Styles, actual: Styles): string[] {
  const out: string[] = [];
  for (const [id, props] of Object.entries(expected)) {
    if (!actual[id]) {
      out.push(`${id}: missing`);
      continue;
    }
    for (const [prop, value] of Object.entries(props)) {
      const got = actual[id][prop];
      if (got !== value) out.push(`${id} ${prop}: ${value} → ${got}`);
    }
  }
  return out;
}

describe.skipIf(!apps)('hostile host CSS', () => {
  const open = useBrowser();
  const base = apps?.hostile ?? '';

  async function editorStyles(url: string) {
    const { page, errors, editor } = await open(url, { width: 1600, height: 1000 });
    await page.locator('[data-bb-node="cta-1"]').waitFor();
    return { page, errors, editor, styles: await collect(page, '[data-bb-canvas] .bb-page') };
  }

  test('host styles do not reach page content', async () => {
    const clean = await editorStyles(`${base}?clean`);
    const hostile = await editorStyles(base);
    expect(Object.keys(hostile.styles).length).toBeGreaterThan(20);
    expect(diff(clean.styles, hostile.styles)).toEqual([]);
    expect([...clean.errors, ...hostile.errors]).toEqual([]);
  });

  test('the editor shows what gets published (same computed styles)', async () => {
    const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
    store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
    const res = store.apply({ ops: PAGE_OPS });
    expect(res.ok).toBe(true);
    const html = renderDocument(store.doc, store.registry, 'home', { nodeIds: 'all' });
    const { page } = await open(`${base}?clean`, { width: 1280, height: 900 });
    await page.setContent(html);
    const published = await collect(page, '.bb-page');
    const editor = await editorStyles(base);
    // The desktop preview renders at 1280px, like the published page above.
    expect(
      await editor.page.locator('.bbx-viewport').evaluate((e) => (e as HTMLElement).style.width),
    ).toBe('1280px');
    expect(diff(published, editor.styles)).toEqual([]);
    expect(editor.styles['hero-1/actions']?.['justify-content']).toBe('flex-start');
    // A dark editor keeps the page as it will be published.
    await editor.editor.evaluate((e) => e.setAttribute('appearance', 'dark'));
    const dark = await collect(editor.page, '[data-bb-canvas] .bb-page');
    expect(diff(published, dark)).toEqual([]);
  });

  test('canvas chrome keeps its own styles under host rules', async () => {
    const { page, errors } = await open(base, { width: 1600, height: 1000 });
    await page.locator('[data-bb-node="hero-1/heading"]').click();
    await page.locator('.bbx-select').waitFor();
    const chrome = await page.evaluate(() => {
      const cs = (sel: string) => getComputedStyle(document.querySelector(sel)!);
      return {
        host: [cs('.bbx-host').padding, cs('.bbx-host').backgroundColor, cs('.bbx-host').position],
        select: [cs('.bbx-select').borderTopStyle, cs('.bbx-select').position],
        toolbar: [cs('.bbx-toolbar').backgroundColor, cs('.bbx-toolbar').position],
        overlay: cs('.bbx-overlay').backgroundColor,
      };
    });
    expect(chrome).toEqual({
      host: ['0px', 'rgba(0, 0, 0, 0)', 'absolute'],
      select: ['solid', 'absolute'],
      toolbar: ['rgb(24, 24, 27)', 'absolute'],
      overlay: 'rgba(0, 0, 0, 0)',
    });
    expect(errors).toEqual([]);
  });
});
