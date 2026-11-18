import { describe, expect, test } from 'vitest';
import { apps, useBrowser } from './browser.js';

describe.skipIf(!apps)('review, previews and linked components', () => {
  const open = useBrowser();

  test('the agent streams a preview, proposes changes, and a person accepts some of them', async () => {
    const { page, editor, errors } = await open(apps?.showcase ?? '', { width: 1600, height: 960 });
    await page.getByLabel('Event', { exact: true }).selectOption({ label: 'Design Systems Day' });
    await page.locator('[data-bb-canvas] .bbx-empty').waitFor();

    // While the demo agent "writes" its ops, the canvas shows them as a preview.
    await page.getByRole('button', { name: 'Build a page for this event' }).click();
    const banner = page.locator('.bbx-ghost-banner');
    await banner.waitFor({ timeout: 10_000 });
    expect(await banner.textContent()).toMatch(
      /Demo agent is editing… · \d+ new · not applied yet/,
    );
    await page.locator('.line.agent', { hasText: 'Done.' }).waitFor({ timeout: 20_000 });
    await expect.poll(() => banner.isHidden()).toBe(true);

    // In "Ask me first" mode, agent changes become a changeset in the Review tab.
    await page.getByLabel('Agent changes').selectOption('review');
    await page.getByRole('button', { name: 'Use a teal brand' }).click();
    await page.locator('.line.tool', { hasText: 'Proposed cs-1' }).waitFor({ timeout: 20_000 });
    const review = editor.getByRole('tab', { name: /Review/ });
    await expect.poll(() => review.getAttribute('aria-selected')).toBe('true');
    const changeset = editor.locator('.changeset');
    expect(await changeset.locator('.ops li').count()).toBe(6);
    const tokenValue = () =>
      page
        .locator('[data-bb-canvas]')
        .evaluate((el) => getComputedStyle(el).getPropertyValue('--color-brand-600').trim());
    const before = await tokenValue();

    await changeset.getByRole('button', { name: 'Preview' }).click();
    await expect.poll(() => banner.textContent()).toMatch(/Preview of Teal brand by Demo agent/);
    expect(await tokenValue()).toBe('#0d9488');
    await changeset.getByRole('button', { name: 'Hide preview' }).click();
    await expect.poll(tokenValue).toBe(before);

    // Accept two of the six token changes; reject the rest.
    const boxes = changeset.locator('input[type="checkbox"]');
    for (let i = 2; i < 6; i++) await boxes.nth(i).uncheck();
    await changeset.getByRole('button', { name: 'Accept 2' }).click();
    await expect.poll(() => changeset.locator('.ops li').count()).toBe(4);
    await changeset.getByRole('button', { name: 'Reject' }).click();
    await expect.poll(() => review.count()).toBe(0);
    expect(await tokenValue()).toBe(before);

    await editor.getByRole('tab', { name: 'History' }).click();
    expect(await editor.locator('.history li').first().textContent()).toMatch(
      /Demo agent\s*Teal brand/,
    );
    expect(errors).toEqual([]);
  });

  test('the agent checks the rendered mobile layout', async () => {
    const { page, errors } = await open(apps?.showcase ?? '', { width: 1600, height: 960 });
    await page.getByRole('button', { name: 'Check the mobile layout' }).click();
    await page.locator('.line.tool', { hasText: 'get_layout:' }).waitFor({ timeout: 20_000 });
    expect(await page.locator('.line.tool', { hasText: 'get_layout:' }).textContent()).toMatch(
      /layout home at 390px wide: page height \d+px/,
    );
    expect(errors).toEqual([]);
  });

  test('images can be uploaded through the host asset adapter', async () => {
    const { page, editor, errors } = await open(apps?.showcase ?? '', { width: 1600, height: 960 });
    const media = page.locator('[data-bb-node="hero-1/media"]');
    await media.click();
    // A 2×2 PNG.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
      'base64',
    );
    await editor
      .locator('.upload input[type="file"]')
      .setInputFiles({ name: 'venue-photo.png', mimeType: 'image/png', buffer: png });
    await expect.poll(() => media.getAttribute('src')).toMatch(/^data:image\/webp;base64,/);
    expect(await media.getAttribute('width')).toBe('2');
    expect(errors).toEqual([]);
  });

  test('a section becomes a linked component; editing the definition updates every copy', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    await editor
      .getByRole('button', { name: /Call to action/ })
      .first()
      .click();
    await page.locator('[data-bb-node="cta-1"]').waitFor();
    await editor.getByLabel('Linked component name').fill('Signup band');
    await editor.getByRole('button', { name: 'Make linked' }).click();
    await editor.locator('.linked-panel', { hasText: 'Instance of “Signup band”' }).waitFor();

    await editor.getByRole('tab', { name: 'Insert' }).click();
    await editor.getByRole('button', { name: /Signup band/ }).click();
    await page.locator('[data-bb-node="cta-2"]').waitFor();

    // An override on the second copy survives definition edits.
    await page.locator('[data-bb-node="cta-2/heading"]').click();
    const text = editor.getByLabel('Text', { exact: true });
    await text.fill('Only this copy');
    await text.press('Tab');
    await expect.poll(() => editor.locator('.override').count()).toBe(1);

    await page.locator('[data-bb-node="cta-1/heading"]').click();
    await editor.getByRole('button', { name: 'Edit definition' }).click();
    await page.locator('.bbx-symbol-banner', { hasText: 'Signup band' }).waitFor();
    await text.fill('Shared heading');
    await text.press('Tab');
    await editor.getByRole('combobox', { name: 'Page', exact: true }).selectOption('home');
    await expect
      .poll(() => page.locator('[data-bb-node="cta-1/heading"]').textContent())
      .toBe('Shared heading');
    expect(await page.locator('[data-bb-node="cta-2/heading"]').textContent()).toBe(
      'Only this copy',
    );
    expect(errors).toEqual([]);
  });
});
