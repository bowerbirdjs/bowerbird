import { createRequire } from 'node:module';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, inject } from 'vitest';

export const apps = inject('apps');

/**
 * Opens one browser for the file and a fresh page per call. Console errors and page errors are
 * collected so tests can assert that a flow ran cleanly.
 */
export function useBrowser() {
  let browser: Browser | undefined;
  beforeAll(async () => {
    const { chromium } = createRequire(import.meta.url)(
      'playwright',
    ) as typeof import('playwright');
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });
  return async (url: string, viewport = { width: 1400, height: 900 }) => {
    if (!browser) throw new Error('browser not started');
    const page: Page = await browser.newPage({ viewport });
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForSelector('bowerbird-editor');
    return { page, errors, editor: page.locator('bowerbird-editor') };
  };
}
