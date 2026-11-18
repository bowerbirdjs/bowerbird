import { describe, expect, test } from 'vitest';
import { apps, useBrowser } from './browser.js';

describe.skipIf(!apps)('rich text and languages', () => {
  const open = useBrowser();

  test('rich text gets inline formatting; translations are edited per language', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    await editor.getByRole('button', { name: /Hero/ }).first().click();
    await page.locator('[data-bb-node="hero-1/heading"]').waitFor();

    // Rich text: insert inside the hero content, then bold a word inline.
    await page.locator('[data-bb-node="hero-1/subheading"]').click();
    await editor.getByRole('button', { name: 'Rich text' }).click();
    const rich = page.locator('[data-bb-canvas] [data-bb-node$="rich-text-1"]');
    await rich.waitFor();
    await rich.dblclick();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Plain then ');
    await page.keyboard.press('Control+b');
    await page.keyboard.type('bold');
    await page.keyboard.press('Enter');
    await expect.poll(() => rich.innerHTML()).toBe('Plain then <b>bold</b>');

    // Languages: add German, switch, and edit the heading in German only.
    await page.evaluate(() =>
      (
        document.querySelector('bowerbird-editor') as unknown as { apply(ops: unknown[]): unknown }
      ).apply([{ op: 'locale.set', add: ['de'] }]),
    );
    const language = editor.getByRole('combobox', { name: 'Language' });
    await language.selectOption('de');
    const heading = page.locator('[data-bb-node="hero-1/heading"]');
    const english = await heading.textContent();
    await heading.dblclick();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Deutsche Überschrift');
    await page.keyboard.press('Enter');
    await expect.poll(() => heading.textContent()).toBe('Deutsche Überschrift');
    await language.selectOption('');
    await expect.poll(() => heading.textContent()).toBe(english);
    expect(errors).toEqual([]);
  });
});
