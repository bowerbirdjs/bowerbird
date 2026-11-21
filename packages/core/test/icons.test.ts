import {
  createEmptyDoc,
  createRegistry,
  createStore,
  type IconDef,
  iconSvg,
  isIconDef,
  lintPage,
  outline,
  parseIcon,
} from '@bowerbirdjs/core';
import { describe, expect, it } from 'vitest';

const ARROW = '<path d="M5 12h14M13 6l6 6-6 6"/>';

describe('parseIcon', () => {
  it('reads bare shapes as a stroke drawing on a 24 grid', () => {
    expect(parseIcon(ARROW)).toEqual({
      viewBox: '0 0 24 24',
      style: 'stroke',
      strokeWidth: 2,
      shapes: [{ tag: 'path', attrs: { d: 'M5 12h14M13 6l6 6-6 6' } }],
    });
  });

  it('reads a whole svg as icon packages ship them: view box, style and line width', () => {
    const outline = parseIcon(
      `<?xml version="1.0"?>
       <!-- an icon -->
       <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 32 32" fill="none"
            stroke="currentColor" stroke-width="1.5" stroke-linecap="round" class="lucide">
         <g><circle cx="16" cy="16" r="12"></circle><line x1="16" y1="8" x2="16" y2="16"/></g>
       </svg>`,
    );
    expect(outline).toEqual({
      viewBox: '0 0 32 32',
      style: 'stroke',
      strokeWidth: 1.5,
      shapes: [
        { tag: 'circle', attrs: { cx: '16', cy: '16', r: '12' } },
        { tag: 'line', attrs: { x1: '16', y1: '8', x2: '16', y2: '16' } },
      ],
    });
    const solid = parseIcon(
      '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M0 0h256v256H0z" fill-rule="evenodd"/></svg>',
    );
    expect(solid?.style).toBe('fill');
    expect(solid?.shapes[0]?.attrs).toEqual({ d: 'M0 0h256v256H0z', 'fill-rule': 'evenodd' });
  });

  it('refuses anything that is not a plain drawing', () => {
    const refused = [
      '',
      'just text',
      `${ARROW} trailing text`,
      '<script>alert(1)</script>',
      '<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>',
      '<svg viewBox="0 0 24 24"><foreignObject><p>hi</p></foreignObject></svg>',
      '<svg viewBox="0 0 24 24"><use href="#x"/></svg>',
      '<svg viewBox="0 0 24 24"><image href="https://example.com/a.png"/></svg>',
      '<svg viewBox="0 0 24 24"><style>path{fill:red}</style><path d="M0 0h1"/></svg>',
      '<path d="M0 0h1" onclick="alert(1)"/>',
      '<path d="M0 0h1" style="fill:url(#x)"/>',
      '<path d="M0 0h1" fill="url(#gradient)"/>',
      '<path d="M0 0h1" fill="#ff0000"/>',
      '<path d="M0 0 javascript:alert(1)"/>',
      '<path d="M0 0h1" transform="rotate(45)"/>',
      '<g transform="scale(2)"><path d="M0 0h1"/></g>',
      '<circle cx="1" cy="1" r="expression(1)"/>',
      '<svg viewBox="0 0 24"><path d="M0 0h1"/></svg>',
      '<svg viewBox="0 0 0 24"><path d="M0 0h1"/></svg>',
      '<svg viewBox="0 0 24 24"><path d="M0 0h1"/>',
      '<svg viewBox="0 0 24 24"></svg>',
      '<svg viewBox="0 0 24 24"><path d="M0 0h1"/></svg><path d="M0 0h1"/>',
      '<path d="M0 0h1"',
      `<path d="${'M0 0h1'.repeat(4000)}"/>`,
      Array.from({ length: 65 }, () => '<path d="M0 0h1"/>').join(''),
    ];
    for (const markup of refused) expect(parseIcon(markup), markup.slice(0, 60)).toBeUndefined();
    // @ts-expect-error: not a string
    expect(parseIcon(null)).toBeUndefined();
  });

  it('takes defaults for bare shapes', () => {
    const icon = parseIcon('<rect x="2" y="2" width="12" height="12"/>', {
      viewBox: '0 0 16 16',
      style: 'fill',
    });
    expect(icon).toMatchObject({ viewBox: '0 0 16 16', style: 'fill' });
  });
});

describe('isIconDef and iconSvg', () => {
  const icon = parseIcon(ARROW)!;

  it('accepts what parseIcon builds and re-checks data from anywhere else', () => {
    expect(isIconDef(icon)).toBe(true);
    const bad: unknown[] = [
      null,
      {},
      { ...icon, viewBox: '0 0 24 24"><script>' },
      { ...icon, style: 'gradient' },
      { ...icon, strokeWidth: '2' },
      { ...icon, shapes: [] },
      { ...icon, shapes: [{ tag: 'script', attrs: {} }] },
      { ...icon, shapes: [{ tag: 'path', attrs: { d: 'M0 0', onload: 'x' } }] },
      { ...icon, shapes: [{ tag: 'path', attrs: { d: '"><script>' } }] },
      { ...icon, shapes: [{ tag: 'path', attrs: { d: 5 } }] },
    ];
    for (const value of bad) expect(isIconDef(value), JSON.stringify(value)).toBe(false);
  });

  it('writes svg sized to the text and coloured by it, hidden from assistive technology', () => {
    expect(iconSvg(icon)).toBe(
      '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    );
    const solid: IconDef = { ...icon, style: 'fill' };
    expect(iconSvg(solid)).toContain('fill="currentColor" aria-hidden="true"');
    expect(iconSvg(solid)).not.toContain('stroke=');
  });
});

describe('icons in a registry', () => {
  const make = () => {
    const registry = createRegistry({
      icons: { 'arrow-right': ARROW, check: '<path d="m5 12 4 4 9-9"/>' },
    });
    const store = createStore({ registry, doc: createEmptyDoc() });
    store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
    return store;
  };

  it('keeps icons by name, in order, and refuses bad names and drawings when registered', () => {
    const registry = createRegistry({ icons: { 'arrow-right': ARROW } });
    expect(registry.listIcons()).toEqual(['arrow-right']);
    expect(registry.icon('arrow-right')?.shapes).toHaveLength(1);
    expect(registry.icon('nope')).toBeUndefined();
    registry.registerIcons({ dot: parseIcon('<circle cx="12" cy="12" r="2"/>')! });
    expect(registry.listIcons()).toEqual(['arrow-right', 'dot']);
    expect(() => registry.registerIcons({ Arrow: ARROW })).toThrow(/lowercase kebab-case/);
    expect(() => registry.registerIcons({ evil: '<svg><script>x</script></svg>' })).toThrow(
      /not a plain SVG drawing/,
    );
    expect(() =>
      // @ts-expect-error: not an icon
      registry.registerIcons({ evil: { viewBox: '0 0 1 1', shapes: [{ tag: 'script' }] } }),
    ).toThrow(/not a plain SVG drawing/);
  });

  it('an icon node needs a registered name, with a suggestion when it is close', () => {
    const store = make();
    const insert = (props: Record<string, unknown>) =>
      store.apply({
        ops: [{ op: 'node.insert', parent: 'root-home', node: { type: 'icon', props } }],
      });
    expect(insert({ name: 'check' }).ok).toBe(true);
    const typo = insert({ name: 'arow-right' });
    expect(typo.ok).toBe(false);
    if (!typo.ok) {
      expect(typo.errors[0]).toMatchObject({ code: 'invalid_props', path: 'name' });
      expect(typo.errors[0]?.message).toBe(
        'icon.name: No icon "arow-right". Did you mean "arrow-right"?',
      );
      expect(typo.errors[0]?.hint).toBe('Icons: arrow-right, check.');
    }
    const shape = insert({ name: 'Not A Name' });
    expect(shape.ok).toBe(false);
    if (!shape.ok) expect(shape.errors[0]?.message).toContain('lowercase kebab-case');
    // Changing the name later is checked the same way.
    const change = store.apply({
      ops: [{ op: 'props.set', id: 'icon-1', props: { name: 'nope' } }],
    });
    expect(change.ok).toBe(false);
    expect(store.doc.nodes['icon-1']?.props.name).toBe('check');
  });

  it('a registry without icons says so', () => {
    const store = createStore({ registry: createRegistry(), doc: createEmptyDoc() });
    store.apply({ ops: [{ op: 'page.create', path: '/', title: 'Home' }] });
    const res = store.apply({
      ops: [
        {
          op: 'node.insert',
          parent: 'root-home',
          node: { type: 'icon', props: { name: 'check' } },
        },
      ],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors[0]?.message).toBe('icon.name: No icon "check": this site has no icons.');
      expect(res.errors[0]?.hint).toBeUndefined();
    }
  });

  it('the outline names the icon; lint flags one the icon set no longer has', () => {
    const store = make();
    store.apply({
      ops: [
        {
          op: 'node.insert',
          parent: 'root-home',
          node: { type: 'icon', props: { name: 'check', label: 'Included' } },
        },
      ],
    });
    expect(outline(store.view)).toContain('icon-1  icon  check "Included"');
    expect(lintPage(store.view, store.registry, 'home').map((i) => i.rule)).not.toContain(
      'unknown-icon',
    );
    // The same document opened with another icon set.
    const other = createRegistry({ icons: { 'arrow-right': ARROW } });
    const issue = lintPage(store.view, other, 'home').find((i) => i.rule === 'unknown-icon');
    expect(issue).toMatchObject({ severity: 'warning', nodeId: 'icon-1' });
  });
});
