import { createRequire } from 'node:module';
import type { Store } from '@bowerbirdjs/core';
import { renderDocument } from '@bowerbirdjs/html';
import { type LayoutProvider, type LayoutSnapshot, measureLayout } from '@bowerbirdjs/layout';

// Minimal structural types for the parts of Playwright used here (it is an optional dependency).
interface PwLocator {
  evaluate<R, A, E>(fn: (el: E, arg: A) => R, arg: A): Promise<R>;
  screenshot(options: { type: 'png' | 'jpeg'; quality?: number }): Promise<Buffer>;
  count(): Promise<number>;
  boundingBox(): Promise<{ height: number } | null>;
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
 * browser starts on first use and is reused; call `close()` on shutdown.
 */
export function createPlaywrightLayoutProvider(
  store: Store,
  options: { executablePath?: string; viewportHeight?: number } = {},
): LayoutProvider & { close(): Promise<void> } {
  let browser: Promise<PwBrowser> | undefined;
  const launch = () => {
    browser ??= (async () => {
      let pw: Playwright;
      try {
        pw = createRequire(import.meta.url)('playwright') as Playwright;
      } catch {
        throw new Error(MISSING);
      }
      return pw.chromium.launch(
        options.executablePath ? { executablePath: options.executablePath } : {},
      );
    })();
    browser.catch(() => {
      browser = undefined;
    });
    return browser;
  };

  const open = async (page: string, width: number, theme?: string) => {
    const html = renderDocument(store.doc, store.registry, page, {
      nodeIds: 'all',
      ...(theme ? { theme } : {}),
    });
    const tab = await (await launch()).newPage({
      viewport: { width, height: options.viewportHeight ?? 900 },
    });
    await tab.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10_000 });
    // Give images a moment; don't fail on slow or blocked image hosts.
    await tab.waitForLoadState('load', { timeout: 3000 }).catch(() => undefined);
    return tab;
  };

  return {
    async snapshot({ page, width, theme }): Promise<LayoutSnapshot> {
      const tab = await open(page, width, theme);
      try {
        return await tab.locator('.bb-page').evaluate(measureLayout, { page });
      } finally {
        await tab.close();
      }
    },
    async screenshot({ page, width, theme, node }) {
      const tab = await open(page, width, theme);
      try {
        let data: Buffer;
        if (node) {
          const target = tab.locator(`[data-bb-node="${node.replace(/["\\]/g, '')}"]`);
          if (!(await target.count())) throw new Error(`No node "${node}" on page "${page}".`);
          data = await target.screenshot({ type: 'png' });
        } else {
          const box = await tab.locator('.bb-page').boundingBox();
          const height = Math.min(Math.ceil(box?.height ?? 900), MAX_HEIGHT);
          data = await tab.screenshot({
            type: 'png',
            fullPage: true,
            clip: { x: 0, y: 0, width, height },
          });
        }
        return { data: data.toString('base64'), mimeType: 'image/png' };
      } finally {
        await tab.close();
      }
    },
    async close() {
      const b = browser;
      browser = undefined;
      if (b) await (await b.catch(() => undefined))?.close();
    },
  };
}
