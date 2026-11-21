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
  const MEDIA = /^(img|video|picture|canvas|svg|iframe)$/i;
  /**
   * Composites backgrounds from `el` upwards until opaque. Undefined when an image is in the way:
   * a background image, or a positioned image/video layered behind the text.
   */
  const backgroundOf = (el: Element): number[] | undefined => {
    const layers: number[][] = [];
    let prev: Element | null = null;
    for (let cur: Element | null = el; cur; prev = cur, cur = cur.parentElement) {
      const cs = getComputedStyle(cur);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return undefined;
      for (const child of cur.children) {
        if (child === prev || !MEDIA.test(child.tagName)) continue;
        const pos = getComputedStyle(child).position;
        if (pos === 'absolute' || pos === 'fixed') return undefined;
      }
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

  /** False for what the browser skips: inside `display: none`, or folded away (a closed `<details>`). */
  const shown = (e: Element): boolean => {
    const check = (e as Element & { checkVisibility?: () => boolean }).checkVisibility;
    return typeof check === 'function' ? check.call(e) : e.getClientRects().length > 0;
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
    if (cs.display === 'none' || cs.visibility === 'hidden' || (w === 0 && h === 0) || !shown(el))
      box.hidden = true;
    if (cs.position === 'absolute' || cs.position === 'fixed' || cs.position === 'sticky')
      box.positioned = true;
    if (cs.display === 'inline') box.inline = true;
    for (let a = el === root ? null : el.parentElement; a && a !== root; a = a.parentElement) {
      if (getComputedStyle(a).overflowX !== 'visible') {
        box.contained = true;
        break;
      }
    }
    const html = el as HTMLElement;
    const clipsX = cs.overflowX !== 'visible' && html.scrollWidth > html.clientWidth + 1;
    const clipsY = cs.overflowY !== 'visible' && html.scrollHeight > html.clientHeight + 1;
    if (clipsX || clipsY) {
      box.clipped = {
        x: clipsX ? html.scrollWidth - html.clientWidth : 0,
        y: clipsY ? html.scrollHeight - html.clientHeight : 0,
      };
    }
    const directText = (e: Element) => {
      let text = '';
      for (const child of e.childNodes) if (child.nodeType === 3) text += child.textContent ?? '';
      return text.trim();
    };
    const contrastOf = (e: Element, style: CSSStyleDeclaration): number | undefined => {
      const fg = parseColor(style.color);
      const bg = backgroundOf(e);
      // Opacity on the element or its ancestors fades the text into its background.
      let opacity = 1;
      for (let a: Element | null = e; a && a !== root.parentElement; a = a.parentElement)
        opacity *= Number(getComputedStyle(a).opacity);
      if (!fg || !bg) return undefined;
      const a = fg[3] * (Number.isFinite(opacity) ? opacity : 1);
      const blended = [0, 1, 2].map((i) => fg[i]! * a + bg[i]! * (1 - a));
      const l1 = luminance(blended);
      const l2 = luminance(bg);
      return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
    };
    const own = directText(el);
    // Text a node generates (a form field's label, a list drawn from site data) sits in elements
    // of its own: the node reports the smallest and the least readable of it.
    const generated: { size: number; contrast: number | undefined; chars: number }[] = [];
    if (!own) {
      for (const inner of el.querySelectorAll('*')) {
        if (inner.closest(`[${attr}]`) !== el) continue;
        const text = directText(inner);
        if (!text) continue;
        const style = getComputedStyle(inner);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        // What isn't shown isn't read: an option list, or content folded away.
        if (/^(option|optgroup)$/i.test(inner.tagName) || !shown(inner)) continue;
        generated.push({
          size: Number.parseFloat(style.fontSize) || 16,
          contrast: contrastOf(inner, style),
          chars: text.length,
        });
      }
    }
    if (generated.length) {
      const known = generated.map((g) => g.contrast).filter((c): c is number => c !== undefined);
      const size = Math.min(...generated.map((g) => g.size));
      box.text = {
        chars: generated.reduce((sum, g) => sum + g.chars, 0),
        fontSize: round(size),
        lineHeight: round(Number.parseFloat(cs.lineHeight) || size * 1.2),
        lines: generated.length,
        bold: false,
        ...(known.length ? { contrast: Math.min(...known) } : {}),
      };
    }
    if (own) {
      const fontSize = Number.parseFloat(cs.fontSize) || 16;
      const lineHeight = Number.parseFloat(cs.lineHeight) || fontSize * 1.2;
      const contrast = contrastOf(el, cs);
      box.text = {
        chars: own.length,
        fontSize: round(fontSize),
        lineHeight: round(lineHeight),
        // Count lines in the content box: padding and borders aren't lines.
        lines: Math.max(
          1,
          Math.round(
            (h -
              (Number.parseFloat(cs.paddingTop) || 0) -
              (Number.parseFloat(cs.paddingBottom) || 0) -
              (Number.parseFloat(cs.borderTopWidth) || 0) -
              (Number.parseFloat(cs.borderBottomWidth) || 0)) /
              lineHeight,
          ),
        ),
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
      tag === 'textarea' ||
      tag === 'summary' ||
      // A form field: the label around its control is the target.
      (tag === 'label' && !!el.querySelector('input, select, textarea'))
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
    if (!box.hidden && !box.positioned && !box.contained) {
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
