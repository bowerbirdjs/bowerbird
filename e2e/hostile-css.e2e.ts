import { describe, expect, test } from 'vitest';
import { apps, useBrowser } from './browser.js';

// Properties the hostile page sets on elements; content must compute the same with and without it.
const PROPS = [
  'color',
  'font-family',
  'font-size',
  'line-height',
  'letter-spacing',
  'text-transform',
  'text-decoration-style',
  'margin-top',
  'margin-left',
  'padding-top',
  'border-top-style',
  'background-color',
  'box-sizing',
  'list-style-type',
  'border-radius',
] as const;

describe.skipIf(!apps)('hostile host CSS', () => {
  const open = useBrowser();

  async function snapshot(url: string) {
    const { page, errors } = await open(url);
    await page.locator('[data-bb-node="cta-1"]').waitFor();
    const styles = await page.locator('[data-bb-canvas] .bb-page').evaluate((root, props) => {
      const out: Record<string, Record<string, string>> = {};
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const id = el.getAttribute('data-bb-node');
        if (!id) continue;
        const cs = getComputedStyle(el);
        out[id] = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
      }
      return out;
    }, PROPS);
    const chrome = await page
      .locator('.bbx-overlay')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    return { styles, chrome, errors };
  }

  test('host element styles do not reach page content or canvas chrome', async () => {
    const base = apps?.hostile ?? '';
    const clean = await snapshot(`${base}?clean`);
    const hostile = await snapshot(base);
    expect(Object.keys(hostile.styles).length).toBeGreaterThan(20);
    const diffs: string[] = [];
    for (const [id, props] of Object.entries(clean.styles)) {
      for (const [prop, value] of Object.entries(props)) {
        const got = hostile.styles[id]?.[prop];
        if (got !== value) diffs.push(`${id} ${prop}: ${value} → ${got}`);
      }
    }
    expect(diffs).toEqual([]);
    expect(hostile.chrome).toBe('rgba(0, 0, 0, 0)');
    expect([...clean.errors, ...hostile.errors]).toEqual([]);
  });
});
