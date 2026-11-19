import { createRequire } from 'node:module';
import type { Store } from '@bowerbirdjs/core';
import { renderDocument } from '@bowerbirdjs/html';
import { type LayoutProvider, type LayoutSnapshot, measureLayout } from '@bowerbirdjs/layout';

// Minimal structural types for the parts of Playwright used here (it is an optional dependency).
interface PwLocator {
  evaluate<R, A, E>(fn: (el: E, arg: A) => R, arg: A): Promise<R>;
  screenshot(options: { type: 'png' | 'jpeg'; quality?: number }): Promise<Buffer>;
  count(): Promise<number>;
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
}
interface PwPage {
  setContent(
    html: string,
    options: { waitUntil: 'load' | 'domcontentloaded'; timeout: number },
  ): Promise<void>;
  waitForLoadState(state: 'load', options: { timeout: number }): Promise<void>;
  locator(selector: string): PwLocator;
  screenshot(options: {
    type: 'png' | 'jpeg';
    quality?: number;
    fullPage?: boolean;
    clip?: { x: number; y: number; width: number; height: number };
  }): Promise<Buffer>;
  close(): Promise<void>;
}
interface PwBrowser {
  newPage(options: { viewport: { width: number; height: number } }): Promise<PwPage>;
  close(): Promise<void>;
  isConnected(): boolean;
  on(event: 'disconnected', handler: () => void): void;
}
interface Playwright {
  chromium: { launch(options?: { executablePath?: string }): Promise<PwBrowser> };
}

const MISSING =
  'Layout checks and screenshots need Playwright with Chromium on the machine running the MCP server: npm i -D playwright && npx playwright install chromium.';

/** Whether Playwright can be loaded (it is optional). */
export function hasPlaywright(): boolean {
  try {
    createRequire(import.meta.url).resolve('playwright');
    return true;
  } catch {
    return false;
  }
}

/** Longest screenshot edge; images above ~8000px are rejected by model APIs. */
const MAX_HEIGHT = 7800;

/**
 * Renders published HTML in headless Chromium to measure layouts and take screenshots. The
 * browser starts on first use and is reused (and restarted if it goes away); call `close()` on
 * shutdown.
 */
export function createPlaywrightLayoutProvider(
  store: Store,
  options: { executablePath?: string; viewportHeight?: number } = {},
): LayoutProvider & { close(): Promise<void> } {
  let browser: Promise<PwBrowser> | undefined;
  const launch = async (): Promise<PwBrowser> => {
    browser ??= (async () => {
      let pw: Playwright;
      try {
        pw = createRequire(import.meta.url)('playwright') as Playwright;
      } catch {
        throw new Error(MISSING);
      }
      const launched = await pw.chromium.launch(
        options.executablePath ? { executablePath: options.executablePath } : {},
      );
      // If Chromium crashes or is killed, start a fresh one next time.
      launched.on('disconnected', () => {
        browser = undefined;
      });
      return launched;
    })();
    browser.catch(() => {
      browser = undefined;
    });
    const b = await browser;
    if (b.isConnected()) return b;
    browser = undefined;
    return launch();
  };

  const open = async (
    page: string,
    width: number,
    theme?: string,
    doc = store.doc,
    locale?: string,
  ) => {
    const html = renderDocument(doc, store.registry, page, {
      nodeIds: 'all',
      ...(theme ? { theme } : {}),
      ...(locale ? { locale } : {}),
    })
      // Lazy images below the fold would never load in a measurement or a screenshot.
      .replaceAll('loading="lazy"', 'loading="eager"');
    const tab = await (await launch()).newPage({
      viewport: { width, height: options.viewportHeight ?? 900 },
    });
    await tab.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    // Give images a moment; don't fail on slow or blocked image hosts.
    await tab.waitForLoadState('load', { timeout: 3000 }).catch(() => undefined);
    return tab;
  };

  return {
    async snapshot({ page, width, theme, doc, locale }): Promise<LayoutSnapshot> {
      const tab = await open(page, width, theme, doc, locale);
      try {
        return await tab.locator('.bb-page').evaluate(measureLayout, { page });
      } finally {
        await tab.close();
      }
    },
    async screenshot({ page, width, theme, node, doc, locale }) {
      const tab = await open(page, width, theme, doc, locale);
      try {
        const target = node
          ? tab.locator(`[data-bb-node="${node.replace(/["\\]/g, '')}"]`)
          : tab.locator('.bb-page');
        if (node && !(await target.count()))
          throw new Error(`No node "${node}" on page "${page}".`);
        const box = await target.boundingBox();
        if (!box || box.height < 1 || box.width < 1) {
          throw new Error(
            node
              ? `"${node}" isn't visible at ${width}px wide (hidden or zero size).`
              : `Page "${page}" is empty, so there is nothing to show.`,
          );
        }
        // Model APIs reject very tall images: cut long pages and tall nodes, and say so.
        const fullHeight = Math.ceil(box.height);
        const height = Math.min(fullHeight, MAX_HEIGHT);
        const data = await tab.screenshot({
          type: 'png',
          fullPage: true,
          clip: {
            x: Math.max(0, box.x),
            y: Math.max(0, box.y),
            width: Math.max(1, Math.ceil(box.width)),
            height,
          },
        });
        return {
          data: data.toString('base64'),
          mimeType: 'image/png',
          ...(height < fullHeight ? { cropped: { height, fullHeight } } : {}),
        };
      } finally {
        await tab.close();
      }
    },
    async close() {
      const pending = browser;
      browser = undefined;
      if (pending) await (await pending.catch(() => undefined))?.close();
    },
  };
}
