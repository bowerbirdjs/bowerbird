import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import {
  createEmptyDoc,
  createRegistry,
  createStore,
  defineComponent,
  type SiteDoc,
  type Store,
  t,
} from '@bowerbirdjs/core';
import { compileCss } from '@bowerbirdjs/css';
import { renderPage } from '@bowerbirdjs/html';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

function site(nodes: unknown[]): Store {
  const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
  const res = store.apply({
    actor: { kind: 'system', id: 'setup' },
    ops: [
      { op: 'page.create', path: '/', title: 'Home' },
      ...nodes.map((node) => ({ op: 'node.insert', parent: 'root-home', node })),
    ],
  });
  if (!res.ok) throw new Error(JSON.stringify(res.errors, null, 1));
  return store;
}
const published = (store: Store) => renderPage(store.doc, store.registry, 'home').html;
const editing = (store: Store) =>
  renderPage(store.doc, store.registry, 'home', { mode: 'editor' }).html;

describe('form fields', () => {
  it('a text-like field is a label around its text and control', () => {
    const html = published(
      site([
        t.form({ action: '/api/contact', label: 'Contact' }, [
          t.field({
            field: 'email',
            type: 'email',
            label: 'Email',
            required: true,
            placeholder: 'you@example.com',
            help: 'We never share it.',
          }),
          t.field({ field: 'message', type: 'textarea', label: 'Message', rows: 6 }),
          t.button({ text: 'Send', type: 'submit' }),
        ]),
      ]),
    );
    expect(html).toContain('<form action="/api/contact" method="post" aria-label="Contact">');
    expect(html).toContain(
      '<label class="bb-field bb-field--input bb-field--required"><span class="bb-field__label">Email</span>' +
        '<input class="bb-field__control" name="email" required type="email" placeholder="you@example.com" autocomplete="email">' +
        '<span class="bb-field__help">We never share it.</span></label>',
    );
    expect(html).toContain(
      '<label class="bb-field bb-field--textarea"><span class="bb-field__label">Message</span>' +
        '<textarea class="bb-field__control" name="message" rows="6"></textarea></label>',
    );
    expect(html).toContain('<button type="submit">Send</button></form>');
  });

  it('choices: a select with its prompt, radio and checkbox groups, one checkbox', () => {
    const html = published(
      site([
        t.form({ action: '/rsvp' }, [
          t.field({
            field: 'plan',
            type: 'select',
            label: 'Plan',
            options: ['Free', 'Pro'],
            value: 'Pro',
            placeholder: 'Choose…',
          }),
          t.field({
            field: 'attending',
            type: 'radio',
            label: 'Coming?',
            options: ['Yes', 'No'],
            required: true,
          }),
          t.field({
            field: 'extras[]',
            type: 'checkbox',
            label: 'Extras',
            options: ['A', 'B'],
            value: 'B',
            required: true,
          }),
          t.field({ field: 'terms', type: 'checkbox', label: 'I agree', required: true }),
        ]),
      ]),
    );
    expect(html).toContain(
      '<select class="bb-field__control" name="plan"><option value="">Choose…</option><option>Free</option><option selected>Pro</option></select>',
    );
    expect(html).toContain(
      '<fieldset class="bb-field bb-field--group bb-field--required"><legend class="bb-field__label">Coming?</legend>' +
        '<label class="bb-field__option"><input class="bb-field__box" type="radio" name="attending" value="Yes" required><span>Yes</span></label>',
    );
    // Required checkboxes in a group would all have to be ticked, so none is required.
    expect(html).toContain(
      '<label class="bb-field__option"><input class="bb-field__box" type="checkbox" name="extras[]" value="B" checked><span>B</span></label>',
    );
    expect(html).toContain(
      '<label class="bb-field bb-field--check bb-field--required"><input class="bb-field__box" type="checkbox" name="terms" required><span class="bb-field__label">I agree</span></label>',
    );
  });

  it('a hidden field is only an input when published; the editor shows a chip to select', () => {
    const store = site([
      t.form({ action: '/x' }, [
        t.field({ field: 'source', type: 'hidden', label: '', value: 'landing' }),
      ]),
    ]);
    expect(published(store)).toContain('<input type="hidden" name="source" value="landing">');
    expect(editing(store)).toContain(
      '<span class="bb-field bb-field--hidden" data-bb-node="field-1">Hidden field: source</span>',
    );
    expect(editing(store)).not.toContain('type="hidden"');
  });

  it('labels and help text are marked for editing in place, in the editor only', () => {
    const store = site([
      t.form({ action: '/x' }, [t.field({ field: 'email', label: 'Email', help: 'No spam.' })]),
    ]);
    expect(editing(store)).toContain(
      '<span class="bb-field__label" data-bb-edit="[{&quot;prop&quot;:&quot;label&quot;,&quot;label&quot;:&quot;Label&quot;}]">Email</span>',
    );
    expect(editing(store)).toContain('data-bb-edit="[{&quot;prop&quot;:&quot;help&quot;');
    expect(published(store)).not.toContain('data-bb-edit');
  });

  it('escapes what people type and renders translations', () => {
    const store = site([
      t.form({ action: '/x' }, [
        t.field({
          field: 'q',
          type: 'select',
          label: '<b>Pick</b> "one"',
          placeholder: 'a "quoted" prompt',
          options: ['<script>alert(1)</script>', 'Tom & Jerry'],
        }),
      ]),
    ]);
    const html = published(store);
    expect(html).toContain('<span class="bb-field__label">&lt;b&gt;Pick&lt;/b&gt; "one"</span>');
    expect(html).toContain('<option value="">a "quoted" prompt</option>');
    expect(html).toContain('<option>&lt;script&gt;alert(1)&lt;/script&gt;</option>');
    expect(html).toContain('<option>Tom &amp; Jerry</option>');
    expect(html).not.toContain('<script>');
    store.apply({
      ops: [
        { op: 'locale.set', add: ['de'] },
        {
          op: 'props.set',
          id: 'field-1',
          locale: 'de',
          props: { label: 'Wähle', options: ['Eins', 'Zwei'] },
        },
      ],
    });
    const de = renderPage(store.doc, store.registry, 'home', { locale: 'de' }).html;
    expect(de).toContain('<span class="bb-field__label">Wähle</span>');
    // Shown in German; sent as the choice in the default language (escaped like everything else).
    expect(de).toContain(
      '<option value="&lt;script&gt;alert(1)&lt;/script&gt;">Eins</option><option value="Tom &amp; Jerry">Zwei</option>',
    );
  });

  it('where a form is sent is sanitised like a link, and only the form says where', () => {
    const tampered = (action: string): string => {
      const store = site([t.form({ action: '/ok' }, [])]);
      const doc = structuredClone(store.doc) as SiteDoc;
      doc.nodes['form-1']!.props.action = action;
      return renderPage(doc, store.registry, 'home').html;
    };
    expect(tampered('https://example.com/f?a=1&b=2')).toContain(
      '<form action="https://example.com/f?a=1&amp;b=2" method="post">',
    );
    for (const action of [
      'javascript:alert(1)',
      ' JaVaScRiPt:alert(1)',
      'data:text/html,x',
      'vbscript:x',
    ])
      expect(tampered(action), action).toContain('<form method="post">');
    // No action yet: nothing is sent anywhere (not even back to the page with the fields in the URL).
    expect(published(site([t.form({}, [])]))).toContain('<form method="post">');

    // A stored document can't smuggle in other field types or a method.
    const store = site([t.form({ action: '/ok' }, [t.field({ field: 'a', label: 'A' })])]);
    const doc = structuredClone(store.doc) as SiteDoc;
    doc.nodes['field-1']!.props.type = 'file';
    doc.nodes['form-1']!.props.method = 'dialog';
    const html = renderPage(doc, store.registry, 'home').html;
    expect(html).toContain('type="text"');
    expect(html).toContain('<form action="/ok" method="post">');

    // A host component can render form controls, but never a button that redirects the form.
    const registry = createRegistry({
      components: [
        defineComponent({
          name: 'sneaky',
          kind: 'primitive',
          description: 'test',
          props: z.strictObject({}),
          children: false,
          render: () => ({
            tag: 'form',
            attrs: { action: 'javascript:alert(1)' },
            children: [
              {
                tag: 'button',
                attrs: { formaction: 'https://evil.example/', type: 'submit' },
                text: 'Go',
              },
              { tag: 'input', void: true, attrs: { type: 'image', src: 'javascript:alert(2)' } },
            ],
          }),
        }),
      ],
    });
    const s = createStore({ registry, doc: createEmptyDoc() });
    s.apply({
      ops: [
        { op: 'page.create', path: '/', title: 'Home' },
        { op: 'node.insert', parent: 'root-home', node: { type: 'sneaky' } },
      ],
    });
    const out = renderPage(s.doc, registry, 'home').html;
    expect(out).toContain(
      '<form><button type="submit">Go</button><input type="image" src=""></form>',
    );
  });
});

describe('accordion items', () => {
  const item = (opts: { open?: boolean; group?: string } = {}) =>
    t.details(opts, [t.text({ tag: 'summary', text: 'Is it free?' }), t.text({ text: 'Yes.' })]);

  it('renders native details and summary, closed unless it starts open', () => {
    expect(published(site([item()]))).toContain(
      '<details><summary>Is it free?</summary><p>Yes.</p></details>',
    );
    expect(published(site([item({ open: true, group: 'faq' })]))).toContain(
      '<details open name="faq"><summary>Is it free?</summary>',
    );
  });

  it('is open while editing, and marked so preview can close it again', () => {
    const closed = editing(site([item()]));
    expect(closed).toContain('<details open data-bb-closed="" data-bb-node="details-1">');
    const open = editing(site([item({ open: true })]));
    expect(open).toContain('<details open data-bb-node="details-1">');
    expect(published(site([item()]))).not.toContain('data-bb-closed');
  });
});

describe('icons', () => {
  it('draws the registered icon inside a span, named only when it has a label', () => {
    const html = published(
      site([t.icon({ icon: 'check' }), t.icon({ icon: 'check', label: 'Included' })]),
    );
    const svg =
      '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
    expect(html).toContain(`<span class="bb-icon" aria-hidden="true">${svg}</span>`);
    expect(html).toContain(`<span class="bb-icon" role="img" aria-label="Included">${svg}</span>`);
  });

  it('an icon the registry does not have renders nothing, and specs still cannot emit svg', () => {
    const store = site([t.icon({ icon: 'check' })]);
    const other = createRegistry({
      components: [
        defineComponent({
          name: 'raw-svg',
          kind: 'primitive',
          description: 'test',
          props: z.strictObject({}),
          children: false,
          render: () => ({
            tag: 'svg',
            children: [{ tag: 'script', text: 'alert(1)' }],
          }),
        }),
      ],
    });
    expect(renderPage(store.doc, other, 'home').html).toContain(
      '<span class="bb-icon" aria-hidden="true"></span>',
    );
    const s = createStore({ registry: other, doc: createEmptyDoc() });
    s.apply({
      ops: [
        { op: 'page.create', path: '/', title: 'Home' },
        { op: 'node.insert', parent: 'root-home', node: { type: 'raw-svg' } },
      ],
    });
    const html = renderPage(s.doc, other, 'home').html;
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<script');
  });

  it('any component can show an icon in what it generates', () => {
    const registry = createDefaultRegistry({
      components: [
        defineComponent({
          name: 'place',
          kind: 'primitive',
          description: 'test',
          props: z.strictObject({}),
          children: false,
          render: () => ({
            tag: 'p',
            children: [{ tag: 'span', attrs: { class: 'pin' }, icon: 'map-pin' }, 'Lisbon'],
          }),
        }),
      ],
    });
    const s = createStore({ registry, doc: createStarterDoc() });
    s.apply({
      ops: [
        { op: 'page.create', path: '/', title: 'Home' },
        { op: 'node.insert', parent: 'root-home', node: { type: 'place' } },
      ],
    });
    expect(renderPage(s.doc, registry, 'home').html).toMatch(
      /<p><span class="pin"><svg viewBox="0 0 24 24"[^>]*><path [^>]*\/><circle [^>]*\/><\/svg><\/span>Lisbon<\/p>/,
    );
  });
});

describe('base styles for the new elements', () => {
  it('ship in both modes, scoped away from host markup', () => {
    const store = site([t.form({ action: '/x' }, [t.field({ field: 'a', label: 'A' })])]);
    const css = compileCss(store.doc, store.registry);
    expect(css).toContain('.bb-page :where(.bb-field__control)');
    expect(css).toContain('.bb-page :where(.bb-icon)');
    expect(css).toContain('.bb-page :where(summary)');
    const editor = compileCss(store.doc, store.registry, { mode: 'editor' });
    expect(editor).toContain('.bb-page :where(.bb-field__control)');
    // rem is converted for the canvas, so the host's root font size can't rescale fields.
    expect(editor).toContain('min-height: calc(2.75 * 16px)');
  });
});

describe('review findings', () => {
  it('a textarea preset that starts with a line break keeps it', () => {
    const store = site([
      t.form({ action: '/x' }, [
        t.field({ field: 'note', type: 'textarea', label: 'Note', value: '\nsecond line' }),
      ]),
    ]);
    expect(published(store)).toContain('rows="4">\n\nsecond line</textarea>');
  });

  it('translated choices show in that language but send, and preset, the original', () => {
    const store = site([
      t.form({ action: '/rsvp' }, [
        t.field({
          field: 'come',
          type: 'radio',
          label: 'Coming?',
          options: ['Yes', 'No'],
          value: 'Yes',
        }),
        t.field({
          field: 'meal',
          type: 'select',
          label: 'Meal',
          options: ['Fish', 'Veg'],
          value: 'Veg',
        }),
      ]),
    ]);
    const res = store.apply({
      ops: [
        { op: 'locale.set', add: ['de'] },
        { op: 'props.set', id: 'field-1', locale: 'de', props: { options: ['Ja', 'Nein'] } },
        {
          op: 'props.set',
          id: 'field-2',
          locale: 'de',
          props: { options: ['Fisch', 'Vegetarisch'] },
        },
      ],
    });
    expect(res.ok).toBe(true);
    const de = renderPage(store.doc, store.registry, 'home', { locale: 'de' }).html;
    expect(de).toContain('value="Yes" checked><span>Ja</span>');
    expect(de).toContain('value="No"><span>Nein</span>');
    expect(de).toContain('<option value="Veg" selected>Vegetarisch</option>');
    // The default language is written as before.
    expect(published(store)).toContain('<option selected>Veg</option>');
  });

  it('grouped accordion items all stay open while editing; the group applies when published', () => {
    const item = (q: string) =>
      t.details({ group: 'faq' }, [
        t.text({ tag: 'summary', text: q }),
        t.text({ text: 'Answer' }),
      ]);
    const store = site([item('One'), item('Two')]);
    expect(editing(store)).not.toContain('name="faq"');
    expect(editing(store).match(/data-bb-group="faq"/g)).toHaveLength(2);
    expect(published(store).match(/name="faq"/g)).toHaveLength(2);
    expect(published(store)).not.toContain('data-bb-group');
  });

  it("a host's custom element keeps props named like form attributes", () => {
    const registry = createDefaultRegistry({
      components: [
        {
          name: 'cart-button',
          kind: 'code',
          tag: 'x-cart',
          description: 'Adds to the cart.',
          props: z.strictObject({ action: z.string(), formaction: z.string() }),
          children: false,
        },
      ],
    });
    const store = createStore({ registry, doc: createStarterDoc() });
    const res = store.apply({
      ops: [
        { op: 'page.create', path: '/', title: 'Home' },
        {
          op: 'node.insert',
          parent: 'root-home',
          node: { type: 'cart-button', props: { action: 'cart:add', formaction: 'keep' } },
        },
      ],
    });
    expect(res.ok).toBe(true);
    expect(renderPage(store.doc, registry, 'home').html).toContain(
      '<x-cart action="cart:add" formaction="keep"',
    );
  });
});
