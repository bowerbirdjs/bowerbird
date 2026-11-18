import { createRequire } from 'node:module';
import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createStore } from '@bowerbirdjs/core';
import { lintLayout, measureLayout } from '@bowerbirdjs/layout';
import { createPlaywrightLayoutProvider, hasPlaywright } from '@bowerbirdjs/mcp';
import { afterAll, describe, expect, it } from 'vitest';

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

describe.skipIf(!hasPlaywright())('rendered layout in Chromium', () => {
  // Playwright is optional and not a dependency here, so type just what the tests use.
  type Page = {
    setContent(html: string): Promise<void>;
    locator(selector: string): {
      evaluate<R, A>(fn: (el: Element, arg: A) => R, arg: A): Promise<R>;
    };
    close(): Promise<void>;
  };
  type Browser = {
    newPage(options: { viewport: { width: number; height: number } }): Promise<Page>;
    close(): Promise<void>;
  };
  const { chromium } = createRequire(import.meta.url)('playwright') as {
    chromium: { launch(): Promise<Browser> };
  };
  const browser = chromium.launch();
  afterAll(async () => (await browser).close());

  async function measure(body: string, width = 390) {
    const page = await (await browser).newPage({ viewport: { width, height: 800 } });
    await page.setContent(
      `<body style="margin:0"><div class="bb-page" data-bb-node="root">${body}</div></body>`,
    );
    const snapshot = await page.locator('.bb-page').evaluate(measureLayout, {});
    await page.close();
    return snapshot;
  }

  it('measures contrast honestly: unknown over images, faded by opacity', async () => {
    const s = await measure(`
      <section data-bb-node="hero" style="position:relative;height:200px">
        <img data-bb-node="bg" src="${PIXEL}" style="position:absolute;inset:0;width:100%;height:100%">
        <h1 data-bb-node="over-image" style="position:relative;color:#fff">On a photo</h1>
      </section>
      <p data-bb-node="faded" style="color:#000;opacity:.25">Faded</p>`);
    const byId = Object.fromEntries(s.boxes.map((b) => [b.id, b]));
    expect(byId['over-image']?.text?.contrast).toBeUndefined();
    expect(byId.faded?.text?.contrast).toBeLessThan(2);
    expect(lintLayout(s).map((i) => `${i.rule} ${i.nodeId}`)).toEqual(['contrast faded']);
  });

  it('counts lines without padding, and doesn’t flag scrolling rows', async () => {
    const s = await measure(`
      <a data-bb-node="button" href="#" style="display:inline-block;padding:14px 20px;line-height:20px">One line</a>
      <div data-bb-node="row" style="display:flex;overflow-x:auto;gap:8px">
        <div data-bb-node="card-1" style="flex:0 0 300px">A</div>
        <div data-bb-node="card-2" style="flex:0 0 300px">B</div>
      </div>`);
    const byId = Object.fromEntries(s.boxes.map((b) => [b.id, b]));
    expect(byId.button?.text?.lines).toBe(1);
    expect(s.overflowX).toBe(0);
    expect(lintLayout(s).filter((i) => i.rule === 'horizontal-overflow')).toEqual([]);
  });

  it('the Playwright provider loads lazy images, crops tall shots and explains failures', async () => {
    const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
    store.apply({
      ops: [
        { op: 'page.create', path: '/', title: 'Home' },
        { op: 'page.create', id: 'empty', path: '/empty', title: 'Empty' },
        ...Array.from({ length: 6 }, () => ({
          op: 'section.insert',
          section: 'features',
          page: 'home',
        })),
        { op: 'section.insert', section: 'hero', page: 'home', variant: { layout: 'split' } },
        { op: 'props.set', id: 'hero-1/media', props: { src: PIXEL } },
        { op: 'style.set', id: 'hero-1/eyebrow', css: 'display: none' },
      ],
    });
    const provider = createPlaywrightLayoutProvider(store);
    try {
      const snapshot = await provider.snapshot({ page: 'home', width: 390 });
      const media = snapshot.boxes.find((b) => b.id === 'hero-1/media');
      expect(media?.image?.loaded).toBe(true);
      const shot = await provider.screenshot!({ page: 'home', width: 390 });
      expect(shot.cropped?.height).toBe(7800);
      expect(shot.cropped!.fullHeight).toBeGreaterThan(7800);
      await expect(
        provider.screenshot!({ page: 'home', width: 390, node: 'hero-1/eyebrow' }),
      ).rejects.toThrow(/isn't visible/);
      await expect(provider.screenshot!({ page: 'empty', width: 390 })).rejects.toThrow(/is empty/);
    } finally {
      await provider.close();
    }
  });

  it('every starter section and variant passes the layout checks in both themes', async () => {
    const registry = createDefaultRegistry();
    const store = createStore({ registry, doc: createStarterDoc() });
    const ops: unknown[] = [{ op: 'page.create', path: '/', title: 'Home' }];
    for (const s of registry.listSections()) {
      const [axis, values] = Object.entries(s.variants ?? {})[0] ?? [];
      for (const value of values ?? [undefined]) {
        ops.push({
          op: 'section.insert',
          section: s.name,
          ...(axis && value ? { variant: { [axis]: value } } : {}),
        });
      }
    }
    expect(store.apply({ ops }).ok).toBe(true);
    const provider = createPlaywrightLayoutProvider(store);
    try {
      const found: string[] = [];
      for (const theme of [undefined, 'dark'])
        for (const width of [390, 1280]) {
          const snapshot = await provider.snapshot({
            page: 'home',
            width,
            ...(theme ? { theme } : {}),
          });
          for (const i of lintLayout(snapshot))
            found.push(`${theme ?? 'default'}@${width} ${i.rule} ${i.nodeId}: ${i.message}`);
        }
      expect(found).toEqual([]);
    } finally {
      await provider.close();
    }
  });
});
