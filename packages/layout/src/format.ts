import { lintLayout } from './lint.js';
import type { LayoutBox, LayoutIssue, LayoutSnapshot } from './types.js';

export interface FormatLayoutOptions {
  /** Only this node and its subtree. */
  root?: string;
  /** Levels below the page root (or `root`) to list. Default 3. */
  depth?: number;
  /** Most boxes listed. Default 150. */
  maxBoxes?: number;
  /** Issues to print; computed with `lintLayout` if omitted. */
  issues?: LayoutIssue[];
}

const r = (n: number) => Math.round(n);

function describeBox(b: LayoutBox): string {
  const parts = [`${b.id}  ${r(b.x)},${r(b.y)} ${r(b.w)}×${r(b.h)}`];
  if (b.hidden) parts.push('hidden');
  if (b.positioned) parts.push('positioned');
  if (b.text)
    parts.push(`text ${b.text.fontSize}px ${b.text.lines} line${b.text.lines === 1 ? '' : 's'}`);
  if (b.image)
    parts.push(
      b.image.loaded ? `img ${b.image.naturalWidth}×${b.image.naturalHeight}` : 'img not loaded',
    );
  return parts.join('  ');
}

/**
 * Compact text for agents: one line per box (`id  x,y w×h  …`, indented by nesting), then the
 * layout issues. Boxes are in CSS pixels relative to the page's top-left corner.
 */
export function formatLayout(snapshot: LayoutSnapshot, options: FormatLayoutOptions = {}): string {
  const depth = options.depth ?? 3;
  const max = options.maxBoxes ?? 150;
  const issues = options.issues ?? lintLayout(snapshot);
  const children = new Map<string | null, LayoutBox[]>();
  for (const b of snapshot.boxes) {
    const list = children.get(b.parent);
    if (list) list.push(b);
    else children.set(b.parent, [b]);
  }
  const lines = [
    `layout${snapshot.page ? ` ${snapshot.page}` : ''} at ${snapshot.width}px wide: page height ${r(snapshot.height)}px${
      snapshot.overflowX ? `, content overflows ${r(snapshot.overflowX)}px to the right` : ''
    }`,
  ];
  let count = 0;
  let folded = 0;
  const walk = (b: LayoutBox, level: number) => {
    if (count >= max) {
      folded++;
      return;
    }
    count++;
    lines.push(`${'  '.repeat(level)}${describeBox(b)}`);
    const kids = children.get(b.id) ?? [];
    if (level >= depth) {
      if (kids.length) lines[lines.length - 1] += `  [+${kids.length} children]`;
      return;
    }
    for (const k of kids) walk(k, level + 1);
  };
  const start = options.root
    ? snapshot.boxes.filter((b) => b.id === options.root)
    : (children.get(null) ?? []).flatMap((rootBox) => children.get(rootBox.id) ?? []);
  if (options.root && !start.length) lines.push(`No measured node "${options.root}".`);
  for (const b of start) walk(b, 0);
  if (folded) lines.push(`… ${folded} more boxes not shown (use root/depth to zoom in)`);
  lines.push(
    issues.length
      ? `${issues.length} layout issue${issues.length === 1 ? '' : 's'}:`
      : 'No layout issues found.',
  );
  for (const i of issues)
    lines.push(
      `- [${i.severity}] ${i.rule} ${i.nodeId}: ${i.message}${i.hint ? ` (${i.hint})` : ''}`,
    );
  return lines.join('\n');
}
