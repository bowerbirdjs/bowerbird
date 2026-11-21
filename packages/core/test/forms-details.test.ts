import { type Issue, lintPage, outline, type Store, t } from '@bowerbirdjs/core';
import { describe, expect, it } from 'vitest';
import { makeStore } from './fixtures.js';

// A system actor, so outlines carry no "edited by" notes.
const setup = { kind: 'system', id: 'setup' } as const;
const ok = (store: Store, ops: unknown[]) => {
  const res = store.apply({ ops, actor: setup });
  if (!res.ok) throw new Error(JSON.stringify(res.errors, null, 1));
  return res;
};
const errors = (store: Store, ops: unknown[]): Issue[] => {
  const res = store.apply({ ops });
  return res.ok ? [] : res.errors;
};
const insert = (parent: string, node: unknown) => ({ op: 'node.insert', parent, node });
const rules = (store: Store) => lintPage(store.view, store.registry, 'home').map((i) => i.rule);

const contactForm = t.form({ action: '/api/contact' }, [
  t.field({ field: 'email', type: 'email', label: 'Email', required: true }),
  t.field({ field: 'message', type: 'textarea', label: 'Message' }),
  t.button({ text: 'Send', type: 'submit' }),
]);

describe('forms', () => {
  it('a form holds fields and a submit button; the outline shows where it goes', () => {
    const store = makeStore();
    ok(store, [insert('root-home', contactForm)]);
    expect(store.doc.nodes['form-1']?.props).toEqual({ action: '/api/contact', method: 'post' });
    expect(store.doc.nodes['field-1']?.props).toEqual({
      type: 'email',
      name: 'email',
      label: 'Email',
      required: true,
    });
    expect(outline(store.view).split('\n').slice(1)).toEqual([
      '  form-1  form  → /api/contact (post)',
      '    field-1  field<email>  "Email" name=email required',
      '    field-2  field<textarea>  "Message" name=message',
      '    button-1  button  "Send"',
    ]);
    expect(rules(store).filter((r) => r.startsWith('form') || r.startsWith('field'))).toEqual([]);
  });

  it('field props are checked: the name, the type, and choices where they belong', () => {
    const store = makeStore();
    ok(store, [insert('root-home', t.form({}, []))]);
    const field = (props: Record<string, unknown>) =>
      errors(store, [insert('form-1', { type: 'field', props })]);
    expect(field({ label: 'Email' })[0]).toMatchObject({ code: 'invalid_props', path: 'name' });
    expect(field({ name: 'e mail', label: 'Email' })[0]?.message).toContain(
      'Use letters, digits, "_", "-", "." and "[]", starting with a letter.',
    );
    const password = field({ name: 'p', label: 'Password', type: 'password' })[0];
    expect(password).toMatchObject({ code: 'invalid_props', path: 'type' });
    expect(password?.hint).toBe(
      'Allowed: text, email, tel, url, number, date, time, textarea, select, radio, checkbox, hidden.',
    );
    expect(field({ name: 'plan', label: 'Plan', type: 'select' })[0]).toMatchObject({
      code: 'invalid_props',
      path: 'options',
      message: 'field.options: A select field needs "options": the choices it offers.',
      hint: 'e.g. "options": ["Yes", "No"].',
    });
    expect(field({ name: 'go', label: 'Coming?', type: 'radio', options: [] })[0]?.path).toBe(
      'options',
    );
    expect(field({ name: 'n', label: 'Name', options: ['a'] })[0]?.message).toBe(
      'field.options: A text field has no choices; "options" is for select, radio and checkbox fields.',
    );
    expect(
      field({ name: 'items[]', label: 'Extras', type: 'checkbox', options: ['A', 'B'] }),
    ).toEqual([]);
    expect(
      field({ name: 'plan', label: 'Plan', type: 'select', options: ['Free', 'Pro'] }),
    ).toEqual([]);
    // A later change is checked against the whole field, not just the patch.
    const select = Object.values(store.doc.nodes).find((n) => n.props.type === 'select')!;
    expect(
      errors(store, [{ op: 'props.set', id: select.id, props: { options: null } }])[0]?.path,
    ).toBe('options');
    expect(
      errors(store, [{ op: 'props.set', id: select.id, props: { type: 'text', options: null } }]),
    ).toEqual([]);
    // Fields are leaves.
    expect(
      errors(store, [insert(select.id, { type: 'text', props: { text: 'x' } })])[0]?.code,
    ).toBe('invalid_parent');
  });

  it('forms can’t nest, directly or deeper down, and nothing interactive goes inside a link', () => {
    const store = makeStore();
    ok(store, [insert('root-home', t.form({}, [t.box({}, [])]))]);
    expect(errors(store, [insert('form-1', t.form())])[0]?.message).toBe(
      '"form-1" (form) can\'t contain a form.',
    );
    const deep = errors(store, [insert('box-1', t.form())])[0];
    expect(deep).toMatchObject({ code: 'invalid_parent', nodeId: 'form-2' });
    expect(deep?.message).toBe(
      'Form "form-2" can\'t be inside form "form-1": browsers drop a form inside a form.',
    );
    ok(store, [insert('root-home', t.form({}, []))]);
    // Moving a form into another one is refused the same way (refused inserts used no ids).
    const moved = errors(store, [{ op: 'node.move', id: 'form-2', parent: 'box-1' }])[0];
    expect(moved?.message).toContain('can\'t be inside form "form-1"');

    ok(store, [insert('root-home', t.link({ href: '/x' }, [t.box({}, [])]))]);
    for (const node of [
      t.field({ field: 'q', label: 'Search' }),
      t.form(),
      t.details({}, [t.text({ tag: 'summary', text: 'More' })]),
    ]) {
      expect(errors(store, [insert('link-1', node)])[0]?.message).toBe(
        `"link-1" (link) can't contain a ${node.type}.`,
      );
      expect(errors(store, [insert('box-2', node)])[0]?.message).toMatch(
        /can't be inside link "link-1": links can't contain links, buttons or form parts\.$/,
      );
    }
  });

  it('only the label, placeholder, help and choices of a field are content', () => {
    const store = makeStore({ levels: { agent: 'content' } });
    ok(store, [insert('root-home', contactForm)]);
    const asAgent = (props: Record<string, unknown>, id = 'field-1') =>
      store.apply({ actor: { kind: 'agent', id: 'a' }, ops: [{ op: 'props.set', id, props }] });
    expect(
      asAgent({ label: 'Work email', placeholder: 'you@company.com', help: 'No spam.' }).ok,
    ).toBe(true);
    for (const props of [
      { name: 'other' },
      { required: false },
      { type: 'text' },
      { value: 'x' },
    ]) {
      const res = asAgent(props);
      expect(res.ok, JSON.stringify(props)).toBe(false);
      if (!res.ok) expect(res.errors[0]?.code).toBe('policy');
    }
    // Where a form is sent is not content either.
    const action = asAgent({ action: 'https://elsewhere.example/steal' }, 'form-1');
    expect(action.ok).toBe(false);
    expect(asAgent({ label: 'Contact us' }, 'form-1').ok).toBe(true);
  });

  it('lint: a form needs an action that works, a submit button and one name per field', () => {
    const store = makeStore();
    ok(store, [
      insert(
        'root-home',
        t.form({}, [
          t.field({ field: 'email', label: 'Email' }),
          t.field({ field: 'email', label: 'Confirm email' }),
          t.field({ field: 'note', label: '' }),
          t.field({ field: 'source', type: 'hidden', label: '', value: 'landing' }),
        ]),
      ),
      insert('root-home', t.field({ field: 'stray', label: 'Stray' })),
    ]);
    const issues = lintPage(store.view, store.registry, 'home');
    const of = (rule: string) => issues.filter((i) => i.rule === rule);
    expect(of('form-action')).toMatchObject([{ severity: 'info', nodeId: 'form-1' }]);
    expect(of('form-submit')).toMatchObject([{ severity: 'warning', nodeId: 'form-1' }]);
    expect(of('field-name')).toMatchObject([{ severity: 'warning', nodeId: 'field-2' }]);
    expect(of('field-name')[0]?.message).toBe(
      'Fields "field-1" and "field-2" are both sent as "email", so one answer hides the other.',
    );
    // A hidden field needs no label; a visible one does.
    expect(of('field-label')).toMatchObject([{ severity: 'error', nodeId: 'field-3' }]);
    expect(of('field-outside-form')).toMatchObject([{ severity: 'warning', nodeId: 'field-5' }]);

    for (const action of ['javascript:alert(1)', 'mailto:me@example.com', 'data:text/html,x']) {
      ok(store, [{ op: 'props.set', id: 'form-1', props: { action } }]);
      const unsafe = lintPage(store.view, store.registry, 'home').find(
        (i) => i.rule === 'unsafe-url' && i.nodeId === 'form-1',
      );
      expect(unsafe, action).toMatchObject({ severity: 'error' });
    }
    ok(store, [
      { op: 'props.set', id: 'form-1', props: { action: 'https://example.com/forms/1' } },
      insert('form-1', t.button({ text: 'Send', type: 'submit' })),
    ]);
    const after = rules(store);
    expect(after).not.toContain('unsafe-url');
    expect(after).not.toContain('form-action');
    expect(after).not.toContain('form-submit');
  });

  it('translations cover what a visitor reads, choices included', () => {
    const store = makeStore();
    ok(store, [
      insert(
        'root-home',
        t.form({ action: '/rsvp' }, [
          t.field({
            field: 'attending',
            type: 'radio',
            label: 'Will you come?',
            options: ['Yes', 'No'],
          }),
        ]),
      ),
      { op: 'locale.set', add: ['de'] },
      {
        op: 'props.set',
        id: 'field-1',
        locale: 'de',
        props: { label: 'Kommst du?', options: ['Ja', 'Nein'] },
      },
    ]);
    expect(store.doc.nodes['field-1']?.l10n).toEqual({
      de: { label: 'Kommst du?', options: ['Ja', 'Nein'] },
    });
    const name = errors(store, [
      { op: 'props.set', id: 'field-1', locale: 'de', props: { name: 'kommt' } },
    ])[0];
    expect(name?.message).toContain('Only content can be translated');
  });

  it('a host can pin where forms post by replacing the form component', () => {
    const store = makeStore();
    const builtIn = store.registry.component('form')!;
    store.registry.registerComponent({
      ...builtIn,
      validate: (props) =>
        String(props.action ?? '').startsWith('/api/')
          ? []
          : [
              {
                path: 'action',
                message: 'forms post to this site only',
                hint: 'Use an address under /api/, e.g. "/api/contact".',
              },
            ],
    });
    const refused = errors(store, [
      insert('root-home', t.form({ action: 'https://elsewhere.example/collect' }, [])),
    ])[0];
    expect(refused?.code).toBe('invalid_props');
    expect(refused?.message).toContain('form.action: forms post to this site only');
    expect(refused?.hint).toContain('/api/');
    ok(store, [insert('root-home', contactForm)]);
    // Changing the address later goes through the same rule.
    const later = errors(store, [
      { op: 'props.set', id: 'form-1', props: { action: 'https://elsewhere.example/collect' } },
    ])[0];
    expect(later?.code).toBe('invalid_props');
  });
});

describe('accordion items (details)', () => {
  const item = (question: string, answer: string, opts: { open?: boolean; group?: string } = {}) =>
    t.details(opts, [t.text({ tag: 'summary', text: question }), t.text({ text: answer })]);

  it('holds a summary and content; open and group are checked', () => {
    const store = makeStore();
    ok(store, [insert('root-home', item('Is it free?', 'Yes.', { open: true, group: 'faq' }))]);
    expect(store.doc.nodes['details-1']?.props).toEqual({ open: true, group: 'faq' });
    expect(outline(store.view).split('\n').slice(1)).toEqual([
      '  details-1  details  open',
      '    text-1  text<summary>  "Is it free?"',
      '    text-2  text<p>  "Yes."',
    ]);
    expect(
      errors(store, [{ op: 'props.set', id: 'details-1', props: { group: 'my group' } }])[0]
        ?.message,
    ).toContain('Use letters, digits, "-" and "_", starting with a letter.');
    expect(rules(store)).not.toContain('details-summary');
  });

  it('lint: an item without a summary first, and a summary anywhere else', () => {
    const store = makeStore();
    ok(store, [
      insert('root-home', t.details({}, [t.text({ text: 'No summary here' })])),
      insert('root-home', t.text({ tag: 'summary', text: 'Lost' })),
      insert(
        'root-home',
        t.details({}, [t.text({ text: 'First' }), t.text({ tag: 'summary', text: 'Second' })]),
      ),
    ]);
    const found = lintPage(store.view, store.registry, 'home')
      .filter((i) => i.rule === 'details-summary')
      .map((i) => `${i.nodeId}: ${i.message}`);
    expect(found).toEqual([
      'details-1: Accordion item "details-1" doesn\'t start with a summary, so browsers label it "Details".',
      'text-2: "text-2" is a summary, which only works as the first child of a details node.',
      'details-2: Accordion item "details-2" doesn\'t start with a summary, so browsers label it "Details".',
      'text-4: "text-4" is a summary, which only works as the first child of a details node.',
    ]);
  });
});
