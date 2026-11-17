import { deepEqualJson, lintPage, type SiteDoc, type Store } from './deps.js';
import type { Check, CheckResult } from './types.js';

const inSubtree = (id: string, roots: string[]) =>
  roots.some((r) => id === r || id.startsWith(`${r}/`));

/** Runs one deterministic check against the final document. */
export function runCheck(check: Check, store: Store, start: SiteDoc): CheckResult {
  const doc = store.doc;
  const view = store.view;
  const result = (passed: boolean, message: string): CheckResult => ({ check, passed, message });
  const text = (id: string) => {
    const v = doc.nodes[id]?.props.text;
    return typeof v === 'string' ? v : undefined;
  };

  switch (check.type) {
    case 'sectionOrder': {
      const page = doc.pages[check.page];
      if (!page) return result(false, `No page "${check.page}".`);
      const actual = view
        .children(page.rootId)
        .filter((n) => n.section)
        .map((n) => n.section!.name);
      return result(
        deepEqualJson(actual, check.sections),
        `sections: ${actual.join(', ') || '(none)'}`,
      );
    }
    case 'variant': {
      const actual = doc.nodes[check.id]?.section?.variant;
      const ok = !!actual && Object.entries(check.variant).every(([k, v]) => actual[k] === v);
      return result(ok, `variant: ${JSON.stringify(actual ?? null)}`);
    }
    case 'textIncludes': {
      const t = text(check.id);
      return result(
        !!t && check.anyOf.some((s) => t.includes(s)),
        `text: ${JSON.stringify(t ?? null)}`,
      );
    }
    case 'propEquals': {
      const v = doc.nodes[check.id]?.props[check.prop];
      return result(deepEqualJson(v, check.value), `${check.prop}: ${JSON.stringify(v ?? null)}`);
    }
    case 'lastChildText': {
      const last = view.children(check.id).at(-1);
      const t = last && typeof last.props.text === 'string' ? last.props.text : undefined;
      return result(
        t === check.value,
        `last child: ${last?.id ?? '(none)'} ${JSON.stringify(t ?? null)}`,
      );
    }
    case 'exists':
      return result(!!doc.nodes[check.id], doc.nodes[check.id] ? 'exists' : 'missing');
    case 'notExists':
      return result(!doc.nodes[check.id], doc.nodes[check.id] ? 'still exists' : 'gone');
    case 'hasPart':
    case 'lacksPart': {
      const has = view.children(check.parent).some((n) => n.part === check.part);
      return result(
        check.type === 'hasPart' ? has : !has,
        `${check.parent} ${has ? 'has' : 'has no'} ${check.part}`,
      );
    }
    case 'noPlaceholderText': {
      const leftovers = lintPage(view, store.registry, Object.keys(doc.pages)[0] ?? 'home')
        .filter((i) => i.rule === 'template-text' && i.nodeId && check.ids.includes(i.nodeId))
        .map((i) => i.nodeId!);
      return result(
        !leftovers.length,
        leftovers.length ? `template text left in ${leftovers.join(', ')}` : 'ok',
      );
    }
    case 'unchangedExcept': {
      const changed: string[] = [];
      const ids = new Set([...Object.keys(start.nodes), ...Object.keys(doc.nodes)]);
      for (const id of ids) {
        if (inSubtree(id, check.ids)) continue;
        if (!deepEqualJson(start.nodes[id], doc.nodes[id])) changed.push(id);
      }
      return result(
        !changed.length,
        changed.length ? `also changed: ${changed.slice(0, 10).join(', ')}` : 'ok',
      );
    }
    case 'noLintErrors': {
      const pages = check.page ? [check.page] : Object.keys(doc.pages);
      const errors = pages
        .flatMap((p) => lintPage(view, store.registry, p))
        .filter((i) => i.severity === 'error');
      return result(!errors.length, errors.length ? errors.map((e) => e.message).join(' ') : 'ok');
    }
  }
}
