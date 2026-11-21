import { ancestors, type DocView, descendants, pageNodes, sectionRootOf } from './doc.js';
import { untranslatedProps } from './l10n.js';
import { describeNesting, nestingProblemAt } from './nesting.js';
import { type Registry, templateParts } from './registry.js';
import { richTextToPlain } from './richtext.js';
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

/** A node's visible text: `text`, or the plain text of rich text. */
const textOf = (n: BNode) =>
  n.type === 'rich-text' ? richTextToPlain(str(n.props.html)) : str(n.props.text);

/** Whether a node's subtree has text, a label or an image with alt text to name it by. */
function hasAccessibleContent(view: DocView, id: string): boolean {
  return descendants(view, id).some(
    (d) =>
      textOf(d).trim() !== '' ||
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

/** A form's own checks: where it goes, whether it can be sent, and fields that would collide. */
function lintForm(view: DocView, form: BNode, issues: LintIssue[]): void {
  const action = str(form.props.action).trim();
  if (!action) {
    issues.push({
      rule: 'form-action',
      severity: 'info',
      nodeId: form.id,
      message: `Form "${form.id}" doesn't send its fields anywhere yet (no action).`,
      hint: 'Set "action" to the URL that receives the form.',
    });
  } else if (isUnsafeUrl(action, 'href') || /^(mailto|tel):/i.test(action)) {
    issues.push({
      rule: 'unsafe-url',
      severity: 'error',
      nodeId: form.id,
      message: `Form "${form.id}" has an action that won't work: "${action}".`,
      hint: 'Use an https:// URL or a /path on this site.',
    });
  }
  const inside = descendants(view, form.id);
  if (!inside.some((n) => n.type === 'button' && n.props.type === 'submit')) {
    issues.push({
      rule: 'form-submit',
      severity: 'warning',
      nodeId: form.id,
      message: `Form "${form.id}" has no submit button.`,
      hint: 'Add a button with "type": "submit" inside it.',
    });
  }
  const names = new Map<string, BNode>();
  for (const f of inside) {
    if (f.type !== 'field') continue;
    const name = str(f.props.name);
    const earlier = names.get(name);
    if (!earlier) names.set(name, f);
    // Checkboxes may share a name on purpose: every ticked one is sent ("topics[]").
    else if (!(earlier.props.type === 'checkbox' && f.props.type === 'checkbox')) {
      issues.push({
        rule: 'field-name',
        severity: 'warning',
        nodeId: f.id,
        message: `Fields "${earlier.id}" and "${f.id}" are both sent as "${name}", so one answer hides the other.`,
        hint: 'Give each field its own "name".',
      });
    }
  }
}

/**
 * Document-level checks that don't need a browser: accessibility basics, broken or placeholder
 * links, forms that can't be sent, and example copy left over from section templates.
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

  const headings = nodes.filter(
    (n) => (n.type === 'text' || n.type === 'rich-text') && HEADING.test(str(n.props.tag)),
  );
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
    if (n.type === 'rich-text' && !richTextToPlain(str(n.props.html)).trim()) {
      issues.push({
        rule: 'empty-text',
        severity: 'warning',
        nodeId: n.id,
        message: `"${n.id}" has no text.`,
      });
    }
    if ((n.type === 'text' || n.type === 'button') && !str(n.props.text).trim()) {
      issues.push({
        rule: 'empty-text',
        severity: 'warning',
        nodeId: n.id,
        message: `"${n.id}" has no text.`,
      });
    }
    // Translated URLs are rendered (and blocked) like the default ones.
    for (const [locale, values] of Object.entries(n.l10n ?? {})) {
      for (const attr of ['href', 'src'] as const) {
        const url = str(values[attr]).trim();
        if (url && isUnsafeUrl(url, attr)) {
          issues.push({
            rule: 'unsafe-url',
            severity: 'error',
            nodeId: n.id,
            message: `"${n.id}" has a "${locale}" ${attr} with a URL scheme that will be blocked: "${url}".`,
          });
        }
      }
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
    if (n.type === 'icon' && !registry.icon(str(n.props.name))) {
      issues.push({
        rule: 'unknown-icon',
        severity: 'warning',
        nodeId: n.id,
        message: `Icon "${n.id}" names "${str(n.props.name)}", which isn't in this site's icon set, so nothing shows.`,
      });
    }
    if (n.type === 'details') {
      const first = view.children(n.id)[0];
      if (first?.type !== 'text' || first.props.tag !== 'summary') {
        issues.push({
          rule: 'details-summary',
          severity: 'warning',
          nodeId: n.id,
          message: `Accordion item "${n.id}" doesn't start with a summary, so browsers label it "Details".`,
          hint: 'Make its first child a text with tag "summary".',
        });
      }
    }
    if (n.type === 'text' && n.props.tag === 'summary') {
      const parent = n.parent ? view.node(n.parent) : undefined;
      if (parent?.type !== 'details' || view.children(parent.id)[0]?.id !== n.id) {
        issues.push({
          rule: 'details-summary',
          severity: 'warning',
          nodeId: n.id,
          message: `"${n.id}" is a summary, which only works as the first child of a details node.`,
          hint: 'Move it there, or change its tag (e.g. to p).',
        });
      }
    }
    // The store refuses these; a document loaded from elsewhere may still hold them.
    const nested = nestingProblemAt(view, n);
    if (nested) {
      issues.push({ rule: 'nesting', severity: 'error', nodeId: n.id, ...describeNesting(nested) });
    }
    if (n.type === 'form') lintForm(view, n, issues);
    if (n.type === 'field') {
      if (n.props.type !== 'hidden' && !str(n.props.label).trim()) {
        issues.push({
          rule: 'field-label',
          severity: 'error',
          nodeId: n.id,
          message: `Field "${n.id}" has no label, so nobody (and no screen reader) knows what to enter.`,
          hint: 'Set its "label" prop; a placeholder is not a label.',
        });
      }
      if (!ancestors(view, n.id).some((a) => a.type === 'form')) {
        issues.push({
          rule: 'field-outside-form',
          severity: 'warning',
          nodeId: n.id,
          message: `Field "${n.id}" isn't inside a form, so what people enter is sent nowhere.`,
          hint: 'Move it into a form node.',
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
  // Translations: content in the default language that a site language doesn't have yet.
  const locales = view.locales?.();
  for (const locale of locales?.others ?? []) {
    const missing: string[] = [];
    for (const n of nodes) {
      const content = registry.component(n.type)?.contentProps ?? [];
      if (untranslatedProps(n, content, locale).length) missing.push(n.id);
    }
    if (missing.length) {
      issues.push({
        rule: 'missing-translation',
        severity: 'warning',
        nodeId: missing[0],
        message: `${missing.length} text${missing.length === 1 ? ' has' : 's have'} no "${locale}" translation: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''}.`,
        hint: `Set them with props.set and "locale": "${locale}".`,
      });
    }
  }
  const order: Record<LintSeverity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}
