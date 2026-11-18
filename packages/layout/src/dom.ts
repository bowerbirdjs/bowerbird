import type { SiteDoc, Store } from '@bowerbirdjs/core';
import { renderPage } from '@bowerbirdjs/html';
import { measureLayout } from './measure.js';
import type { LayoutSnapshot } from './types.js';

/** Produces layout snapshots (and optionally screenshots) for agent tools. */
export interface LayoutProvider {
  snapshot(options: { page: string; width: number; theme?: string }): Promise<LayoutSnapshot>;
  /** PNG screenshot, base64. Not every environment can take one. */
  screenshot?(options: {
    page: string;
    width: number;
    theme?: string;
    /** Only this node. */
    node?: string;
  }): Promise<{ data: string; mimeType: 'image/png' }>;
}

let counter = 0;

/**
 * Lays a page out in the current browser document (offscreen, at any width) and measures it.
 * Uses the same CSS the editor canvas uses, so results match what people see.
 */
export function createDomLayoutProvider(
  source: Store | (() => { doc: SiteDoc; registry: Store['registry'] }),
  options: { document?: Document; viewportHeight?: number } = {},
): LayoutProvider {
  const read = () =>
    typeof source === 'function' ? source() : { doc: source.doc, registry: source.registry };
  return {
    async snapshot({ page, width, theme }) {
      const doc = options.document ?? document;
      const { doc: site, registry } = read();
      const id = `m${++counter}`;
      const host = doc.createElement('div');
      host.setAttribute('data-bb-measure', id);
      host.setAttribute('aria-hidden', 'true');
      if (theme) host.setAttribute('data-theme', theme);
      host.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;contain:layout paint;--bb-viewport-height:${options.viewportHeight ?? 800}px`;
      const rendered = renderPage(site, registry, page, {
        mode: 'editor',
        nodeIds: 'all',
        canvasSelector: `[data-bb-measure="${id}"]`,
      });
      const style = doc.createElement('style');
      style.textContent = rendered.css;
      const content = doc.createElement('div');
      content.innerHTML = rendered.html;
      host.append(style, content);
      doc.body.append(host);
      try {
        const images = [...host.querySelectorAll('img')].filter((img) => !img.complete);
        await Promise.race([
          Promise.all(
            images.map(
              (img) =>
                new Promise<void>((done) => {
                  img.addEventListener('load', () => done(), { once: true });
                  img.addEventListener('error', () => done(), { once: true });
                }),
            ),
          ),
          new Promise((done) => setTimeout(done, 1500)),
        ]);
        await doc.fonts?.ready;
        const root = content.firstElementChild;
        if (!root) throw new Error(`Page "${page}" rendered nothing.`);
        return measureLayout(root, { page });
      } finally {
        host.remove();
      }
    },
  };
}
