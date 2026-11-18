import { describe, expect, test } from 'vitest';
import { apps, useBrowser } from './browser.js';

describe.skipIf(!apps)('plain HTML example', () => {
  const open = useBrowser();
  const url = apps?.vanilla ?? '';

  test('insert, drag, edit in the inspector and inline, undo, delete', async () => {
    const { page, editor, errors } = await open(url);
    const status = page.locator('#status');
    const heading = page.locator('[data-bb-node="hero-1/heading"]');

    // Click an Insert card: the section lands on the empty page and is selected.
    await editor.getByRole('button', { name: /Hero/ }).first().click();
    await heading.waitFor();
    await expect.poll(() => page.locator('.bbx-label').textContent()).toContain('hero');
    await expect.poll(() => status.textContent()).toBe('revision 2');

    // Drag a section card below the hero.
    const hero = page.locator('[data-bb-node="hero-1"]');
    const box = await hero.boundingBox();
    if (!box) throw new Error('hero has no box');
    await editor
      .getByRole('button', { name: /Pricing tiers/ })
      .dragTo(hero, { targetPosition: { x: box.width / 2, y: box.height - 5 } });
    const sections = () =>
      page
        .locator('[data-bb-canvas] [data-bb-section]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-bb-node')));
    await expect.poll(sections).toEqual(['hero-1', 'pricing-1']);

    // Inspector edit.
    await heading.click();
    const text = editor.getByLabel('Text', { exact: true });
    await text.fill('Edited in the inspector');
    await text.press('Tab');
    await expect.poll(() => heading.textContent()).toBe('Edited in the inspector');

    // Inline edit.
    const sub = page.locator('[data-bb-node="hero-1/subheading"]');
    const before = await sub.textContent();
    await sub.dblclick();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Inline edit works');
    await page.keyboard.press('Enter');
    await expect.poll(() => sub.textContent()).toBe('Inline edit works');

    // Undo restores the inline edit; the inspector edit stays.
    await editor.getByRole('button', { name: /Undo/ }).click();
    await expect.poll(() => sub.textContent()).toBe(before);
    expect(await heading.textContent()).toBe('Edited in the inspector');

    // Delete the selected section with the keyboard.
    await page.locator('[data-bb-node="pricing-1"]').click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('Delete');
    await expect.poll(sections).toEqual(['hero-1']);

    expect(errors).toEqual([]);
  });

  test('layers tree works with the keyboard', async () => {
    const { page, editor, errors } = await open(url);
    await editor.getByRole('button', { name: /Hero/ }).first().click();
    await editor.getByRole('tab', { name: 'Layers' }).click();
    const tree = editor.getByRole('tree', { name: 'Layers' });
    await tree.getByRole('treeitem').first().focus();
    await page.keyboard.press('ArrowRight'); // expand hero
    await page.keyboard.press('ArrowDown'); // hero-1/content
    await page.keyboard.press('Enter');
    await expect.poll(() => page.locator('.bbx-label').textContent()).toContain('hero-1/content');
    // Enter in the tree selects; it must not start inline editing.
    expect(await page.locator('[contenteditable]').count()).toBe(0);
    await page.keyboard.press('ArrowLeft'); // to the parent row
    await page.keyboard.press('Enter');
    await expect.poll(() => page.locator('.bbx-label').textContent()).toContain('hero-1 ·');
    await page.keyboard.press('Delete');
    await expect.poll(() => page.locator('[data-bb-node="hero-1"]').count()).toBe(0);
    await page.keyboard.press('Control+z');
    await expect.poll(() => page.locator('[data-bb-node="hero-1"]').count()).toBe(1);
    expect(errors).toEqual([]);
  });

  test('removed editors release their store', async () => {
    const { page, errors } = await open(url);
    const listeners = await page.evaluate(async () => {
      type Probe = HTMLElement & { store: { listeners: Set<unknown> } };
      const first = document.querySelector('bowerbird-editor') as Probe;
      const store = first.store;
      for (let i = 0; i < 5; i++) {
        const el = document.createElement('bowerbird-editor') as Probe;
        el.store = store;
        document.body.append(el);
        await new Promise((r) => setTimeout(r, 20));
        el.remove();
      }
      await new Promise((r) => setTimeout(r, 20));
      // Moving an editor (remove and re-insert in one task) keeps it working.
      const parent = first.parentElement!;
      first.remove();
      parent.append(first);
      await new Promise((r) => setTimeout(r, 20));
      return store.listeners.size;
    });
    expect(listeners).toBe(1);
    expect(errors).toEqual([]);
  });

  test('mobile breakpoint narrows the canvas viewport', async () => {
    const { page, editor, errors } = await open(url);
    await editor.getByRole('button', { name: 'Mobile' }).click();
    await expect
      .poll(() => page.locator('.bbx-viewport').evaluate((e) => (e as HTMLElement).style.width))
      .toBe('390px');
    expect(errors).toEqual([]);
  });
});
