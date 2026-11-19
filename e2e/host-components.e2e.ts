import type { Page } from 'playwright';
import { describe, expect, test } from 'vitest';
import { apps, useBrowser } from './browser.js';

const prop = (page: Page, id: string, key: string) =>
  page.evaluate(
    ([i, k]) => document.querySelector('bowerbird-editor')!.store!.doc.nodes[i!]?.props[k!],
    [id, key],
  );
const order = (page: Page) =>
  page
    .locator('[data-bb-canvas] .promo')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));

describe.skipIf(!apps)('code components drawn by the host (React)', () => {
  const open = useBrowser();

  test('they render inside the app, in a page frame the site CSS reaches', async () => {
    const { page, errors } = await open(apps?.reactHost ?? '');
    const spring = page.locator('[data-bb-canvas] [data-testid="promo-spring"]');
    await spring.waitFor();
    expect(await page.locator('[data-bb-canvas] .promo').count()).toBe(2);
    // App context reaches the component (the provider sits above the editor).
    expect(await spring.getByTestId('currency').textContent()).toBe('CHF');
    // The host's attributes are on the frame inside the page root, not on the root itself.
    const frame = page.locator('[data-bb-canvas] .bb-page > [data-bb-frame]');
    expect(await frame.getAttribute('data-shop')).toBe('');
    expect(await frame.getAttribute('lang')).toBe('de');
    expect(await page.locator('[data-bb-canvas] .bb-page').getAttribute('data-shop')).toBeNull();
    expect(await spring.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      'rgb(15, 118, 110)',
    );
    // The editor's base styles leave host markup alone: the host's own heading margin applies.
    expect(await spring.locator('h2').evaluate((el) => getComputedStyle(el).marginBottom)).toBe(
      '8px',
    );
    // The page-start slot holds the host's menu, first in the frame, not selectable.
    const nav = frame.locator('.shop-nav');
    expect(await nav.count()).toBe(1);
    // Styled by the host's CSS, untouched by the editor's resets.
    expect(await nav.evaluate((el) => getComputedStyle(el).display)).toBe('flex');
    await nav.getByText('Shop').click();
    expect(await page.locator('.bbx-label').isVisible()).toBe(false);
    // Links and buttons in host markup are content: out of the Tab order.
    const tabbable = await page
      .locator('[data-bb-canvas] .promo a, [data-bb-canvas] .promo button, [data-bb-canvas] nav a')
      .evaluateAll((els) => els.filter((e) => (e as HTMLElement).tabIndex >= 0).length);
    expect(tabbable).toBe(0);
    expect(errors).toEqual([]);
  });

  test('no click opens a link on the page', async () => {
    const { page, errors } = await open(apps?.reactHost ?? '');
    await page.locator('[data-bb-canvas] .promo').first().waitFor();
    const opened: string[] = [];
    page.context().on('page', (p) => opened.push(p.url()));
    const start = page.url();
    for (const link of [
      page.locator('[data-bb-canvas] .shop-nav a', { hasText: 'Kontakt' }),
      page.locator('[data-bb-canvas] .promo a').first(),
    ]) {
      await link.click();
      await link.click({ modifiers: ['ControlOrMeta'] });
      await link.click({ button: 'middle' });
      await link.dblclick();
    }
    await page.waitForTimeout(300);
    expect(opened).toEqual([]);
    expect(page.url()).toBe(start);
    expect(errors).toEqual([]);
  });

  test('their state survives changes to the page; the toolbar and its grip move them', async () => {
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
    await expect.poll(() => order(page)).toEqual(['promo-summer', 'promo-spring']);
    expect(await spring.getByTestId('like').textContent()).toBe('Gefällt 2');
    // And by dragging the toolbar's grip below the other card.
    const target = await spring.boundingBox();
    await page.locator('.bbx-toolbar button[data-action="drag"]').dragTo(spring, {
      targetPosition: { x: (target?.width ?? 300) - 40, y: (target?.height ?? 100) - 10 },
    });
    await expect.poll(() => order(page)).toEqual(['promo-spring', 'promo-summer']);
    expect(await spring.getByTestId('like').textContent()).toBe('Gefällt 2');
    expect(await editor.evaluate((el) => (el as HTMLElement).hasAttribute('host-components'))).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });

  test('children the host draws: added by dragging from the app, selected and edited', async () => {
    const { page, errors } = await open(apps?.reactHost ?? '');
    const spring = page.locator('[data-bb-canvas] [data-testid="promo-spring"]');
    await spring.waitFor();
    await page.getByText('Hinweis ziehen').dragTo(spring.locator('h2'));
    const badge = spring.locator('.badge');
    await expect.poll(() => badge.count()).toBe(1);
    // Drawn once, by the host (the editor renders no copy of it).
    expect(await page.locator('[data-bb-canvas] promo-badge').count()).toBe(0);
    const id = await badge.getAttribute('data-bb-node');
    expect(
      await page.evaluate(
        (i) => document.querySelector('bowerbird-editor')!.store!.doc.nodes[i!]?.parent,
        id,
      ),
    ).toBe('spring');
    await expect.poll(() => page.locator('.bbx-label').textContent()).toBe('Hinweis');
    await badge.dblclick();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Bald vorbei');
    await page.keyboard.press('Enter');
    await expect.poll(() => prop(page, id!, 'text')).toBe('Bald vorbei');
    await expect.poll(() => spring.locator('.badge').textContent()).toBe('Bald vorbei');
    // Undo takes the badge's text back, and then the badge.
    await page.evaluate(() => document.querySelector('bowerbird-editor')!.undo());
    await expect.poll(() => spring.locator('.badge').textContent()).toBe('Neu');
    await page.evaluate(() => document.querySelector('bowerbird-editor')!.undo());
    await expect.poll(() => spring.locator('.badge').count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test('text marked with a prop is edited on the page, without the styling’s capitals', async () => {
    const { page, errors } = await open(apps?.reactHost ?? '');
    const heading = page.locator('[data-testid="promo-spring"] h2');
    await heading.waitFor();
    // The heading is set in capitals by CSS; what is stored is what was typed.
    expect(await heading.evaluate((el) => getComputedStyle(el).textTransform)).toBe('uppercase');
    await heading.dblclick();
    await expect.poll(() => heading.getAttribute('contenteditable')).not.toBeNull();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Osterangebot');
    await page.keyboard.press('Enter');
    await expect.poll(() => prop(page, 'spring', 'heading')).toBe('Osterangebot');
    // React draws the stored value into a fresh mount: no leftover editing state.
    const fresh = page.locator('[data-testid="promo-spring"] h2');
    await expect.poll(() => fresh.textContent()).toBe('Osterangebot');
    expect(await fresh.getAttribute('contenteditable')).toBeNull();
    // Paragraphs are edited in place too; a blank line starts a new one.
    const body = page.locator('[data-testid="promo-spring"] div[data-bb-edit]');
    await body.locator('p').first().dblclick();
    await expect.poll(() => body.getAttribute('contenteditable')).not.toBeNull();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Nur diese Woche');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Solange der Vorrat reicht');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect
      .poll(() => prop(page, 'spring', 'body'))
      .toBe('Nur diese Woche\n\nSolange der Vorrat reicht');
    await expect
      .poll(() => page.locator('[data-testid="promo-spring"] div[data-bb-edit] p').count())
      .toBe(2);
    await page.evaluate(() => document.querySelector('bowerbird-editor')!.undo());
    await expect
      .poll(() => prop(page, 'spring', 'body'))
      .toBe('Zwei zum Preis von einem.\n\nNur im April.');
    // A required prop can't be emptied.
    await page.locator('[data-testid="promo-spring"] h2').dblclick();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.locator('[data-testid="promo-spring"] h2').textContent())
      .toBe('Osterangebot');
    expect(await prop(page, 'spring', 'heading')).toBe('Osterangebot');
    expect(errors).toEqual([]);
  });
});
