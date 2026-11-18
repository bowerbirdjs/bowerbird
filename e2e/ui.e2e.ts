import { describe, expect, test } from 'vitest';
import { apps, useBrowser } from './browser.js';

describe.skipIf(!apps)('customizing the editor UI', () => {
  const open = useBrowser();

  test('hosts turn parts off, limit what can be added and styled, and add their own controls', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    await editor.getByRole('button', { name: /Hero/ }).first().click();
    const heading = page.locator('[data-bb-node="hero-1/heading"]');
    await heading.waitFor();

    // A host-configured editor: fewer toolbar controls, two sections, text and images only,
    // colours only, no layers, no deleting; plus its own Publish button and button styling.
    await page.evaluate(() => {
      const el = document.querySelector('bowerbird-editor')!;
      el.ui = {
        features: {
          'toolbar.zoom': false,
          'toolbar.theme': false,
          'structure.layers': false,
          delete: false,
          'components.create': false,
        },
        sections: ['hero', 'cta'],
        elements: ['text', 'image'],
        styleProperties: ['color', 'background'],
      };
      const publish = document.createElement('button');
      publish.slot = 'toolbar-end';
      publish.textContent = 'Publish';
      el.append(publish);
      const style = document.createElement('style');
      style.textContent = 'bowerbird-editor::part(button) { border-radius: 0; }';
      document.head.append(style);
    });

    expect(await editor.getByLabel('Zoom').count()).toBe(0);
    expect(await editor.getByLabel('Theme').count()).toBe(0);
    expect(await editor.getByLabel('Screen size').count()).toBe(1);
    expect(await editor.getByRole('button', { name: 'Publish' }).isVisible()).toBe(true);
    const tabs = (await editor.getByRole('tab').allTextContents()).map((t) => t.trim());
    expect(tabs).toEqual(['Insert', 'History']);

    await editor.getByRole('tab', { name: 'Insert' }).click();
    const cards = (await editor.locator('.card strong').allTextContents()).map((t) => t.trim());
    expect(cards).toEqual(['Hero', 'Call to action']);
    const elements = (await editor.locator('.elements button').allTextContents()).map((t) =>
      t.trim(),
    );
    expect(elements).toEqual(['Text', 'Image']);
    expect(
      await editor
        .locator('.elements button')
        .first()
        .evaluate((b) => getComputedStyle(b).borderRadius),
    ).toBe('0px');

    // No deleting anywhere: no buttons, no toolbar button, and the Delete key does nothing.
    await heading.click();
    expect(await editor.getByRole('button', { name: 'Delete' }).count()).toBe(0);
    expect(await page.locator('.bbx-toolbar [data-action="delete"]').isHidden()).toBe(true);
    expect(await page.locator('.bbx-toolbar [data-action="duplicate"]').isVisible()).toBe(true);
    await page.keyboard.press('Delete');
    expect(await heading.count()).toBe(1);

    // The style editor offers colours only.
    const options = await editor
      .locator('datalist#bb-props option')
      .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(options).toEqual(['color', 'background']);
    await editor.getByLabel('CSS property').fill('padding');
    await editor.getByLabel('Value', { exact: true }).fill('var(--space-4)');
    await editor.getByRole('button', { name: 'Add', exact: true }).click();
    await expect.poll(() => editor.locator('.toast').textContent()).toMatch(/can’t be styled/);

    // A section offers "Make linked" only when components.create is on.
    await page.locator('[data-bb-node="hero-1"]').click({ position: { x: 4, y: 4 } });
    expect(await editor.getByRole('button', { name: 'Make linked' }).count()).toBe(0);

    // The inspector and the top bar can go entirely; the canvas takes their space.
    const width = () => page.locator('.bbx-host').evaluate((e) => e.getBoundingClientRect().width);
    const before = await width();
    await page.evaluate(() => {
      document.querySelector('bowerbird-editor')!.ui = {
        features: { inspector: false, toolbar: false, structure: false },
      };
    });
    await expect.poll(width).toBeGreaterThan(before + 400);
    expect(await editor.locator('[part="toolbar"]').count()).toBe(0);
    expect(await editor.locator('[part="inspector"]').count()).toBe(0);
    expect(errors).toEqual([]);
  });
});
