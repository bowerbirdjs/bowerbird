import type { Page } from 'playwright';
import { describe, expect, test } from 'vitest';
import { apps, useBrowser } from './browser.js';

const prop = (page: Page, id: string, key: string) =>
  page.evaluate(
    ([i, k]) => document.querySelector('bowerbird-editor')!.store!.doc.nodes[i!]?.props[k!],
    [id, key],
  );

describe.skipIf(!apps)('code components drawn by the host (React)', () => {
  const open = useBrowser();

  test('they render inside the app, styled by the site CSS on the page root', async () => {
    const { page, errors } = await open(apps?.reactHost ?? '');
    const spring = page.locator('[data-bb-canvas] [data-testid="promo-spring"]');
    await spring.waitFor();
    expect(await page.locator('[data-bb-canvas] .promo').count()).toBe(2);
    // App context reaches the component (the provider sits above the editor).
    expect(await spring.getByTestId('currency').textContent()).toBe('CHF');
    // The page root carries the host's attributes, so its scoped CSS and custom properties apply.
    const root = page.locator('[data-bb-canvas] .bb-page');
    expect(await root.getAttribute('data-shop')).toBe('');
    expect(await root.getAttribute('lang')).toBe('de');
    expect(await spring.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(15, 118, 110)',
    );
    // Links and buttons in host markup are content: out of the Tab order.
    const tabbable = await page
      .locator('[data-bb-canvas] .promo a, [data-bb-canvas] .promo button')
      .evaluateAll((els) => els.filter((e) => (e as HTMLElement).tabIndex >= 0).length);
    expect(tabbable).toBe(0);
    expect(errors).toEqual([]);
  });

  test('their state survives changes to the page, and moves go through the editor', async () => {
    const { page, editor, errors } = await open(apps?.reactHost ?? '');
    const spring = page.locator('[data-bb-canvas] [data-testid="promo-spring"]');
    await spring.waitFor();
    await spring.getByTestId('like').click();
    await spring.getByTestId('like').click();
    expect(await spring.getByTestId('like').textContent()).toBe('Gefällt 2');
    // Another component changes: the page re-renders, this one keeps its state.
    await page.evaluate(() =>
      document
        .querySelector('bowerbird-editor')!
        .apply([{ op: 'props.set', id: 'summer', props: { heading: 'Herbst' } }]),
    );
    await expect
      .poll(() => page.locator('[data-testid="promo-summer"] h2').textContent())
      .toBe('Herbst');
    expect(await spring.getByTestId('like').textContent()).toBe('Gefällt 2');
    // The selected component moves with the editor's toolbar, in the host's words.
    await page.locator('[data-testid="promo-summer"] h2').click();
    await expect.poll(() => page.locator('.bbx-label').textContent()).toBe('Aktion');
    // Right under the page root there is no parent to select.
    const titles = await page
      .locator('.bbx-toolbar button')
      .evaluateAll((bs) => bs.filter((b) => !(b as HTMLElement).hidden).map((b) => b.title));
    expect(titles).toEqual(['Ziehen zum Verschieben', 'Nach oben', 'Duplizieren', 'Löschen']);
    await page.getByRole('button', { name: 'Nach oben' }).click();
    await expect
      .poll(() =>
        page
          .locator('[data-bb-canvas] .promo')
          .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid'))),
      )
      .toEqual(['promo-summer', 'promo-spring']);
    expect(await spring.getByTestId('like').textContent()).toBe('Gefällt 2');
    expect(await editor.evaluate((el) => (el as HTMLElement).hasAttribute('host-components'))).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });

  test('text marked with a prop is edited on the page and stored on the node', async () => {
    const { page, errors } = await open(apps?.reactHost ?? '');
    const heading = page.locator('[data-testid="promo-spring"] h2');
    await heading.waitFor();
    await heading.dblclick();
    await expect.poll(() => heading.getAttribute('contenteditable')).not.toBeNull();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Osterangebot');
    await page.keyboard.press('Enter');
    await expect.poll(() => prop(page, 'spring', 'heading')).toBe('Osterangebot');
    // React draws the stored value into a fresh mount: no leftover editing state.
    const fresh = page.locator('[data-testid="promo-spring"] h2');
    await expect.poll(() => fresh.textContent()).toBe('Osterangebot');
    expect(await fresh.getAttribute('contenteditable')).toBeNull();
    // An optional multi-line prop, and undo puts it back.
    const body = page.locator('[data-testid="promo-spring"] p').first();
    await body.dblclick();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Nur diese Woche');
    await page.keyboard.press('Control+Enter');
    await expect.poll(() => prop(page, 'spring', 'body')).toBe('Nur diese Woche');
    await page.evaluate(() => document.querySelector('bowerbird-editor')!.undo());
    await expect.poll(() => prop(page, 'spring', 'body')).toBe('Zwei zum Preis von einem.');
    await expect.poll(() => body.textContent()).toBe('Zwei zum Preis von einem.');
    // A required prop can't be emptied.
    await page.locator('[data-testid="promo-spring"] h2').dblclick();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.locator('[data-testid="promo-spring"] h2').textContent())
      .toBe('Osterangebot');
    expect(await prop(page, 'spring', 'heading')).toBe('Osterangebot');
    expect(errors).toEqual([]);
  });
});
