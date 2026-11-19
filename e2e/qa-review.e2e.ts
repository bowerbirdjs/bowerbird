import type { Page } from 'playwright';
import { describe, expect, test } from 'vitest';
import { apps, useBrowser } from './browser.js';

/** Runs ops through the editor (as its person). */
const apply = (page: Page, ops: unknown[]) =>
  page.evaluate((o) => document.querySelector('bowerbird-editor')!.apply(o), ops);
const prop = (page: Page, id: string, key: string) =>
  page.evaluate(
    ([i, k]) => document.querySelector('bowerbird-editor')!.store!.doc.nodes[i!]?.props[k!],
    [id, key],
  );

describe.skipIf(!apps)('editor use cases from the QA pass', () => {
  const open = useBrowser();

  test('typing spaces into a button keeps them', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    await editor.getByRole('button', { name: /Hero/ }).first().click();
    await page.locator('[data-bb-node="hero-1/heading"]').click();
    await editor.getByRole('button', { name: 'Button', exact: true }).click();
    const button = page.locator('[data-bb-canvas] button[data-bb-node]');
    await button.waitFor();
    const id = await button.getAttribute('data-bb-node');
    await button.dblclick();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Buy now today');
    await page.keyboard.press('Enter');
    await expect.poll(() => prop(page, id!, 'text')).toBe('Buy now today');
    expect(errors).toEqual([]);
  });

  test('on a phone the panels open over the canvas, one at a time', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '', { width: 390, height: 800 });
    await expect.poll(() => editor.getAttribute('narrow')).toBe('');
    const visible = (sel: string) =>
      editor.evaluate((el, s) => {
        const panel = el.shadowRoot!.querySelector<HTMLElement>(s);
        return !!panel && getComputedStyle(panel).display !== 'none';
      }, sel);
    // Both start closed, so the page is what you see.
    expect(await visible('.left')).toBe(false);
    expect(await visible('.right')).toBe(false);
    expect((await page.locator('.bbx-frame').boundingBox())?.width).toBeGreaterThan(380);
    await editor.getByRole('button', { name: 'Structure panel' }).click();
    expect(await visible('.left')).toBe(true);
    await editor.getByRole('button', { name: 'Inspector panel' }).click();
    expect(await visible('.right')).toBe(true);
    expect(await visible('.left')).toBe(false);
    // Every toolbar control is reachable (the toolbar wraps instead of scrolling).
    const inspector = await editor.getByRole('button', { name: 'Inspector panel' }).boundingBox();
    expect((inspector?.x ?? 999) + (inspector?.width ?? 0)).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
  });

  test('an editor in a narrow column of a wide window keeps its canvas', async () => {
    const { page, editor, errors } = await open(apps?.collab ?? '', { width: 800, height: 800 });
    const editors = page.locator('bowerbird-editor');
    expect(await editors.count()).toBe(2);
    await expect.poll(() => editor.first().getAttribute('narrow')).toBe('');
    const frames = await page
      .locator('.bbx-frame')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    for (const w of frames) expect(w).toBeGreaterThan(300);
    expect(errors).toEqual([]);
  });

  test('host text styles stay out of the panels and canvas chrome', async () => {
    const { page, editor, errors } = await open(apps?.hostile ?? '');
    await page.locator('[data-bb-node="hero-1/heading"]').click();
    const chrome = await editor.evaluate((el) => {
      const root = el.shadowRoot!;
      const style = (e: Element | null) => {
        const s = getComputedStyle(e!);
        return [s.textTransform, s.letterSpacing, s.textAlign, s.lineHeight, s.fontSize];
      };
      return {
        tab: style(root.querySelector('[role="tab"]')),
        field: style(root.querySelector('.field label')),
        label: style(document.querySelector('.bbx-label')),
      };
    });
    expect(chrome.tab.slice(0, 3)).toEqual(['none', 'normal', 'center']);
    expect(chrome.field).toEqual(['none', 'normal', 'start', '17.4px', '12px']);
    expect(chrome.label.slice(0, 2)).toEqual(['none', 'normal']);
    expect(errors).toEqual([]);
  });

  test('the layers tree takes Tab focus on first render', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    await editor.getByRole('button', { name: /Hero/ }).first().click();
    await page.locator('[data-bb-node="hero-1"]').waitFor();
    await page.evaluate(() => document.querySelector('bowerbird-editor')!.select(null));
    await editor.getByRole('tab', { name: 'Layers' }).click();
    expect(await editor.locator('[role="treeitem"][tabindex="0"]').count()).toBe(1);
    await editor.getByRole('tab', { name: 'Layers' }).focus();
    await page.keyboard.press('Tab');
    expect(await editor.evaluate((el) => el.shadowRoot!.activeElement?.getAttribute('role'))).toBe(
      'treeitem',
    );
    expect(errors).toEqual([]);
  });

  test('preview mode can’t change the page structure from the panels either', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    await editor.getByRole('button', { name: /Hero/ }).first().click();
    await page.locator('[data-bb-node="hero-1/heading"]').click();
    await editor.getByRole('button', { name: 'Preview' }).click();
    const inspector = editor.locator('[part="inspector"]');
    await expect.poll(() => inspector.getByRole('button', { name: 'Delete' }).count()).toBe(0);
    await editor.getByRole('tab', { name: 'Insert' }).click();
    expect(await editor.getByText('Leave preview to add content.').isVisible()).toBe(true);
    expect(await editor.getByRole('button', { name: /Pricing tiers/ }).isDisabled()).toBe(true);
    const revision = await page.evaluate(
      () => document.querySelector('bowerbird-editor')!.store!.doc.revision,
    );
    await page.evaluate(() =>
      document.querySelector('bowerbird-editor')!.controller!.insertSection('cta'),
    );
    expect(
      await page.evaluate(() => document.querySelector('bowerbird-editor')!.store!.doc.revision),
    ).toBe(revision);
    expect(errors).toEqual([]);
  });

  test('parts of a linked instance don’t offer moves that always fail', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    await editor.getByRole('button', { name: /Hero/ }).first().click();
    await page.locator('[data-bb-node="hero-1"]').waitFor();
    await apply(page, [{ op: 'symbol.create', id: 'hero-1', name: 'Promo' }]);
    await page.locator('[data-bb-node="hero-1/heading"]').click();
    const inspector = editor.locator('[part="inspector"]');
    await expect.poll(() => inspector.locator('code').first().textContent()).toBe('hero-1/heading');
    expect(await inspector.getByRole('button', { name: 'Delete' }).count()).toBe(0);
    expect(await inspector.getByRole('button', { name: 'Duplicate' }).count()).toBe(0);
    const toolbar = await page
      .locator('.bbx-toolbar button')
      .evaluateAll((bs) => bs.filter((b) => !(b as HTMLElement).hidden).map((b) => b.title));
    expect(toolbar).toEqual(['Select parent']);
    // The instance root itself can still be moved, duplicated and deleted.
    await page.evaluate(() => document.querySelector('bowerbird-editor')!.select('hero-1'));
    await expect.poll(() => inspector.getByRole('button', { name: 'Delete' }).count()).toBe(1);
    expect(errors).toEqual([]);
  });

  test('in another language, labels, override marks and provenance show that language', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    await editor.getByRole('button', { name: /Hero/ }).first().click();
    await page.locator('[data-bb-node="hero-1"]').waitFor();
    await apply(page, [
      { op: 'locale.set', add: ['de'] },
      { op: 'props.set', id: 'hero-1/heading', locale: 'de', props: { text: 'Hallo Welt' } },
      { op: 'symbol.create', id: 'hero-1', name: 'Promo' },
      { op: 'symbol.insert', symbol: 'promo' },
    ]);
    await editor.getByLabel('Language').selectOption('de');
    await page.locator('[data-bb-node="hero-2/heading"]').click();
    const inspector = editor.locator('[part="inspector"]');
    await expect.poll(() => inspector.locator('.node-name').textContent()).toBe('“Hallo Welt”');
    // The instance matches its definition in German too: no override mark.
    expect(await inspector.locator('.override').count()).toBe(0);
    await page.locator('[data-bb-node="hero-1/heading"]').click();
    await expect
      .poll(() => inspector.locator('.provenance').allTextContents())
      .toContainEqual(expect.stringMatching(/text \(de\) last changed by local/));
    expect(errors).toEqual([]);
  });

  test('an empty page in the dark theme is dark, and the toolbar stays above narrow selections', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    await editor.getByLabel('Theme').selectOption('dark');
    await expect
      .poll(() =>
        page.locator('.bbx-viewport').evaluate((v) => getComputedStyle(v).backgroundColor),
      )
      .toBe('rgb(2, 6, 23)');
    await editor.getByLabel('Theme').selectOption('');
    await editor.getByRole('button', { name: /Hero/ }).first().click();
    const primary = page.locator('[data-bb-node="hero-1/primary"]');
    await primary.click();
    await expect.poll(() => page.locator('.bbx-toolbar').isVisible()).toBe(true);
    const sel = await primary.boundingBox();
    const bar = await page.locator('.bbx-toolbar').boundingBox();
    expect((bar?.y ?? 0) + (bar?.height ?? 0)).toBeLessThanOrEqual((sel?.y ?? 0) + 1);
    expect(errors).toEqual([]);
  });

  test('a button dropped on a link goes next to it, never inside', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    await editor.getByRole('button', { name: /Hero/ }).first().click();
    const cta = page.locator('[data-bb-node="hero-1/primary"]');
    await cta.waitFor();
    await editor.getByRole('tab', { name: 'Insert' }).click();
    const box = await cta.boundingBox();
    await editor
      .getByRole('button', { name: 'Button', exact: true })
      .dragTo(cta, { targetPosition: { x: (box?.width ?? 20) / 2, y: (box?.height ?? 10) / 2 } });
    const placed = () =>
      page.evaluate(() => {
        const doc = document.querySelector('bowerbird-editor')!.store!.doc;
        const button = Object.values(doc.nodes).find((n) => n.type === 'button');
        return button ? doc.nodes[button.parent!]?.type : null;
      });
    await expect.poll(placed).toBe('box');
    expect(errors).toEqual([]);
  });

  test('page links don’t take Tab stops, and Delete on an instance part does nothing', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    await editor
      .getByRole('button', { name: /Navigation bar/ })
      .first()
      .click();
    await page.locator('[data-bb-node="nav-1"]').waitFor();
    const tabbable = await page
      .locator('.bbx-content a[href], .bbx-content button')
      .evaluateAll((els) => els.filter((e) => (e as HTMLElement).tabIndex >= 0).length);
    expect(tabbable).toBe(0);
    await apply(page, [{ op: 'symbol.create', id: 'nav-1', name: 'Site nav' }]);
    await page.locator('[data-bb-node="nav-1/brand"]').click();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Control+d');
    expect(await page.locator('[data-bb-node="nav-1/brand"]').count()).toBe(1);
    expect(await editor.locator('[part="toast"]').isHidden()).toBe(true);
    expect(errors).toEqual([]);
  });

  test('other people’s avatars are buttons that show their selection', async () => {
    const { page, errors } = await open(apps?.collab ?? '');
    const ana = page.locator('#ana');
    await expect.poll(() => ana.locator('.peers button').count()).toBe(1);
    expect(await ana.locator('.peers button').getAttribute('aria-label')).toMatch(/^Sam/);
    expect(errors).toEqual([]);
  });
});
