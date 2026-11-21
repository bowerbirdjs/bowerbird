import {
  type BNode,
  createStore,
  deepEqualJson,
  descendants,
  findRawValue,
  getTokenLeaf,
  lintPage,
  pageNodes,
  richTextToPlain,
  type SiteDoc,
  type Store,
  toCssValue,
} from './deps.js';
import type { Check, CheckResult, Count, NodeQuery } from './types.js';

/**
 * Whether a node is one of `roots` or inside one, by the tree (ids only nest under sections and
 * keyed items), in the document it started in or the one it ended up in.
 */
function inSubtree(id: string, roots: string[], docs: SiteDoc[]): boolean {
  if (!roots.length) return false;
  const allowed = new Set(roots);
  // In every document that has the node: one moved out of (or into) an allowed subtree changed
  // something outside it.
  const holding = docs.filter((doc) => doc.nodes[id]);
  return (
    holding.length > 0 &&
    holding.every((doc) => {
      for (let cur: string | null = id, n = 0; cur && n < 100; n++) {
        if (allowed.has(cur)) return true;
        cur = doc.nodes[cur]?.parent ?? null;
      }
      return false;
    })
  );
}

const within = (n: number, count: Count = { min: 1 }) =>
  (count.equals === undefined || n === count.equals) &&
  (count.min === undefined || n >= count.min) &&
  (count.max === undefined || n <= count.max);

const describeCount = (count: Count = { min: 1 }) =>
  count.equals !== undefined
    ? `exactly ${count.equals}`
    : [
        count.min !== undefined ? `at least ${count.min}` : '',
        count.max !== undefined ? `at most ${count.max}` : '',
      ]
        .filter(Boolean)
        .join(' and ');

/** Values compared the way CSS does for these checks: case and spacing don't matter. */
const css = (value: string) =>
  value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),/])\s*/g, '$1')
    .trim();

/** A page by id or by path (`/about`): tasks can't know the id an agent gives a new page. */
function pageBy(store: Store, idOrPath: string) {
  const pages = store.doc.pages;
  if (Object.hasOwn(pages, idOrPath)) return pages[idOrPath];
  const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p).toLowerCase();
  return idOrPath.startsWith('/')
    ? Object.values(pages).find((p) => norm(p.path) === norm(idOrPath))
    : undefined;
}

/** A subtree in page order (a node, then its children in order). */
function ordered(store: Store, rootId: string): BNode[] {
  const root = store.view.node(rootId);
  if (!root) return [];
  const out: BNode[] = [];
  const walk = (n: BNode) => {
    out.push(n);
    for (const child of store.view.children(n.id)) walk(child);
  };
  walk(root);
  return out;
}
const oneOf = (actual: string | undefined, wanted: string | string[]) =>
  actual !== undefined && [wanted].flat().some((w) => css(w) === css(actual));

const textOf = (n: BNode): string =>
  n.type === 'rich-text'
    ? richTextToPlain(typeof n.props.html === 'string' ? n.props.html : '')
    : typeof n.props.text === 'string'
      ? n.props.text
      : '';

/** Whether a node is what a query describes (`root` and `page` are scopes, checked by the caller). */
function matches(n: BNode, q: NodeQuery): boolean {
  if (q.type !== undefined && n.type !== q.type) return false;
  if (q.section !== undefined && n.section?.name !== q.section) return false;
  if (q.part !== undefined && n.part !== q.part) return false;
  for (const [key, value] of Object.entries(q.props ?? {}))
    if (!deepEqualJson(n.props[key], value)) return false;
  if (
    q.textIncludes !== undefined &&
    !textOf(n).toLowerCase().includes(q.textIncludes.toLowerCase())
  )
    return false;
  return true;
}

/** The nodes a query picks, in page order. */
function find(store: Store, q: NodeQuery): BNode[] {
  const page = q.page !== undefined ? pageBy(store, q.page) : undefined;
  if (q.page !== undefined && !page) return [];
  let pool: BNode[];
  if (q.root !== undefined) pool = ordered(store, q.root);
  else if (page) pool = ordered(store, page.rootId);
  else pool = Object.values(store.doc.pages).flatMap((p) => ordered(store, p.rootId));
  if (q.root !== undefined && page) {
    const onPage = new Set(ordered(store, page.rootId).map((n) => n.id));
    pool = pool.filter((n) => onPage.has(n.id));
  }
  return pool.filter((n) => matches(n, q));
}

/** Runs one deterministic check against the final document. */
export function runCheck(check: Check, store: Store, start: SiteDoc): CheckResult {
  const doc = store.doc;
  const view = store.view;
  const result = (passed: boolean, message: string): CheckResult => ({ check, passed, message });
  const text = (id: string) => {
    const v = doc.nodes[id]?.props.text;
    return typeof v === 'string' ? v : undefined;
  };
  const baseBp = doc.breakpoints[0]?.id ?? 'base';

  switch (check.type) {
    case 'sectionOrder': {
      const page = pageBy(store, check.page);
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
    case 'pageChildren': {
      const page = pageBy(store, check.page);
      if (!page) return result(false, `No page "${check.page}".`);
      const actual = view.children(page.rootId).map((n) => n.section?.name ?? n.type);
      return result(
        deepEqualJson(actual, check.kinds),
        `children: ${actual.join(', ') || '(none)'}`,
      );
    }
    case 'pageExists': {
      const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p).toLowerCase();
      const page = Object.values(doc.pages).find((p) => norm(p.path) === norm(check.path));
      if (!page)
        return result(
          false,
          `no page at ${check.path}; pages: ${Object.values(doc.pages)
            .map((p) => p.path)
            .join(', ')}`,
        );
      const wrong = [
        check.title !== undefined &&
          page.title !== check.title &&
          `title ${JSON.stringify(page.title)}`,
        check.description !== undefined &&
          page.description !== check.description &&
          `description ${JSON.stringify(page.description ?? null)}`,
      ].filter(Boolean);
      return result(!wrong.length, wrong.length ? wrong.join(', ') : `page ${page.id}`);
    }
    case 'variant': {
      const target = check.id ?? (check.query ? find(store, check.query)[0]?.id : undefined);
      const actual = target ? doc.nodes[target]?.section?.variant : undefined;
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
    case 'textMatches': {
      const v = doc.nodes[check.id]?.props[check.prop ?? 'text'];
      const ok = typeof v === 'string' && new RegExp(check.pattern, check.flags).test(v);
      return result(ok, `${check.prop ?? 'text'}: ${JSON.stringify(v ?? null)}`);
    }
    case 'propEquals': {
      const v = doc.nodes[check.id]?.props[check.prop];
      return result(deepEqualJson(v, check.value), `${check.prop}: ${JSON.stringify(v ?? null)}`);
    }
    case 'propNot': {
      const node = doc.nodes[check.id];
      const v = node?.props[check.prop];
      return result(
        !!node && v !== undefined && !deepEqualJson(v, check.value),
        node ? `${check.prop}: ${JSON.stringify(v ?? null)}` : 'missing',
      );
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
    case 'childCount': {
      if (!doc.nodes[check.id]) return result(false, `no node ${check.id}`);
      const n = view.children(check.id).length;
      return result(within(n, check.count), `${n} children (wanted ${describeCount(check.count)})`);
    }
    case 'find': {
      const found = find(store, check.query);
      return result(
        within(found.length, check.count),
        `${found.length} found${
          found.length
            ? `: ${found
                .slice(0, 5)
                .map((n) => n.id)
                .join(', ')}`
            : ''
        } (wanted ${describeCount(check.count)})`,
      );
    }
    case 'children': {
      if (!doc.nodes[check.id]) return result(false, `no node ${check.id}`);
      const kids = view.children(check.id);
      const wrong = check.sequence.findIndex((q, i) => !kids[i] || !matches(kids[i], q));
      const ok = kids.length === check.sequence.length && wrong < 0;
      return result(
        ok,
        ok
          ? 'ok'
          : `children: ${kids.map((k) => k.id).join(', ') || '(none)'}${
              wrong >= 0 ? `; child ${wrong + 1} doesn't match` : ''
            }`,
      );
    }
    case 'texts': {
      const actual = find(store, check.query).map(textOf);
      return result(deepEqualJson(actual, check.equals), `texts: ${JSON.stringify(actual)}`);
    }
    case 'noPlaceholderText': {
      const missing = check.ids.filter((id) => !doc.nodes[id]);
      if (missing.length) return result(false, `missing: ${missing.join(', ')}`);
      const leftovers = Object.keys(doc.pages)
        .flatMap((page) => lintPage(view, store.registry, page))
        .filter((i) => i.rule === 'template-text' && i.nodeId && check.ids.includes(i.nodeId))
        .map((i) => i.nodeId!);
      return result(
        !leftovers.length,
        leftovers.length ? `template text left in ${leftovers.join(', ')}` : 'ok',
      );
    }
    case 'noPlaceholderIn': {
      const page = pageBy(store, check.page);
      if (!page) return result(false, `No page "${check.page}".`);
      const roots = pageNodes(view, page.id).filter(
        (n) => n.section && check.sections.includes(n.section.name),
      );
      const absent = check.sections.filter((s) => !roots.some((r) => r.section!.name === s));
      if (absent.length) return result(false, `no ${absent.join(', ')} section on the page`);
      const inside = new Set(roots.flatMap((r) => descendants(view, r.id).map((n) => n.id)));
      const leftovers = lintPage(view, store.registry, page.id)
        .filter((i) => i.rule === 'template-text' && i.nodeId && inside.has(i.nodeId))
        .map((i) => i.nodeId!)
        .filter((id) => !check.parts || check.parts.includes(doc.nodes[id]?.part ?? ''));
      return result(
        !leftovers.length,
        leftovers.length ? `template text left in ${leftovers.slice(0, 8).join(', ')}` : 'ok',
      );
    }
    case 'unchangedExcept': {
      const allow = new Set(check.allow ?? []);
      const changed: string[] = [];
      const ids = new Set([...Object.keys(start.nodes), ...Object.keys(doc.nodes)]);
      // New pages bring their roots and content; with `pages` allowed, those are not surprises.
      const newPageNodes = new Set(
        allow.has('pages')
          ? Object.values(doc.pages)
              .filter((p) => !start.pages[p.id])
              .flatMap((p) => pageNodes(view, p.id).map((n) => n.id))
          : [],
      );
      for (const id of ids) {
        const before = start.nodes[id];
        const after = doc.nodes[id];
        // An allowed node may change, but not leave for a place outside what is allowed.
        const movedOut =
          !!before &&
          !!after &&
          before.parent !== after.parent &&
          !(after.parent && inSubtree(after.parent, check.ids, [doc]));
        if (movedOut) {
          changed.push(`${id} (moved)`);
          continue;
        }
        if (inSubtree(id, check.ids, [start, doc]) || newPageNodes.has(id)) continue;
        if (allow.has('created') && !before) continue;
        // Translations are kept on the nodes they translate.
        if (allow.has('locales') && before && after) {
          const { l10n: _a, edited: _b, ...x } = before;
          const { l10n: _c, edited: _d, ...y } = after;
          if (deepEqualJson(x, y)) continue;
        }
        if (!deepEqualJson(before, after)) changed.push(id);
      }
      if (!allow.has('tokens')) {
        if (!deepEqualJson(start.tokens, doc.tokens)) changed.push('(design tokens)');
        if (!deepEqualJson(start.themes, doc.themes)) changed.push('(themes)');
      }
      if (!allow.has('pages') && !deepEqualJson(start.pages, doc.pages))
        changed.push('(page settings)');
      if (!allow.has('locales') && !deepEqualJson(start.locales, doc.locales))
        changed.push('(languages)');
      if (!allow.has('symbols') && !deepEqualJson(start.symbols, doc.symbols))
        changed.push('(linked components)');
      if (!deepEqualJson(start.data, doc.data)) changed.push('(site data)');
      if (!deepEqualJson(start.breakpoints, doc.breakpoints)) changed.push('(breakpoints)');
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
    case 'styleEquals':
    case 'styleAbsent': {
      const node = doc.nodes[check.id];
      if (!node) return result(false, `no node ${check.id}`);
      const where = `${check.bp ?? baseBp}${check.state ? `:${check.state}` : ''}`;
      const actual = node.styles?.[check.bp ?? baseBp]?.[check.state ?? 'default']?.[check.prop];
      const shown = `${check.prop} at ${where}: ${actual ?? '(not set)'}`;
      if (check.type === 'styleAbsent') return result(actual === undefined, shown);
      return result(oneOf(actual, check.value), shown);
    }
    case 'varEquals': {
      const node = doc.nodes[check.id];
      if (!node) return result(false, `no node ${check.id}`);
      const actual = node.vars?.[check.name];
      return result(oneOf(actual, check.value), `${check.name}: ${actual ?? '(not set)'}`);
    }
    case 'tokenEquals': {
      let actual: string | undefined;
      if (check.theme) actual = doc.themes[check.theme]?.[check.path];
      else {
        const leaf = getTokenLeaf(doc.tokens, check.path);
        actual = leaf
          ? toCssValue(leaf.$value, typeof leaf.$type === 'string' ? leaf.$type : undefined)
          : undefined;
      }
      // A theme value may be written as an alias or as the variable it compiles to.
      const same = (a: string, b: string) =>
        css(a) === css(b) ||
        css(
          a.replace(/\{([^{}]+)\}/g, (_, p: string) => `var(--${p.trim().split('.').join('-')})`),
        ) === css(b);
      const ok =
        actual !== undefined &&
        [check.value].flat().some((w) => same(w, actual!) || same(actual!, w));
      return result(
        ok,
        `${check.path}${check.theme ? ` (${check.theme})` : ''}: ${actual ?? '(not set)'}`,
      );
    }
    case 'noRawValues': {
      const raw: string[] = [];
      for (const n of Object.values(doc.nodes)) {
        for (const states of Object.values(n.styles ?? {}))
          for (const decls of Object.values(states))
            for (const [prop, value] of Object.entries(decls))
              if (findRawValue(prop, value)) raw.push(`${n.id} ${prop}: ${value}`);
        for (const [name, value] of Object.entries(n.vars ?? {}))
          if (findRawValue(name, value)) raw.push(`${n.id} ${name}: ${value}`);
      }
      return result(!raw.length, raw.length ? `raw values: ${raw.slice(0, 5).join('; ')}` : 'ok');
    }
    case 'localeExists': {
      const all = doc.locales ? [doc.locales.default, ...doc.locales.others] : ['en'];
      return result(all.includes(check.locale), `languages: ${all.join(', ')}`);
    }
    case 'translated': {
      const prop = check.prop ?? 'text';
      const missing = check.ids.filter((id) => {
        const node = doc.nodes[id];
        const translation = node?.l10n?.[check.locale]?.[prop];
        return (
          typeof translation !== 'string' ||
          !translation.trim() ||
          translation === node?.props[prop]
        );
      });
      return result(
        !missing.length,
        missing.length ? `no ${check.locale} ${prop} for ${missing.join(', ')}` : 'ok',
      );
    }
    case 'linked': {
      const symbols = new Set<string>();
      for (const q of check.queries) {
        const found = find(store, q);
        if (found.length !== 1)
          return result(false, `${JSON.stringify(q)} matches ${found.length} nodes (wanted one)`);
        const link = found[0]!.link;
        // The instance root points at the definition's root.
        if (!link || doc.symbols?.[link.symbol]?.rootId !== link.node)
          return result(false, `${found[0]!.id} is not an instance of a linked component`);
        symbols.add(link.symbol);
      }
      if (symbols.size !== 1)
        return result(false, `instances of different components: ${[...symbols].join(', ')}`);
      const symbol = doc.symbols?.[[...symbols][0]!];
      const named = check.symbolName === undefined || symbol?.name === check.symbolName;
      return result(named, `linked component ${symbol?.id} ${JSON.stringify(symbol?.name)}`);
    }
    case 'proposals': {
      const open = store.changesets.filter((c) => c.status.includes('open'));
      const about = (c: (typeof open)[number]) =>
        c.ops.some((op, i) => {
          if (c.status[i] !== 'open') return false;
          const o = op as Record<string, unknown>;
          return (
            (check.op === undefined || o.op === check.op) &&
            (check.id === undefined || o.id === check.id) &&
            (check.section === undefined || o.section === check.section)
          );
        });
      const wanted =
        check.op !== undefined || check.id !== undefined || check.section !== undefined;
      // What the page would be if a person accepted the proposal: tried on a copy.
      const accepted = (c: (typeof open)[number]): boolean => {
        if (!check.whenAccepted) return true;
        const trial = createStore({ registry: store.registry, doc: structuredClone(doc) });
        const res = trial.apply({
          actor: { kind: 'user', id: 'reviewer' },
          ops: c.ops.filter((_, i) => c.status[i] === 'open'),
        });
        return res.ok && check.whenAccepted.every((inner) => runCheck(inner, trial, start).passed);
      };
      const ok =
        within(open.length, check.count) &&
        (!wanted || open.some(about)) &&
        (!check.whenAccepted || open.some(accepted));
      return result(
        ok,
        `${open.length} open proposal${open.length === 1 ? '' : 's'}${
          open.length
            ? `: ${open.map((c) => `${c.id} (${c.ops.map((o) => o.op).join(', ')})`).join('; ')}`
            : ''
        }`,
      );
    }
    case 'anyOf': {
      const results = check.checks.map((c) => runCheck(c, store, start));
      return result(
        results.some((r) => r.passed),
        results.map((r) => `${r.check.type}: ${r.message}`).join(' | '),
      );
    }
  }
}
