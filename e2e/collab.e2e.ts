import { describe, expect, test } from 'vitest';
import { apps, useBrowser } from './browser.js';

describe.skipIf(!apps)('collaboration', () => {
  const open = useBrowser();

  test('two people and an agent see each other’s edits and selections', async () => {
    const { page, errors } = await open(apps?.collab ?? '', { width: 1800, height: 1000 });
    const sam = page.locator('#sam');
    const ana = page.locator('#ana');
    const samHeading = sam.locator('[data-bb-node="hero-1/heading"]');
    const anaHeading = ana.locator('[data-bb-node="hero-1/heading"]');
    await expect.poll(() => anaHeading.textContent()).toBe('Edit me from either side');

    // Sam selects the heading: Ana sees a box tagged "Sam" and an avatar in her toolbar.
    await samHeading.click();
    await expect.poll(() => ana.locator('.bbx-peer-tag').first().textContent()).toBe('Sam');
    expect(await ana.locator('.peers li').count()).toBe(1);

    // Sam edits inline; while typing Ana sees "Sam is typing…", then the new text.
    await samHeading.dblclick();
    await expect
      .poll(() => ana.locator('.bbx-peer-tag').first().textContent())
      .toBe('Sam is typing…');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Written by Sam');
    await page.keyboard.press('Enter');
    await expect.poll(() => anaHeading.textContent()).toBe('Written by Sam');

    // Ana changes something else; both converge.
    const anaSub = ana.locator('[data-bb-node="hero-1/subheading"]');
    await anaSub.dblclick();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('And Ana');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => sam.locator('[data-bb-node="hero-1/subheading"]').textContent())
      .toBe('And Ana');

    // The agent edits the server store directly: both see the change and the agent's presence.
    await page.getByRole('button', { name: 'Let the agent edit' }).click();
    await expect
      .poll(() => sam.locator('[data-bb-node="hero-1/subheading"]').textContent())
      .toMatch(/agent/);
    await expect
      .poll(() => sam.locator('.bbx-peer-tag', { hasText: 'Helper agent' }).textContent())
      .toBe('Helper agent · Rewrite subheading');

    // Undo goes through the server: Sam undoes his own edit only.
    await sam.locator('.bbx-frame').focus();
    await page.keyboard.press('Control+z');
    await expect.poll(() => anaHeading.textContent()).toBe('Edit me from either side');
    expect(await ana.locator('[data-bb-node="hero-1/subheading"]').textContent()).toMatch(/agent/);
    expect(errors).toEqual([]);
  });
});
