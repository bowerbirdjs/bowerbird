import { describe, expect, test } from 'vitest';
import { apps, useBrowser } from './browser.js';

describe.skipIf(!apps)('themes', () => {
  const open = useBrowser();

  test('the editor chrome has a dark appearance; host variables still win', async () => {
    const { page, editor, errors } = await open(apps?.vanilla ?? '');
    await editor.getByRole('button', { name: /Hero/ }).first().click();
    await page.locator('[data-bb-node="hero-1/heading"]').click();
    const look = () =>
      page.evaluate(() => {
        const el = document.querySelector('bowerbird-editor')!;
        const root = el.shadowRoot!;
        const style = (sel: string) => getComputedStyle(root.querySelector(sel)!);
        const label = getComputedStyle(document.querySelector('.bbx-label')!);
        const frame = getComputedStyle(document.querySelector('.bbx-frame')!);
        const page = getComputedStyle(document.querySelector('.bb-page')!);
        return {
          scheme: getComputedStyle(el).colorScheme,
          panel: style('.panel.right').backgroundColor,
          pressed: style(".group button[aria-pressed='true']").color,
          label: label.color,
          canvas: frame.backgroundColor,
          // Page content is isolated from the chrome's colour scheme.
          pageScheme: page.colorScheme,
        };
      });
    const light = await look();
    expect(light).toMatchObject({
      scheme: 'light',
      panel: 'rgb(249, 250, 251)',
      pressed: 'rgb(255, 255, 255)',
      label: 'rgb(255, 255, 255)',
      canvas: 'rgb(233, 235, 240)',
    });

    await page.evaluate(() =>
      document.querySelector('bowerbird-editor')!.setAttribute('appearance', 'dark'),
    );
    const dark = await look();
    expect(dark).toMatchObject({
      scheme: 'dark',
      panel: 'rgb(15, 23, 42)',
      // Text on the (lighter) dark accent is dark, so it stays readable.
      pressed: 'rgb(15, 23, 42)',
      label: 'rgb(15, 23, 42)',
      canvas: 'rgb(2, 6, 23)',
      pageScheme: light.pageScheme,
    });

    // `auto` follows the system setting.
    await page.evaluate(() =>
      document.querySelector('bowerbird-editor')!.setAttribute('appearance', 'auto'),
    );
    await page.emulateMedia({ colorScheme: 'light' });
    expect((await look()).panel).toBe(light.panel);
    await page.emulateMedia({ colorScheme: 'dark' });
    expect((await look()).panel).toBe(dark.panel);

    // Variables the host sets win over the appearance's defaults, on the element or an ancestor.
    await page.addStyleTag({
      content: 'body { --bb-editor-panel: rgb(1, 2, 3); --bb-editor-canvas-bg: rgb(4, 5, 6); }',
    });
    expect(await look()).toMatchObject({ panel: 'rgb(1, 2, 3)', canvas: 'rgb(4, 5, 6)' });
    expect(errors).toEqual([]);
  });

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
