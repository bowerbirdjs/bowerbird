import { type DocView, descendants, pageNodes, sectionRootOf } from './doc.js';
import { type Registry, templateParts } from './registry.js';
import type { BNode, PageId } from './types.js';
import { isUnsafeUrl } from './url.js';

export type LintSeverity = 'error' | 'warning' | 'info';

export interface LintIssue {
  rule: string;
  severity: LintSeverity;
  message: string;
  nodeId?: string;
  hint?: string;
}

const HEADING = /^h([1-6])$/;

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Whether a node's subtree has text, a label or an image with alt text to name it by. */
function hasAccessibleContent(view: DocView, id: string): boolean {
  return descendants(view, id).some(
    (d) =>
      str(d.props.text).trim() !== '' ||
      str(d.props.label).trim() !== '' ||
      (d.type === 'image' && str(d.props.alt).trim() !== ''),
  );
}

/** Example copy each section part starts with, keyed by node id. */
function templateCopy(registry: Registry, nodes: BNode[]): Map<string, string> {
  const copy = new Map<string, string>();
  for (const root of nodes) {
    if (!root.section) continue;
    const def = registry.section(root.section.name);
    if (!def) continue;
    for (const part of templateParts(def, root.section.variant)) {
      const text = part.input.props?.text;
      if (typeof text === 'string' && text) copy.set(`${root.id}/${part.path}`, text);
    }
  }
  return copy;
}

/**
 * Document-level checks that don't need a browser: accessibility basics, broken or placeholder
 * links, and example copy left over from section templates.
 */
export function lintPage(view: DocView, registry: Registry, pageId: PageId): LintIssue[] {
  const page = view.page(pageId);
  if (!page) return [{ rule: 'page', severity: 'error', message: `No page "${pageId}".` }];
  const issues: LintIssue[] = [];
  const nodes = pageNodes(view, pageId);

  if (!page.title.trim()) {
    issues.push({ rule: 'page-title', severity: 'warning', message: 'The page has no title.' });
  }
  if (!page.description?.trim()) {
    issues.push({
      rule: 'page-description',
      severity: 'info',
      message: 'The page has no description (used by search engines and link previews).',
      hint: 'Set one with page.update.',
    });
  }

  const headings = nodes.filter((n) => n.type === 'text' && HEADING.test(str(n.props.tag)));
  const h1s = headings.filter((n) => n.props.tag === 'h1');
  if (!h1s.length && nodes.length > 1) {
    issues.push({ rule: 'single-h1', severity: 'warning', message: 'The page has no h1 heading.' });
  }
  for (const extra of h1s.slice(1)) {
    issues.push({
      rule: 'single-h1',
      severity: 'warning',
      nodeId: extra.id,
      message: `"${extra.id}" is a second h1; a page should have one.`,
      hint: 'Change its tag to h2.',
    });
  }
  let previous = 0;
  for (const h of headings) {
    const level = Number(HEADING.exec(str(h.props.tag))![1]);
    if (previous && level > previous + 1) {
      issues.push({
        rule: 'heading-order',
        severity: 'warning',
        nodeId: h.id,
        message: `"${h.id}" is an h${level} after an h${previous}; heading levels shouldn't skip.`,
        hint: `Use h${previous + 1}.`,
      });
    }
    previous = level;
  }

  const copy = templateCopy(registry, nodes);
  for (const n of nodes) {
    if ((n.type === 'text' || n.type === 'button') && !str(n.props.text).trim()) {
      issues.push({
        rule: 'empty-text',
        severity: 'warning',
        nodeId: n.id,
        message: `"${n.id}" has no text.`,
      });
    }
    if (n.type === 'link') {
      const href = str(n.props.href).trim();
      if (
        !str(n.props.text).trim() &&
        !str(n.props.label).trim() &&
        !hasAccessibleContent(view, n.id)
      ) {
        issues.push({
          rule: 'link-name',
          severity: 'error',
          nodeId: n.id,
          message: `Link "${n.id}" has no text or label, so screen readers can't announce it.`,
        });
      }
      if (!href || href === '#') {
        issues.push({
          rule: 'placeholder-link',
          severity: 'info',
          nodeId: n.id,
          message: `Link "${n.id}" doesn't go anywhere yet (href "${href || ''}").`,
        });
      } else if (isUnsafeUrl(href, 'href')) {
        issues.push({
          rule: 'unsafe-url',
          severity: 'error',
          nodeId: n.id,
          message: `Link "${n.id}" uses a URL scheme that will be blocked: "${href}".`,
        });
      }
    }
    if (n.type === 'image') {
      if (!str(n.props.alt).trim()) {
        issues.push({
          rule: 'image-alt',
          severity: 'info',
          nodeId: n.id,
          message: `Image "${n.id}" has empty alt text; that's only right for decorative images.`,
        });
      }
      const src = str(n.props.src).trim();
      if (isUnsafeUrl(src, 'src')) {
        issues.push({
          rule: 'unsafe-url',
          severity: 'error',
          nodeId: n.id,
          message: `Image "${n.id}" uses a URL scheme that will be blocked.`,
        });
      }
    }
    const example = copy.get(n.id);
    if (example && str(n.props.text) === example) {
      const section = sectionRootOf(view, n.id);
      issues.push({
        rule: 'template-text',
        severity: 'info',
        nodeId: n.id,
        message: `"${n.id}" still shows the ${section?.section?.name ?? 'section'} template's example text.`,
      });
    }
  }
  const order: Record<LintSeverity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
