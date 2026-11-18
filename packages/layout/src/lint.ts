import type { LayoutBox, LayoutIssue, LayoutSnapshot } from './types.js';

export interface LayoutLintOptions {
  /** Minimum target size for links and buttons (WCAG 2.2 AA: 24). */
  minTarget?: number;
  /** Smallest acceptable font size in px. Default 12. */
  minFontSize?: number;
}

const area = (b: LayoutBox) => b.w * b.h;

function intersection(a: LayoutBox, b: LayoutBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Problems you can only see once a page is laid out: content wider than the page, clipped or
 * overlapping content, tiny text and tap targets, low contrast, broken images.
 */
export function lintLayout(
  snapshot: LayoutSnapshot,
  options: LayoutLintOptions = {},
): LayoutIssue[] {
  const minTarget = options.minTarget ?? 24;
  const minFont = options.minFontSize ?? 12;
  const issues: LayoutIssue[] = [];
  const byId = new Map(snapshot.boxes.map((b) => [b.id, b]));
  const visible = snapshot.boxes.filter((b) => !b.hidden);
  const limit = snapshot.width + 1;

  // WCAG 2.5.8 spacing exception: an undersized target passes if a circle of the minimum size
  // centred on it touches no other target (and no other undersized target's circle).
  const targets = visible.filter((b) => b.interactive && b.w > 0 && b.h > 0);
  const small = (b: LayoutBox) => b.w < minTarget || b.h < minTarget;
  const center = (b: LayoutBox) => [b.x + b.w / 2, b.y + b.h / 2] as const;
  const related = (a: LayoutBox, b: LayoutBox) => {
    for (let p = a.parent; p; p = byId.get(p)?.parent ?? null) if (p === b.id) return true;
    for (let p = b.parent; p; p = byId.get(p)?.parent ?? null) if (p === a.id) return true;
    return false;
  };
  const crowded = (t: LayoutBox) => {
    const [cx, cy] = center(t);
    const r = minTarget / 2;
    return targets.some((o) => {
      if (o === t || related(o, t)) return false;
      const nx = Math.max(o.x, Math.min(cx, o.x + o.w));
      const ny = Math.max(o.y, Math.min(cy, o.y + o.h));
      if ((nx - cx) ** 2 + (ny - cy) ** 2 < r * r) return true;
      if (!small(o)) return false;
      const [ox, oy] = center(o);
      return (ox - cx) ** 2 + (oy - cy) ** 2 < minTarget * minTarget;
    });
  };

  for (const b of visible) {
    const parent = b.parent ? byId.get(b.parent) : undefined;
    // Report only the outermost box that sticks out, not every descendant of it.
    if (b.x + b.w > limit && !(parent && !parent.hidden && parent.x + parent.w > limit)) {
      const over = Math.round(b.x + b.w - snapshot.width);
      issues.push({
        rule: 'horizontal-overflow',
        severity: 'error',
        nodeId: b.id,
        message: `${b.id} extends ${over}px past the right edge of the ${snapshot.width}px page (it is ${Math.round(b.w)}px wide).`,
        hint: b.text
          ? 'Long words or fixed widths: use a smaller font size at this breakpoint, or let it wrap (overflow-wrap: anywhere).'
          : 'Check fixed widths, min-width and grid columns at this breakpoint.',
      });
    }
    if (b.clipped && (b.clipped.x > 2 || b.clipped.y > 2)) {
      issues.push({
        rule: 'clipped-content',
        severity: 'warning',
        nodeId: b.id,
        message: `${b.id} hides ${b.clipped.y > 2 ? `${Math.round(b.clipped.y)}px of content below` : `${Math.round(b.clipped.x)}px of content to the right`} (overflow is clipped).`,
        hint: 'Remove the fixed height/width or the overflow setting, or shorten the content.',
      });
    }
    if (b.text && b.text.fontSize < minFont) {
      issues.push({
        rule: 'small-text',
        severity: 'warning',
        nodeId: b.id,
        message: `${b.id} text is ${b.text.fontSize}px; anything under ${minFont}px is hard to read.`,
      });
    }
    if (b.interactive && (b.w < minTarget || b.h < minTarget) && b.w > 0 && b.h > 0 && crowded(b)) {
      issues.push({
        rule: 'tap-target',
        severity: 'warning',
        nodeId: b.id,
        message: `${b.id} is ${Math.round(b.w)}×${Math.round(b.h)}px; tap targets should be at least ${minTarget}×${minTarget}px.`,
        hint: 'Add padding (e.g. padding-block: var(--space-xs)).',
      });
    }
    if (b.text?.contrast !== undefined) {
      const large = b.text.fontSize >= 24 || (b.text.bold && b.text.fontSize >= 18.66);
      const needed = large ? 3 : 4.5;
      if (b.text.contrast < needed) {
        issues.push({
          rule: 'contrast',
          severity: b.text.contrast < needed - 1 ? 'error' : 'warning',
          nodeId: b.id,
          message: `${b.id} text contrast is ${b.text.contrast}:1; ${large ? 'large ' : ''}text needs at least ${needed}:1.`,
          hint: 'Use a darker text colour or a lighter background token (or the reverse on dark backgrounds).',
        });
      }
    }
    if (b.image && !b.image.loaded) {
      issues.push({
        rule: 'image-missing',
        severity: 'warning',
        nodeId: b.id,
        message: `${b.id} image did not load.`,
        hint: 'Check the src URL.',
      });
    }
    if (
      !b.positioned &&
      b.h === 0 &&
      b.w > 0 &&
      snapshot.boxes.some((c) => c.parent === b.id && !c.hidden && c.h > 0)
    ) {
      issues.push({
        rule: 'collapsed',
        severity: 'info',
        nodeId: b.id,
        message: `${b.id} has zero height although it has visible children (they overflow it).`,
      });
    }
  }

  // Overlapping in-flow siblings usually means negative margins or broken grid placement.
  const siblings = new Map<string, LayoutBox[]>();
  for (const b of visible) {
    if (b.positioned || !b.parent || area(b) === 0) continue;
    const list = siblings.get(b.parent);
    if (list) list.push(b);
    else siblings.set(b.parent, [b]);
  }
  for (const list of siblings.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        const overlap = intersection(a, b);
        if (overlap > 0.25 * Math.min(area(a), area(b))) {
          issues.push({
            rule: 'overlap',
            severity: 'warning',
            nodeId: b.id,
            message: `${b.id} overlaps ${a.id}.`,
            hint: 'Check negative margins, fixed heights and grid placement.',
          });
        }
      }
    }
  }
  const order: Record<string, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity]! - order[b.severity]!);
}
