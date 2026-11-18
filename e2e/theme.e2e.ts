import { describe, expect, test } from 'vitest';
import { apps, useBrowser } from './browser.js';

describe.skipIf(!apps)('editor look', () => {
  const open = useBrowser();
  const url = apps?.vanilla ?? '';

  test('tokens, appearance and density restyle the panels and the canvas chrome', async () => {
    const { page, editor, errors } = await open(url);
    const warnings: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'warning') warnings.push(m.text());
    });
    await editor.getByRole('button', { name: /Hero/ }).first().click();
    const heading = page.locator('[data-bb-node="hero-1/heading"]');
    await heading.click();
    await page.locator('.bbx-select').waitFor();

    const look = () =>
      page.evaluate(() => {
        const el = document.querySelector('bowerbird-editor')!;
        const root = el.shadowRoot!;
        const cs = (e: Element | null) => getComputedStyle(e!);
        const preview = [...root.querySelectorAll('button')].find((b) =>
          b.textContent?.includes('Preview'),
        );
        return {
          toolbar: cs(root.querySelector('.toolbar')).backgroundColor,
          text: cs(root.querySelector('.toolbar')).color,
          inspector: cs(root.querySelector('.right')).backgroundColor,
          canvas: cs(document.querySelector('.bbx-frame')).backgroundColor,
          select: cs(document.querySelector('.bbx-select')).borderTopColor,
          tab: cs(root.querySelector('[role="tab"][aria-selected="true"]')).borderBottomColor,
          button: [cs(preview!).height, cs(preview!).borderTopLeftRadius],
          scheme: [
            cs(root.querySelector('.toolbar')).colorScheme,
            cs(document.querySelector('.bbx-viewport')).colorScheme,
          ],
        };
      });
    const pageText = () =>
      heading.evaluate((e) => [getComputedStyle(e).color, getComputedStyle(e).backgroundColor]);
    const light = await look();
    const lightPage = await pageText();
    expect(light).toMatchObject({
      toolbar: 'rgb(255, 255, 255)',
      canvas: 'rgb(236, 236, 240)',
      select: 'rgb(79, 70, 229)',
      button: ['30px', '6px'],
    });

    // Dark: every part of the chrome follows, the page itself doesn't.
    await editor.evaluate((e) => e.setAttribute('appearance', 'dark'));
    const dark = await look();
    expect(dark).toMatchObject({
      toolbar: 'rgb(24, 24, 27)',
      text: 'rgb(244, 244, 245)',
      inspector: 'rgb(28, 28, 31)',
      canvas: 'rgb(14, 14, 16)',
      scheme: ['dark', 'normal'],
    });
    expect(await pageText()).toEqual(lightPage);

    // A host token in CSS reaches the panels and the outlines on the page.
    await editor.evaluate((e) => {
      e.removeAttribute('appearance');
      (e as HTMLElement).style.setProperty('--bb-editor-accent', 'rgb(200, 0, 0)');
    });
    expect(await look()).toMatchObject({ select: 'rgb(200, 0, 0)', tab: 'rgb(200, 0, 0)' });

    // ui settings: tokens win over CSS, density changes sizes, and both go away with the setting.
    const setUI = (ui: unknown) =>
      editor.evaluate((e, ui) => {
        (e as unknown as { ui: unknown }).ui = ui;
      }, ui);
    await setUI({ tokens: { accent: 'rgb(0, 120, 0)', radius: '0px' }, density: 'compact' });
    await expect.poll(look).toMatchObject({ select: 'rgb(0, 120, 0)', button: ['26px', '0px'] });
    // …without touching the host's own styles on the element.
    expect(await editor.evaluate((e) => (e as HTMLElement).style.cssText)).toBe(
      '--bb-editor-accent: rgb(200, 0, 0);',
    );
    await setUI({ tokens: { accnt: 'red' } });
    await expect.poll(look).toMatchObject({ select: 'rgb(200, 0, 0)', button: ['30px', '6px'] });
    expect(warnings.join('\n')).toMatch(/"accnt" is not an editor token/);
    expect(errors).toEqual([]);
  });

  test("a brand's icons, parts and canvas pattern", async () => {
    const { page, editor, errors } = await open(url);
    await editor.getByRole('button', { name: /Hero/ }).first().click();
    await page.locator('[data-bb-node="hero-1/heading"]').click();
    await page.locator('.bbx-toolbar').waitFor();
    const dot =
      '<svg viewBox="0 0 256 256" fill="currentColor"><circle cx="128" cy="128" r="96"/></svg>';
    await page.addStyleTag({
      content: `bowerbird-editor::part(danger) { border-color: rgb(1, 2, 3); }
        bowerbird-editor::part(heading) { text-transform: uppercase; }
        bowerbird-editor { --bb-editor-canvas-bg: radial-gradient(red 1px, transparent 1px) 0 0 / 20px 20px, rgb(9, 9, 9); }`,
    });
    await editor.evaluate((e, dot) => {
      (e as unknown as { ui: unknown }).ui = { icons: { trash: dot, undo: dot, nope: dot } };
    }, dot);
    const seen = () =>
      page.evaluate(() => {
        const root = document.querySelector('bowerbird-editor')!.shadowRoot!;
        const del = [...root.querySelectorAll('button')].find(
          (b) => b.textContent?.trim() === 'Delete',
        )!;
        const frame = getComputedStyle(document.querySelector('.bbx-frame')!);
        return {
          panelIcon: !!root.querySelector('[aria-label="Undo"] circle'),
          canvasIcon: !!document.querySelector('.bbx-toolbar [data-action="delete"] circle'),
          canvasFill: getComputedStyle(
            document.querySelector('.bbx-toolbar [data-action="delete"] svg')!,
          ).fill,
          danger: getComputedStyle(del).borderTopColor,
          heading: getComputedStyle(root.querySelector('[part~="heading"]')!).textTransform,
          canvas: [frame.backgroundColor, frame.backgroundImage.startsWith('radial-gradient')],
        };
      });
    await expect.poll(seen).toMatchObject({
      panelIcon: true,
      canvasIcon: true,
      danger: 'rgb(1, 2, 3)',
      heading: 'uppercase',
      canvas: ['rgb(9, 9, 9)', true],
    });
    // The host's icon keeps its own fill on the canvas (not the built-in icons' stroke style).
    expect((await seen()).canvasFill).not.toBe('none');
    expect(errors).toEqual([]);
  });
});
