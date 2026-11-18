import { describe, expect, test } from 'vitest';
import { apps, useBrowser } from './browser.js';

describe.skipIf(!apps)('wedding planner POC', () => {
  const open = useBrowser();

  test('plan the event once, and the site shows it; edit the site within its blocks', async () => {
    const { page, editor, errors } = await open(apps?.wedding ?? '', { width: 1600, height: 950 });
    const canvas = page.locator('[data-bb-canvas]');
    await expect
      .poll(() => canvas.locator('[data-bb-node="hero-1/heading"]').textContent())
      .toBe('Lena & Jonas');

    // A fact edited in Details reaches the page.
    await page.locator('[data-group="schedule"] > summary').click();
    const time = page.locator('[data-path="schedule.0.time"]');
    await time.fill('14:30');
    await time.press('Enter');
    await expect
      .poll(() => canvas.locator('[data-bb-data="schedule.0.time"]').textContent())
      .toBe('14:30 Uhr');

    // A click on fact text on the page opens its field.
    await canvas.locator('[data-bb-data="faq.1.q"]').click();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-path')))
      .toBe('faq.1.q');

    // A bad value is refused, with the reason, and the page keeps the old one.
    await page.locator('[data-group="gifts"] > summary').click();
    const url = page.locator('[data-path="gifts.links.0.url"]');
    await url.fill('http://insecure.example');
    await url.press('Enter');
    await expect
      .poll(() => page.locator('[data-group="gifts"] .error').textContent())
      .toMatch(/https/);

    // Structured editing: a heading can't be deleted or moved; the whole section can.
    await canvas.locator('[data-bb-node="story-1/heading"]').click();
    expect(await page.locator('.bbx-toolbar').isHidden()).toBe(true);
    await page.keyboard.press('Delete');
    expect(await canvas.locator('[data-bb-node="story-1/heading"]').count()).toBe(1);
    expect(await editor.getByRole('heading', { name: /^Style/ }).count()).toBe(0);
    await canvas.locator('[data-bb-node="story-1"]').click({ position: { x: 6, y: 6 } });
    await page.locator('.bbx-toolbar [data-action="delete"]').click();
    await expect.poll(() => canvas.locator('[data-bb-node="story-1"]').count()).toBe(0);
    await page.keyboard.press('Control+z');
    await expect.poll(() => canvas.locator('[data-bb-node="story-1"]').count()).toBe(1);

    // The library offers the event blocks, in the event's language, and nothing else.
    await editor.getByRole('tab', { name: 'Insert' }).click();
    const cards = (await editor.locator('.card strong').allTextContents()).map((t) => t.trim());
    expect(cards).toContain('Zitat');
    expect(cards).toContain('Titelbild');
    expect(cards).toHaveLength(18);
    expect(await editor.locator('.elements button').count()).toBe(0);
    await editor.getByRole('button', { name: /^Zitat/ }).click();
    await expect.poll(() => canvas.locator('[data-bb-section="quote"]').count()).toBe(1);

    // Any accent stays readable: a bright yellow is darkened on a light design.
    await page.getByRole('tab', { name: 'Design' }).click();
    await page.getByLabel('Pick any accent colour').fill('#ffff00');
    await expect.poll(() => page.getByText('Made a little darker').count()).toBe(1);
    const accent = await canvas
      .locator('[data-bb-node="countdown-1/days"]')
      .evaluate((el) => getComputedStyle(el).color);
    expect(accent).not.toBe('rgb(255, 255, 0)');

    // A design restyles every section in one step.
    await page.getByRole('button', { name: /Midnight/ }).click();
    await expect
      .poll(() => canvas.locator('[data-bb-node="hero-1"]').getAttribute('class'))
      .toContain('bb-hero--layout-fullscreen');

    // The published page: a menu, the facts, no editor marks, nothing for the host's slots.
    await page.getByRole('button', { name: 'View site' }).click();
    const site = page.frameLocator('iframe.preview-frame');
    await expect.poll(() => site.locator('.site-menu a', { hasText: 'Ablauf' }).count()).toBe(1);
    expect(await site.locator('[data-bb-data]').count()).toBe(0);
    expect(await site.getByText('14:30 Uhr').count()).toBe(1);
    expect(await site.getByText(/Antwortformular/).count()).toBe(0);
    await page.getByRole('button', { name: 'Close' }).click();

    // Publish, then a change makes Publish primary again; everything survives a reload.
    await page.getByRole('button', { name: 'Publish' }).click();
    expect(await page.getByRole('button', { name: 'Published' }).count()).toBe(1);
    // The event group is open when Details opens.
    await page.getByRole('tab', { name: 'Details' }).click();
    const title = page.locator('[data-path="event.title"]');
    await title.fill('Lena & Jonas Berger');
    await title.press('Enter');
    await expect.poll(() => page.getByRole('button', { name: 'Publish' }).count()).toBe(1);
    await expect.poll(() => page.locator('.save').textContent()).toBe('Saved');
    await page.reload();
    await canvas.locator('[data-bb-node="hero-1"]').waitFor();
    expect(await canvas.locator('[data-bb-data="schedule.0.time"]').textContent()).toBe(
      '14:30 Uhr',
    );
    expect(await canvas.locator('[data-bb-node="hero-1"]').getAttribute('class')).toContain(
      'layout-fullscreen',
    );
    expect(await page.locator('.event-title').textContent()).toBe('Lena & Jonas Berger');
    expect(errors).toEqual([]);
  });

  test('a new event starts complete, in its own language, and hides what it lacks', async () => {
    const { page, errors } = await open(apps?.wedding ?? '', { width: 1400, height: 900 });
    const canvas = page.locator('[data-bb-canvas]');
    await canvas.locator('[data-bb-node="hero-1"]').waitFor();
    await page.getByRole('button', { name: 'New event' }).click();
    const dialog = page.getByRole('dialog', { name: 'New event' });
    await dialog.getByLabel('Your names or the event’s title').fill('Ada & Grace');
    await dialog.getByLabel('Date', { exact: true }).fill('2028-05-20');
    await dialog.getByLabel('Language of the site').selectOption('en');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect
      .poll(() => canvas.locator('[data-bb-node="hero-1/heading"]').textContent())
      .toBe('Ada & Grace');
    expect(await canvas.getByText('A & G').count()).toBeGreaterThan(0);
    expect(await canvas.getByText('20 May 2028').count()).toBe(1);
    // No venues yet: the editor says where to add them; the published page leaves the section out.
    expect(await canvas.getByText('No venue yet. Add it under Details.').count()).toBe(1);
    await page.getByRole('button', { name: 'View site' }).click();
    const site = page.frameLocator('iframe.preview-frame');
    await expect.poll(() => site.locator('.site-menu').count()).toBe(1);
    expect(await site.locator('#location-1').isHidden()).toBe(true);
    expect(await site.locator('.site-menu a', { hasText: 'Where we celebrate' }).count()).toBe(1);
    expect(errors).toEqual([]);
  });
});
