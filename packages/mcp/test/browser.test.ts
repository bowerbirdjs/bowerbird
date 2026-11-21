import { createRequire } from 'node:module';
import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createStore } from '@bowerbirdjs/core';
import { lintLayout, measureLayout } from '@bowerbirdjs/layout';
import { createPlaywrightLayoutProvider, hasPlaywright } from '@bowerbirdjs/mcp';
import { afterAll, describe, expect, it } from 'vitest';

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// Launching Chromium and laying out whole pages can take longer than the 5s default on a busy or
// cold machine.
describe.skipIf(!hasPlaywright())('rendered layout in Chromium', { timeout: 30_000 }, () => {
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
  // Started by the first test that needs it: a skipped suite still runs this function to collect
  // its tests, and must not try to load a Playwright that isn't there.
  let browser: Promise<Browser> | undefined;
  const launch = (): Promise<Browser> => {
    browser ??= (
      createRequire(import.meta.url)('playwright') as {
        chromium: { launch(): Promise<Browser> };
      }
    ).chromium.launch();
    return browser;
  };
  afterAll(async () => (await browser)?.close());

  async function measure(body: string, width = 390) {
    const page = await (await launch()).newPage({ viewport: { width, height: 800 } });
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

  it('reads text a node generates (a field’s label and help) and counts fields as targets', async () => {
    const s = await measure(`
      <form data-bb-node="form" style="background:#fff;color:#111">
        <label data-bb-node="ok" style="display:grid">
          <span style="font-size:14px">Email</span><input name="email" style="height:44px">
          <span style="font-size:13px;color:#555">We never share it.</span>
        </label>
        <label data-bb-node="faint" style="display:grid">
          <span style="font-size:11px;color:#bbb">Hard to read</span>
          <select name="plan"><option>One option that is not shown as text</option></select>
        </label>
        <details data-bb-node="item"><summary data-bb-node="q" style="padding:12px 0">Question</summary>
          <p data-bb-node="a" style="color:#eee">Folded away, so not measured</p></details>
      </form>`);
    const byId = Object.fromEntries(s.boxes.map((b) => [b.id, b]));
    // The smallest size and the lowest contrast of what the node shows.
    expect(byId.ok?.text).toMatchObject({ fontSize: 13, lines: 2 });
    expect(byId.ok?.text?.contrast).toBeGreaterThan(7);
    expect(byId.ok?.interactive).toBe(true);
    expect(byId.faint?.text).toMatchObject({ fontSize: 11, chars: 12 });
    expect(byId.faint?.text?.contrast).toBeLessThan(2);
    expect(byId.q?.interactive).toBe(true);
    expect(byId.a?.hidden).toBe(true);
    expect(lintLayout(s).map((i) => `${i.rule} ${i.nodeId}`)).toEqual([
      'contrast faint',
      'small-text faint',
    ]);
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
      // The default, then every other value of every axis.
      ops.push({ op: 'section.insert', section: s.name });
      for (const [axis, values] of Object.entries(s.variants ?? {}))
        for (const value of values.slice(1))
          ops.push({ op: 'section.insert', section: s.name, variant: { [axis]: value } });
    }
    // Accordion items are measured open too: folded content isn't laid out.
    const applied = store.apply({ ops });
    expect(applied.ok, JSON.stringify(applied)).toBe(true);
    const items = Object.values(store.doc.nodes).filter((n) => n.type === 'details');
    expect(items.length).toBeGreaterThan(0);
    store.apply({ ops: items.map((n) => ({ op: 'props.set', id: n.id, props: { open: true } })) });
    const provider = createPlaywrightLayoutProvider(store);
    try {
      const found: string[] = [];
      for (const theme of [undefined, 'dark'])
        for (const width of [390, 820, 1280]) {
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

  it('one very long word wraps instead of widening the page on a phone', async () => {
    const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
    store.apply({
      ops: [
        { op: 'page.create', path: '/', title: 'Home' },
        {
          op: 'section.insert',
          section: 'hero',
          variant: { layout: 'split' },
          content: { heading: { text: 'Datenschutzgrundverordnungskonformität leicht gemacht' } },
        },
      ],
    });
    const provider = createPlaywrightLayoutProvider(store);
    try {
      const snapshot = await provider.snapshot({ page: 'home', width: 390 });
      expect(
        lintLayout(snapshot).filter(
          (i) => i.rule === 'horizontal-overflow' || i.rule === 'clipped-content',
        ),
      ).toEqual([]);
      const heading = snapshot.boxes.find((b) => b.id === 'hero-1/heading');
      expect((heading?.x ?? 0) + (heading?.w ?? 999)).toBeLessThanOrEqual(390);
    } finally {
      await provider.close();
    }
  });
});
