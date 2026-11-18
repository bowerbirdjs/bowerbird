import { formatLayout, type LayoutBox, type LayoutSnapshot, lintLayout } from '@bowerbirdjs/layout';
import { describe, expect, it } from 'vitest';

const box = (
  id: string,
  parent: string | null,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Partial<LayoutBox> = {},
): LayoutBox => ({ id, parent, tag: 'div', x, y, w, h, ...extra });

const snap = (boxes: LayoutBox[], width = 390): LayoutSnapshot => ({
  width,
  height: 800,
  overflowX: 0,
  boxes,
});

const rules = (s: LayoutSnapshot) => lintLayout(s).map((i) => `${i.rule} ${i.nodeId}`);

describe('lintLayout', () => {
  it('reports only the outermost box that overflows the page', () => {
    const s = snap([
      box('root', null, 0, 0, 390, 800),
      box('a', 'root', 0, 0, 500, 100),
      box('a/b', 'a', 0, 0, 480, 50, {
        text: { chars: 10, fontSize: 40, lineHeight: 48, lines: 1, bold: true },
      }),
      box('c', 'root', 0, 100, 390, 100),
    ]);
    expect(rules(s)).toEqual(['horizontal-overflow a']);
  });

  it('tap targets: undersized and crowded fail, undersized but spaced pass', () => {
    const link = (id: string, y: number, h: number): LayoutBox =>
      box(id, 'root', 0, y, 200, h, { tag: 'a', interactive: true });
    const spaced = snap([box('root', null, 0, 0, 390, 800), link('l1', 0, 20), link('l2', 30, 20)]);
    expect(rules(spaced)).toEqual([]);
    const crowded = snap([
      box('root', null, 0, 0, 390, 800),
      link('l1', 0, 16),
      link('l2', 18, 16),
    ]);
    expect(rules(crowded)).toEqual(['tap-target l1', 'tap-target l2']);
  });

  it('flags low contrast, small text, clipped content, overlap and broken images', () => {
    const text = (contrast: number, fontSize = 16) => ({
      chars: 5,
      fontSize,
      lineHeight: 20,
      lines: 1,
      bold: false,
      contrast,
    });
    const s = snap([
      box('root', null, 0, 0, 390, 800),
      box('low', 'root', 0, 0, 100, 20, { text: text(3) }),
      box('large-ok', 'root', 0, 40, 100, 40, { text: text(3.2, 28) }),
      box('tiny', 'root', 0, 100, 100, 20, { text: text(7, 10) }),
      box('clip', 'root', 0, 200, 100, 50, { clipped: { x: 0, y: 40 } }),
      box('o1', 'root', 0, 300, 100, 100),
      box('o2', 'root', 10, 310, 100, 100),
      box('img', 'root', 0, 500, 100, 100, {
        tag: 'img',
        image: { loaded: false, naturalWidth: 0, naturalHeight: 0 },
      }),
    ]);
    const found = rules(s);
    expect(found).toEqual(
      expect.arrayContaining([
        'contrast low',
        'small-text tiny',
        'clipped-content clip',
        'overlap o2',
        'image-missing img',
      ]),
    );
    expect(found).not.toContain('contrast large-ok');
  });

  it('formats boxes as an indented, compact list with issues at the end', () => {
    const s = snap([
      box('root', null, 0, 0, 390, 800),
      box('hero-1', 'root', 0, 0, 390, 400),
      box('hero-1/heading', 'hero-1', 24, 80, 342, 96, {
        text: { chars: 20, fontSize: 40, lineHeight: 48, lines: 2, bold: true },
      }),
    ]);
    s.page = 'home';
    expect(formatLayout(s)).toBe(
      [
        'layout home at 390px wide: page height 800px',
        'hero-1  0,0 390×400',
        '  hero-1/heading  24,80 342×96  text 40px 2 lines',
        'No layout issues found.',
      ].join('\n'),
    );
  });

  it('ignores overflow inside scrollers, and reports content pushed off the left edge', () => {
    const s = snap([
      box('root', null, 0, 0, 390, 800),
      box('row', 'root', 0, 0, 390, 100),
      box('row/card', 'row', 300, 0, 300, 100, { contained: true }),
      box('shifted', 'root', -120, 200, 300, 100),
    ]);
    expect(rules(s)).toEqual(['horizontal-overflow shifted']);
  });

  it('inline links in a sentence are exempt from tap-target size and overlap checks', () => {
    const s = snap([
      box('root', null, 0, 0, 390, 800),
      box('p', 'root', 0, 0, 200, 60, {
        text: { chars: 40, fontSize: 16, lineHeight: 20, lines: 3, bold: false },
      }),
      box('p/a1', 'p', 0, 4, 182, 43, { tag: 'a', interactive: true, inline: true }),
      box('p/a2', 'p', 40, 24, 60, 18, { tag: 'a', interactive: true, inline: true }),
    ]);
    expect(rules(s)).toEqual([]);
  });
});
