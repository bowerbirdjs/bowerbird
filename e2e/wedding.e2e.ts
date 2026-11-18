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

    // A click on fact text shows where it lives in Details (the group opens).
    await canvas.locator('[data-bb-data="faq.1.q"]').click();
    await expect.poll(() => page.locator('[data-group="faq"]').getAttribute('open')).toBe('');

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

  test('every field can be edited on the page itself', async () => {
    const { page, errors } = await open(apps?.wedding ?? '', { width: 1600, height: 950 });
    const canvas = page.locator('[data-bb-canvas]');
    const panel = page.locator('.bbx-fields');
    await canvas.locator('[data-bb-node="hero-1"]').waitFor();
    const data = (path: string) =>
      page.evaluate((p) => {
        const raw = localStorage.getItem('bowerbird-wedding/v1');
        return raw
          ? p.split('.').reduce<unknown>((v, k) => (v as never)?.[k], JSON.parse(raw).draft.data)
          : undefined;
      }, path);

    // Text shown from the facts is edited in place.
    const title = canvas.locator('[data-bb-data="schedule.1.title"]');
    await title.dblclick();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Sekt und Kuchen');
    await page.keyboard.press('Enter');
    await expect.poll(() => title.textContent()).toBe('Sekt und Kuchen');

    // A formatted value (the time) opens a form with the right input.
    await canvas.locator('[data-bb-data="schedule.0.time"]').dblclick();
    await expect.poll(() => panel.isVisible()).toBe(true);
    const time = panel.getByLabel('Time');
    expect(await time.getAttribute('type')).toBe('time');
    await time.fill('13:45');
    await time.press('Enter');
    await expect
      .poll(() => canvas.locator('[data-bb-data="schedule.0.time"]').textContent())
      .toBe('13:45 Uhr');
    expect(await panel.isVisible()).toBe(false);

    // Picking a venue for a schedule item.
    await canvas.locator('[data-bb-data="schedule.1.venue"]').dblclick();
    await panel.getByLabel('Where').selectOption({ label: 'Altes Rathaus Sonnenfeld' });
    await expect
      .poll(() => canvas.locator('[data-bb-data="schedule.1.venue"]').textContent())
      .toBe('Altes Rathaus Sonnenfeld');
    await page.keyboard.press('Escape');

    // Several fields at once: a gift link's label and address. A bad address is refused.
    await canvas.locator('[data-bb-data="gifts.links.0.label"]').dblclick();
    await panel.getByLabel('Link').fill('http://insecure.example');
    await panel.getByLabel('Link').press('Tab');
    await expect
      .poll(() =>
        page
          .locator('.bbx-host')
          .evaluate(
            () =>
              document.querySelector('bowerbird-editor')?.shadowRoot?.querySelector('.toast')
                ?.textContent ?? '',
          ),
      )
      .toMatch(/https/);
    await panel.getByLabel('Label').fill('Unsere Reisekasse');
    await panel.getByLabel('Label').press('Enter');
    await expect
      .poll(() => canvas.locator('[data-bb-data="gifts.links.0.label"]').textContent())
      .toBe('Unsere Reisekasse');

    // The event date, from the hero.
    await canvas.locator('[data-bb-node="hero-1/date"]').dblclick();
    await panel.getByLabel('Event date').fill('2027-07-03');
    await panel.getByLabel('Event date').press('Enter');
    await expect
      .poll(() => canvas.locator('[data-bb-node="hero-1/date"]').textContent())
      .toBe('3. Juli 2027');

    // List items: copy a question, move it up, remove it again.
    await canvas.locator('[data-bb-data="faq.0.q"]').click();
    const itembar = page.locator('.bbx-itembar');
    await expect.poll(() => itembar.isVisible()).toBe(true);
    await itembar.getByRole('button', { name: 'Copy item' }).click();
    await expect.poll(() => canvas.locator('.ev-faq__item').count()).toBe(4);
    await itembar.getByRole('button', { name: 'Move item down' }).click();
    await itembar.getByRole('button', { name: 'Remove item' }).click();
    await expect.poll(() => canvas.locator('.ev-faq__item').count()).toBe(3);

    // A venue copy gets its own id, so the schedule's references stay right.
    await canvas.locator('[data-bb-data="venues.1.name"]').click();
    await itembar.getByRole('button', { name: 'Copy item' }).click();
    await expect.poll(() => canvas.locator('.ev-card').count()).toBe(3);
    await expect.poll(() => data('venues.2.id')).toBe('lindenhof-2');

    // What isn't text: select the hero photo and give it alt text right there.
    await canvas.locator('[data-bb-node="hero-1/media"]').click();
    const alt = panel.getByLabel('Alt');
    await alt.fill('Lena und Jonas am See');
    await alt.press('Enter');
    await expect
      .poll(() => canvas.locator('[data-bb-node="hero-1/media"]').getAttribute('alt'))
      .toBe('Lena und Jonas am See');

    // Everything went through the shared history: undo takes back the last change.
    await canvas.locator('[data-bb-node="hero-1/heading"]').click();
    await page.keyboard.press('Control+z');
    await expect
      .poll(() => canvas.locator('[data-bb-node="hero-1/media"]').getAttribute('alt'))
      .toBe('');
    expect(errors).toEqual([]);
  });
});
