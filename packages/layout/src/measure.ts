import type { LayoutSnapshot } from './types.js';

export interface MeasureOptions {
  /** Attribute that carries node ids. Default `data-bb-node`. */
  attribute?: string;
  page?: string;
}

/**
 * Measures every node under `root` (the page root element, rendered with `data-bb-node` on every
 * node). Runs in a browser. The function is self-contained (no imports or outer references), so
 * it can be passed to Playwright's `page.evaluate` as is.
 */
export function measureLayout(root: Element, options: MeasureOptions = {}): LayoutSnapshot {
  const attr = options.attribute ?? 'data-bb-node';
  const rootRect = root.getBoundingClientRect();
  const rootEl = root as HTMLElement;
  // The editor canvas may be scaled with a transform; report unscaled CSS pixels.
  const scale = rootEl.offsetWidth ? rootRect.width / rootEl.offsetWidth || 1 : 1;
  const round = (n: number) => Math.round(n * 10) / 10;

  const parseColor = (value: string): [number, number, number, number] | undefined => {
    const m = /^rgba?\(([^)]+)\)$/.exec(value.trim());
    if (m) {
      const parts = m[1]!
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      if (parts.length < 3 || parts.some((p) => Number.isNaN(p))) return undefined;
      return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
    }
    const c = /^color\(srgb ([^)]+)\)$/.exec(value.trim());
    if (c) {
      const parts = c[1]!
        .split(/[\s/]+/)
        .filter(Boolean)
        .map(Number);
      if (parts.length < 3 || parts.some((p) => Number.isNaN(p))) return undefined;
      return [parts[0]! * 255, parts[1]! * 255, parts[2]! * 255, parts[3] ?? 1];
    }
    return undefined;
  };
  const luminance = ([r, g, b]: number[]) => {
    const ch = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(r!) + 0.7152 * ch(g!) + 0.0722 * ch(b!);
  };
  /** Composites backgrounds from `el` upwards until opaque; undefined if an image is in the way. */
  const backgroundOf = (el: Element): number[] | undefined => {
    const layers: number[][] = [];
    for (let cur: Element | null = el; cur; cur = cur.parentElement) {
      const cs = getComputedStyle(cur);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return undefined;
      const c = parseColor(cs.backgroundColor);
      if (c && c[3] > 0) {
        layers.push(c);
        if (c[3] >= 1) break;
      }
    }
    let out = [255, 255, 255];
    for (const layer of layers.reverse()) {
      const a = layer[3]!;
      out = [0, 1, 2].map((i) => layer[i]! * a + out[i]! * (1 - a));
    }
    return out;
  };

  const boxes: LayoutSnapshot['boxes'] = [];
  const all = [root, ...root.querySelectorAll(`[${attr}]`)];
  let maxRight = 0;
  let maxBottom = 0;
  for (const el of all) {
    const id = el.getAttribute(attr);
    if (!id) continue;
    const parentEl = el === root ? null : el.parentElement?.closest(`[${attr}]`);
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const x = (r.left - rootRect.left) / scale;
    const y = (r.top - rootRect.top) / scale;
    const w = r.width / scale;
    const h = r.height / scale;
    const box: LayoutSnapshot['boxes'][number] = {
      id,
      parent: parentEl?.getAttribute(attr) ?? null,
      tag: el.tagName.toLowerCase(),
      x: round(x),
      y: round(y),
      w: round(w),
      h: round(h),
    };
    if (cs.display === 'none' || cs.visibility === 'hidden' || (w === 0 && h === 0))
      box.hidden = true;
    if (cs.position === 'absolute' || cs.position === 'fixed' || cs.position === 'sticky')
      box.positioned = true;
    const html = el as HTMLElement;
    const clipsX = cs.overflowX !== 'visible' && html.scrollWidth > html.clientWidth + 1;
    const clipsY = cs.overflowY !== 'visible' && html.scrollHeight > html.clientHeight + 1;
    if (clipsX || clipsY) {
      box.clipped = {
        x: clipsX ? html.scrollWidth - html.clientWidth : 0,
        y: clipsY ? html.scrollHeight - html.clientHeight : 0,
      };
    }
    let own = '';
    for (const child of el.childNodes) if (child.nodeType === 3) own += child.textContent ?? '';
    own = own.trim();
    if (own) {
      const fontSize = Number.parseFloat(cs.fontSize) || 16;
      const lineHeight = Number.parseFloat(cs.lineHeight) || fontSize * 1.2;
      const fg = parseColor(cs.color);
      const bg = backgroundOf(el);
      let contrast: number | undefined;
      if (fg && bg) {
        const a = fg[3];
        const blended = [0, 1, 2].map((i) => fg[i]! * a + bg[i]! * (1 - a));
        const l1 = luminance(blended);
        const l2 = luminance(bg);
        contrast = Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
      }
      box.text = {
        chars: own.length,
        fontSize: round(fontSize),
        lineHeight: round(lineHeight),
        lines: Math.max(1, Math.round(h / lineHeight)),
        bold: Number(cs.fontWeight) >= 600,
        ...(contrast !== undefined ? { contrast } : {}),
      };
    }
    const tag = box.tag;
    if (
      tag === 'a' ||
      tag === 'button' ||
      tag === 'input' ||
      tag === 'select' ||
      tag === 'textarea'
    )
      box.interactive = true;
    if (tag === 'img') {
      const img = el as HTMLImageElement;
      box.image = {
        loaded: img.complete && img.naturalWidth > 0,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      };
    }
    if (!box.hidden && !box.positioned) {
      maxRight = Math.max(maxRight, x + w);
      maxBottom = Math.max(maxBottom, y + h);
    }
    boxes.push(box);
  }
  const width = round(rootRect.width / scale);
  return {
    ...(options.page ? { page: options.page } : {}),
    width,
    height: round(Math.max(maxBottom, rootRect.height / scale)),
    overflowX: round(Math.max(0, maxRight - width)),
    boxes,
  };
}
