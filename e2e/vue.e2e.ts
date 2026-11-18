import { describe, expect, test } from 'vitest';
import { apps, useBrowser } from './browser.js';

describe.skipIf(!apps)('Vue example', () => {
  const open = useBrowser();

  test('props reach the element and events reach Vue', async () => {
    const { page, errors } = await open(apps?.vue ?? '');
    const heading = page.locator('[data-bb-node="hero-1/heading"]');
    await expect.poll(() => heading.textContent()).toBe('Hello from Vue');

    await heading.click();
    await expect
      .poll(() => page.locator('header span').textContent())
      .toBe('Selected: hero-1/heading');

    const revision = page.getByTestId('revision');
    const before = await revision.textContent();
    await heading.dblclick();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Edited in Vue');
    await page.keyboard.press('Enter');
    await expect.poll(() => heading.textContent()).toBe('Edited in Vue');
    await expect.poll(() => revision.textContent()).not.toBe(before);

    expect(errors).toEqual([]);
  });
});
