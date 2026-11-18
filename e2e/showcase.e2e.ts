import { describe, expect, test } from 'vitest';
import { apps, useBrowser } from './browser.js';

describe.skipIf(!apps)('showcase', () => {
  const open = useBrowser();

  test('a person and the demo agent edit the same page', async () => {
    const { page, editor, errors } = await open(apps?.showcase ?? '', { width: 1600, height: 960 });
    const heading = page.locator('[data-bb-node="hero-1/heading"]');
    await expect
      .poll(() => heading.textContent())
      .toBe('Two days on the future of the web platform');
    // The app fits the window: nothing scrolls the page sideways (the assistant column used
    // to grow past its 320px track because of the textarea's intrinsic width).
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await overflow()).toBe(0);
    await page.setViewportSize({ width: 1100, height: 960 });
    expect(await overflow()).toBe(0);
    await page.setViewportSize({ width: 1600, height: 960 });

    // Switch to the empty event and let the scripted agent build it.
    await page.getByLabel('Event', { exact: true }).selectOption({ label: 'Design Systems Day' });
    // Wait for the new event's editor (a positive signal, not just "no sections").
    await page.locator('[data-bb-canvas] .bbx-empty').waitFor();
    expect(await page.locator('[data-bb-canvas] [data-bb-section]').count()).toBe(0);
    await page.getByRole('button', { name: 'Build a page for this event' }).click();
    await page.locator('.line.agent', { hasText: 'Done.' }).waitFor({ timeout: 20_000 });
    await expect.poll(() => heading.textContent()).toBe('One day about systems that scale design');

    // The person edits the heading inline.
    await heading.dblclick();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Edited by Sam');
    await page.keyboard.press('Enter');
    await expect.poll(() => heading.textContent()).toBe('Edited by Sam');

    // The agent imports a speakers section from HTML.
    await page.getByRole('button', { name: 'Add a speakers section' }).click();
    await page
      .locator('.line.agent', { hasText: 'Added a speakers section' })
      .waitFor({ timeout: 20_000 });
    const speakers = page.locator('[data-bb-canvas] h2', { hasText: 'Speakers' });
    await expect.poll(() => speakers.count()).toBe(1);

    // Undo the agent's last change from History: the speakers go, the person's edit stays.
    await editor.getByRole('tab', { name: 'History' }).click();
    await editor.getByRole('button', { name: /Undo last change by Demo agent/ }).click();
    await expect.poll(() => speakers.count()).toBe(0);
    expect(await heading.textContent()).toBe('Edited by Sam');

    // A marketer may not insert sections: the editor explains why.
    await page.getByLabel('Role').selectOption('marketer');
    await editor.getByRole('tab', { name: 'Insert' }).click();
    await editor.getByRole('button', { name: /Pricing tiers/ }).click();
    await expect
      .poll(() => editor.locator('.toast').textContent())
      .toMatch(/content|permission|level/i);
    expect(await page.locator('[data-bb-node="pricing-1"]').count()).toBe(0);

    // As a marketer the palette is refused, and the page says why.
    await page.getByLabel('Brand').selectOption('Teal');
    await expect.poll(() => page.locator('.notice').textContent()).toMatch(/design access/);
    await page.locator('.notice').getByRole('button', { name: 'Dismiss' }).click();

    // Palette change shows up in the developer panel.
    await page.getByLabel('Role').selectOption('designer');
    await page.getByLabel('Brand').selectOption('Sunset');
    await page.getByRole('tab', { name: 'Developer' }).click();
    await expect
      .poll(() => page.locator('.developer pre').first().textContent())
      .toContain('Palette: Sunset');

    expect(errors).toEqual([]);
  });
});
