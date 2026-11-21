import type { Page } from 'playwright';
import { describe, expect, test } from 'vitest';
import { apps, useBrowser } from './browser.js';

/** Runs ops through the editor (as its person). */
const apply = (page: Page, ops: unknown[]) =>
  page.evaluate((o) => document.querySelector('bowerbird-editor')!.apply(o), ops);
const props = (page: Page, id: string) =>
  page.evaluate((i) => document.querySelector('bowerbird-editor')!.store!.doc.nodes[i]?.props, id);
const selected = (page: Page) =>
  page.evaluate(() => document.querySelector('bowerbird-editor')!.controller!.selected);

const FORM = {
  type: 'form',
  props: { action: '/api/subscribe' },
  children: [
    { type: 'field', props: { type: 'email', name: 'email', label: 'Email', required: true } },
    { type: 'button', props: { type: 'submit', text: 'Subscribe' } },
  ],
};

describe.skipIf(!apps)('forms, accordion items and icons in the editor', () => {
  const open = useBrowser();

  test('review fixes: label clicks while editing, Tab in preview, fields kept out of host forms', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    await apply(page, [
      { op: 'section.insert', section: 'hero' },
      { op: 'node.insert', parent: 'hero-1/content', node: FORM },
      {
        op: 'node.insert',
        parent: 'hero-1/content',
        node: { type: 'field', props: { name: 'stray', label: 'Stray' } },
      },
    ]);
    const label = page.locator('[data-bb-node="hero-1/field-1"] .bb-field__label');
    await label.waitFor();
    // The page's form is a real form element, and a field outside it belongs to no form at all
    // (so never to a form the host has around the editor).
    const owners = await page.evaluate(() => {
      const el = (id: string) => document.querySelector(`[data-bb-node="${id}"]`);
      const input = (id: string) =>
        document.querySelector<HTMLInputElement>(`[data-bb-node="${id}"] input`);
      return {
        form: el('hero-1/form-1')?.tagName,
        inside: input('hero-1/field-1')?.form?.tagName,
        stray: input('hero-1/field-2')?.form ?? null,
      };
    });
    expect(owners).toEqual({ form: 'FORM', inside: 'FORM', stray: null });

    // Placing the caret with a click doesn't end the edit of a label.
    await label.dblclick();
    await page.keyboard.press('End');
    await page.keyboard.type(' address');
    await label.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' please');
    await page.keyboard.press('Enter');
    await expect
      .poll(async () => (await props(page, 'hero-1/field-1'))?.label)
      .toBe('Email address please');

    // In preview, Tab moves from one field to the next as on the published page.
    await page.keyboard.press('Escape');
    await editor.getByRole('button', { name: 'Preview' }).click();
    await page.locator('[data-bb-node="hero-1/field-1"] input').click();
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() =>
        document.activeElement?.closest('[data-bb-node]')?.getAttribute('data-bb-node'),
      ),
    ).toBe('hero-1/field-2');
    expect(errors).toEqual([]);
  });

  test('form fields are content while editing, and work in preview without sending anything', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    await apply(page, [
      { op: 'section.insert', section: 'hero' },
      { op: 'node.insert', parent: 'hero-1/content', node: FORM },
    ]);
    const field = page.locator('[data-bb-node="hero-1/field-1"]');
    const input = field.locator('input');
    await input.waitFor();

    // A click on the control selects its field; nothing can be typed into it.
    await input.click({ force: true });
    await expect.poll(() => selected(page)).toBe('hero-1/field-1');
    await page.keyboard.type('x');
    expect(await input.inputValue()).toBe('');
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');

    // The label is edited on the page.
    await field.locator('.bb-field__label').dblclick();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Work email');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await props(page, 'hero-1/field-1'))?.label).toBe('Work email');

    // Preview: the form can be tried out, and sending it goes nowhere.
    await page.keyboard.press('Escape');
    await editor.getByRole('button', { name: 'Preview' }).click();
    const live = page.locator('[data-bb-node="hero-1/field-1"] input');
    await live.click();
    await page.keyboard.type('ada@example.com');
    expect(await live.inputValue()).toBe('ada@example.com');
    const url = page.url();
    await page.keyboard.press('Enter');
    await page.locator('[data-bb-node="hero-1/button-1"]').click();
    expect(page.url()).toBe(url);
    expect(errors).toEqual([]);
  });

  test('a field’s kind brings its choices along, edited one per line', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    await apply(page, [
      { op: 'section.insert', section: 'hero' },
      { op: 'node.insert', parent: 'hero-1/content', node: FORM },
    ]);
    await page.locator('[data-bb-node="hero-1/field-1"]').locator('input').click({ force: true });
    // A text-like field offers no choices.
    expect(await editor.getByLabel('Choices (one per line)').count()).toBe(0);
    await editor.getByLabel('Kind').selectOption('select');
    await expect
      .poll(() => props(page, 'hero-1/field-1'))
      .toMatchObject({ type: 'select', options: ['Option 1', 'Option 2'] });
    await editor.getByLabel('Choices (one per line)').fill('Monthly\n\nYearly\n');
    await editor.getByLabel('Choices (one per line)').blur();
    await expect
      .poll(async () => (await props(page, 'hero-1/field-1'))?.options)
      .toEqual(['Monthly', 'Yearly']);
    // The canvas follows on its next frame.
    await expect
      .poll(() => page.locator('[data-bb-node="hero-1/field-1"] option').allTextContents())
      .toEqual(['Monthly', 'Yearly']);
    // Back to a kind without choices: they go, instead of the change being refused.
    await editor.getByLabel('Kind').selectOption('email');
    await expect.poll(async () => (await props(page, 'hero-1/field-1'))?.options).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('accordion items are open while editing and fold in preview', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    await apply(page, [
      { op: 'section.insert', section: 'hero' },
      {
        op: 'node.insert',
        parent: 'hero-1/content',
        node: {
          type: 'details',
          children: [
            { type: 'text', props: { tag: 'summary', text: 'Is it free?' } },
            { type: 'text', props: { text: 'Yes, for small teams.' } },
          ],
        },
      },
    ]);
    const item = page.locator('[data-bb-node="hero-1/details-1"]');
    const summary = page.locator('[data-bb-node="hero-1/text-1"]');
    const isOpen = () => item.evaluate((d) => (d as HTMLDetailsElement).open);
    await summary.waitFor();
    expect(await isOpen()).toBe(true);
    // Clicking the summary selects it; it doesn't fold the item away from the editor.
    await summary.click();
    expect(await isOpen()).toBe(true);
    await expect.poll(() => selected(page)).toBe('hero-1/text-1');

    // Editing the summary in place: spaces are typed, clicks place the caret, nothing folds.
    await summary.dblclick();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Is it free for us');
    await summary.click();
    expect(await isOpen()).toBe(true);
    await page.keyboard.press('End');
    await page.keyboard.type(' now?');
    await page.keyboard.press('Enter');
    await expect
      .poll(async () => (await props(page, 'hero-1/text-1'))?.text)
      .toBe('Is it free for us now?');
    expect(await isOpen()).toBe(true);

    // Preview shows it as published: closed until its summary is clicked.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await editor.getByRole('button', { name: 'Preview' }).click();
    await expect.poll(isOpen).toBe(false);
    await summary.click();
    await expect.poll(isOpen).toBe(true);
    await editor.getByRole('button', { name: 'Preview' }).click();
    await expect.poll(isOpen).toBe(true);
    expect(errors).toEqual([]);
  });

  test('icons are inserted from the site’s set and changed in a picker', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    await apply(page, [{ op: 'section.insert', section: 'hero' }]);
    await page.locator('[data-bb-node="hero-1/content"]').click({ position: { x: 3, y: 3 } });
    await editor.getByRole('tab', { name: 'Insert' }).click();
    await editor.getByRole('button', { name: 'Icon', exact: true }).click();
    const icon = page.locator('[data-bb-node="hero-1/icon-1"]');
    await icon.waitFor();
    expect((await props(page, 'hero-1/icon-1'))?.name).toBe('star');
    const drawing = () => icon.locator('svg').innerHTML();
    const star = await drawing();
    // The icon follows the text: its size and its colour.
    const box = await icon.locator('svg').evaluate((svg) => {
      const s = getComputedStyle(svg);
      return [s.width, s.height, s.stroke, getComputedStyle(svg.parentElement!).color];
    });
    expect(box[0]).toBe(box[1]);
    expect(box[2]).toBe(box[3]);

    const picker = editor.getByRole('group', { name: 'Icon' });
    expect(
      await picker.getByRole('button', { name: 'star', exact: true }).getAttribute('aria-pressed'),
    ).toBe('true');
    await picker.getByRole('button', { name: 'rocket', exact: true }).click();
    await expect.poll(async () => (await props(page, 'hero-1/icon-1'))?.name).toBe('rocket');
    await expect.poll(drawing).not.toBe(star);
    expect(errors).toEqual([]);
  });
});

describe.skipIf(!apps)('the section catalog in the Insert tab', () => {
  const open = useBrowser();
  const setUi = (page: Page, ui: Record<string, unknown>) =>
    page.evaluate((u) => {
      document.querySelector('bowerbird-editor')!.ui = u;
    }, ui);

  test('every section has a live preview, grouped by category, that follows the site’s tokens', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    const cards = editor.locator('.card.has-thumb');
    await expect.poll(() => cards.count()).toBe(21);
    expect(await editor.locator('.group').allTextContents()).toEqual([
      'Navigation',
      'Headers',
      'Social proof',
      'Content',
      'Media and people',
      'Pricing',
      'Forms and calls to action',
    ]);
    // Each preview is its section laid out at desktop width and scaled to the card.
    const sizes = await editor.locator('.thumb').evaluateAll((thumbs) =>
      thumbs.map((thumb) => {
        const page = thumb.firstElementChild as HTMLElement;
        const scale = new DOMMatrix(getComputedStyle(page).transform).a;
        return {
          width: thumb.clientWidth,
          height: (thumb as HTMLElement).offsetHeight,
          layout: page.offsetWidth,
          shown: Math.round(page.offsetWidth * scale),
          cropped: thumb.hasAttribute('data-cropped'),
          tall: page.offsetHeight * scale > 148,
          inert: (thumb as HTMLElement).inert,
          hidden: thumb.getAttribute('aria-hidden'),
        };
      }),
    );
    for (const s of sizes) {
      expect(s.layout).toBe(1120);
      expect(Math.abs(s.shown - s.width)).toBeLessThanOrEqual(1);
      expect(s.height).toBeGreaterThanOrEqual(36);
      expect(s.height).toBeLessThanOrEqual(148);
      expect(s.cropped).toBe(s.tall);
      // A picture, not content: nothing in it takes focus or clicks.
      expect(s.inert).toBe(true);
      expect(s.hidden).toBe('true');
    }
    expect(sizes.some((s) => s.cropped)).toBe(true);

    // The hero preview is drawn with the site's own tokens, and follows them.
    const button = editor.locator('.thumb .bb-hero__primary');
    const colour = () => button.evaluate((b) => getComputedStyle(b).backgroundColor);
    expect(await colour()).toBe('rgb(79, 70, 229)');
    await apply(page, [{ op: 'token.set', path: 'color.brand.600', value: '#0f766e' }]);
    await expect.poll(colour).toBe('rgb(15, 118, 110)');
    // ...and the theme being previewed on the canvas.
    const surface = () =>
      editor.locator('.thumb .bb-hero').evaluate((h) => getComputedStyle(h).backgroundColor);
    expect(await surface()).toBe('rgb(255, 255, 255)');
    await editor.getByLabel('Theme').selectOption('dark');
    await expect.poll(surface).toBe('rgb(2, 6, 23)');
    await editor.getByLabel('Theme').selectOption('');

    // The panel's own styles don't reach into a preview (its cards style <strong>).
    const value = await editor
      .locator('.thumb .bb-stats__value')
      .first()
      .evaluate((v) => [getComputedStyle(v).paddingRight, getComputedStyle(v).fontWeight]);
    expect(value).toEqual(['0px', '700']);

    // A click on a preview adds its section.
    await editor.getByRole('button', { name: /^Questions and answers/ }).click();
    await page.locator('[data-bb-node="faq-1/item-1/question"]').waitFor();
    expect(errors).toEqual([]);
  });

  test('search narrows sections and elements; both can be turned off', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    const names = () => editor.locator('.card > strong').allTextContents();
    const search = editor.getByLabel('Search sections and elements');
    await search.fill('form');
    await expect.poll(names).toEqual(['Newsletter signup', 'Contact']);
    expect(await editor.locator('.elements button').allTextContents()).toEqual(
      ['Form', 'Form field'].map((l) => expect.stringContaining(l)),
    );
    await search.fill('zebra crossing');
    await expect.poll(names).toEqual([]);
    expect(await editor.getByRole('status').filter({ hasText: 'Nothing matches' }).count()).toBe(1);
    await search.fill('');
    await expect.poll(async () => (await names()).length).toBe(21);

    // Without previews, cards describe themselves in words; without search, no box.
    await setUi(page, { features: { 'insert.thumbnails': false, 'insert.search': false } });
    await expect.poll(() => editor.locator('.thumb').count()).toBe(0);
    expect(await editor.locator('.card .desc').count()).toBe(21);
    expect(await search.count()).toBe(0);
    // A short list needs no search box either.
    await setUi(page, { sections: ['hero', 'cta'], elements: ['text'] });
    await expect.poll(() => editor.locator('.thumb').count()).toBe(2);
    expect(await search.count()).toBe(0);
    expect(await editor.locator('.group').allTextContents()).toEqual([
      'Headers',
      'Forms and calls to action',
    ]);
    expect(errors).toEqual([]);
  });
});
