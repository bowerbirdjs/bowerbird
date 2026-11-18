import { describe, expect, test } from 'vitest';
import { apps, useBrowser } from './browser.js';

describe.skipIf(!apps)('content themes', () => {
  const open = useBrowser();

  test('the theme menu previews the dark content theme on the canvas', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    await editor.getByRole('button', { name: /Hero/ }).first().click();
    const heading = page.locator('[data-bb-node="hero-1/heading"]');
    await heading.waitFor();
    const colors = () =>
      heading.evaluate((h) => ({
        text: getComputedStyle(h).color,
        bg: getComputedStyle(h.closest('[data-bb-node="hero-1"]')!).backgroundColor,
      }));
    const before = await colors();
    await editor.getByLabel('Theme').selectOption('dark');
    await expect.poll(async () => (await colors()).bg).not.toBe(before.bg);
    const dark = await colors();
    expect(dark.bg).toBe('rgb(2, 6, 23)');
    expect(dark.text).toBe('rgb(248, 250, 252)');
    await editor.getByLabel('Theme').selectOption('');
    await expect.poll(colors).toEqual(before);
    expect(errors).toEqual([]);
  });
});
