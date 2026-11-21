import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createStore, lintPage } from '@bowerbirdjs/core';
import { htmlToNodes } from '@bowerbirdjs/import';
import { describe, expect, it } from 'vitest';

const field = (props: Record<string, unknown>) => ({ type: 'field', props });

describe('forms in imported HTML', () => {
  it('a form becomes a form node; each control becomes a field with its label', () => {
    const { nodes, warnings } = htmlToNodes(`
      <form action="/api/contact" method="POST">
        <label for="n">Your name</label>
        <input id="n" name="name" required placeholder="Ada Lovelace">
        <label>Email <input type="email" name="email"></label>
        <label for="m">Message</label>
        <textarea id="m" name="message" rows="6"></textarea>
        <input type="hidden" name="list" value="42">
        <button>Send</button>
      </form>`);
    expect(warnings).toEqual([]);
    expect(nodes).toEqual([
      {
        type: 'form',
        props: { action: '/api/contact' },
        children: [
          field({
            type: 'text',
            name: 'name',
            label: 'Your name',
            placeholder: 'Ada Lovelace',
            required: true,
          }),
          field({ type: 'email', name: 'email', label: 'Email' }),
          field({ type: 'textarea', name: 'message', label: 'Message', rows: 6 }),
          field({ type: 'hidden', name: 'list', label: '', value: '42' }),
          // A button in a form sends it.
          { type: 'button', props: { text: 'Send', type: 'submit' } },
        ],
      },
    ]);
  });

  it('choices: a select with its prompt, radio groups with their legend, checkbox groups', () => {
    const { nodes } = htmlToNodes(`
      <form action="/rsvp" method="get">
        <label for="meal">Meal</label>
        <select id="meal" name="meal" required>
          <option value="">Choose…</option><option>Fish</option><option>Veggie</option>
        </select>
        <fieldset>
          <legend>Will you attend?</legend>
          <label><input type="radio" name="attend" value="yes" checked required> Yes</label>
          <label><input type="radio" name="attend" value="no"> No</label>
        </fieldset>
        <label><input type="checkbox" name="extras" value="a"> Shuttle</label>
        <label><input type="checkbox" name="extras" value="b"> Hotel</label>
        <label><input type="checkbox" name="terms" required> I agree to the <a href="/terms">terms</a></label>
        <input type="submit" value="Reply">
      </form>`);
    expect(nodes[0]?.props).toEqual({ action: '/rsvp', method: 'get' });
    expect(nodes[0]?.children).toEqual([
      field({
        type: 'select',
        name: 'meal',
        label: 'Meal',
        required: true,
        options: ['Fish', 'Veggie'],
        placeholder: 'Choose…',
      }),
      field({
        type: 'radio',
        name: 'attend',
        label: 'Will you attend?',
        required: true,
        options: ['Yes', 'No'],
        value: 'Yes',
      }),
      // Checkboxes that share a name are one question; a single one is a yes or no.
      field({ type: 'checkbox', name: 'extras', label: '', options: ['Shuttle', 'Hotel'] }),
      field({ type: 'checkbox', name: 'terms', label: 'I agree to the terms', required: true }),
      { type: 'button', props: { text: 'Reply', type: 'submit' } },
    ]);
  });

  it('a fieldset with several questions stays a group with its legend as text', () => {
    const { nodes } = htmlToNodes(`
      <form action="/x"><fieldset><legend>Address</legend>
        <label>Street <input name="street"></label>
        <label>City <input name="city"></label>
      </fieldset></form>`);
    expect(nodes[0]?.children).toEqual([
      {
        type: 'box',
        props: {},
        children: [
          { type: 'text', props: { tag: 'p', text: 'Address' } },
          field({ type: 'text', name: 'street', label: 'Street' }),
          field({ type: 'text', name: 'city', label: 'City' }),
        ],
      },
    ]);
  });

  it('says what it left out or changed', () => {
    const { nodes, warnings } = htmlToNodes(`
      <form action="javascript:alert(1)">
        <input type="password" name="pw">
        <input type="file" name="cv">
        <input name="first name" aria-label="First name">
        <input name="unlabelled">
        <select name="empty"></select>
        <input type="radio" name="alone" value="x" aria-label="Just me">
        <label for="nobody">Orphan</label>
        <form><input name="nested" aria-label="Nested"></form>
        <input name="after" aria-label="After">
      </form>`);
    const form = nodes[0]!;
    // An action that would be blocked isn't kept.
    expect(form.props).toEqual({});
    expect(form.children).toEqual([
      field({ type: 'text', name: 'field-2', label: 'First name' }),
      field({ type: 'text', name: 'unlabelled', label: '' }),
      // A select without choices, and a radio on its own, can't be what they say.
      field({ type: 'text', name: 'empty', label: '' }),
      field({ type: 'checkbox', name: 'alone', label: 'Just me' }),
      // A label that names no control stays text.
      { type: 'text', props: { tag: 'label', text: 'Orphan' } },
      // A form inside a form: as in browsers, its start tag is ignored and its end tag closes
      // the outer form, so its fields stay and what follows is outside.
      field({ type: 'text', name: 'nested', label: 'Nested' }),
    ]);
    expect(nodes[1]).toEqual(field({ type: 'text', name: 'after', label: 'After' }));
    expect(warnings).toEqual(
      expect.arrayContaining([
        'Unsafe href values (for example javascript: URLs) were removed.',
        '<input type="password"> fields were skipped: forms here can\'t collect files or passwords.',
        '<input type="file"> fields were skipped: forms here can\'t collect files or passwords.',
        "Some field names had characters a field name can't hold and were replaced.",
        'Some form fields had no label; give each a "label" so people know what to enter.',
      ]),
    );
  });

  it('what it produces can be inserted and passes the form checks', () => {
    const { nodes } = htmlToNodes(`
      <form action="/api/contact">
        <label>Email <input type="email" name="email" required></label>
        <label for="t">Topic</label>
        <select id="t" name="topic"><option>Sales</option><option>Support</option></select>
        <fieldset><legend>Reply by</legend>
          <label><input type="radio" name="by" value="mail"> Email</label>
          <label><input type="radio" name="by" value="phone"> Phone</label>
        </fieldset>
        <button type="submit">Send</button>
      </form>`);
    const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
    const res = store.apply({
      ops: [
        { op: 'page.create', path: '/', title: 'Home' },
        ...nodes.map((node) => ({ op: 'node.insert', parent: 'root-home', node })),
      ],
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const rules = lintPage(store.view, store.registry, 'home').map((i) => i.rule);
    expect(rules.filter((r) => r.startsWith('form') || r.startsWith('field'))).toEqual([]);
  });
});

describe('accordion items in imported HTML', () => {
  it('details and summary become an accordion item with its content', () => {
    const { nodes, warnings } = htmlToNodes(`
      <details open><summary>What is it?</summary><p>An <em>answer</em>.</p></details>
      <details><p>No summary</p></details>`);
    expect(warnings).toEqual([]);
    expect(nodes).toEqual([
      {
        type: 'details',
        props: { open: true },
        children: [
          { type: 'text', props: { tag: 'summary', text: 'What is it?' } },
          { type: 'rich-text', props: { tag: 'p', html: 'An <em>answer</em>.' } },
        ],
      },
      {
        type: 'details',
        props: {},
        children: [{ type: 'text', props: { tag: 'p', text: 'No summary' } }],
      },
    ]);
  });
});

describe('review findings: controls in odd places', () => {
  const accepted = (html: string) => {
    const { nodes, warnings } = htmlToNodes(html);
    const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
    const res = store.apply({
      ops: [
        { op: 'page.create', id: 'home', path: '/', title: 'Home' },
        ...nodes.map((node) => ({ op: 'node.insert', parent: 'root-home', node })),
      ],
    });
    if (!res.ok) throw new Error(JSON.stringify(res.errors, null, 1));
    const all = Object.values(store.doc.nodes);
    return { store, warnings, all, types: all.map((n) => n.type) };
  };

  it('fields and submit buttons inside paragraphs and spans are kept', () => {
    const { all } = accepted(
      '<form action="/c"><p><label for=a>Name</label> <input id=a name=author></p>' +
        '<p><input type=submit value=Post></p><span><input name=q aria-label="Search"></span></form>',
    );
    const fields = all.filter((n) => n.type === 'field').map((n) => n.props);
    expect(fields).toMatchObject([
      { name: 'author', label: 'Name' },
      { name: 'q', label: 'Search' },
    ]);
    expect(all.find((n) => n.type === 'button')?.props).toMatchObject({
      text: 'Post',
      type: 'submit',
    });
    // The label became the field's label, not a text of its own.
    expect(all.some((n) => n.type === 'text' && n.props.text === 'Name')).toBe(false);
  });

  it('a label keeps its own words, not the choices of a select nested in it', () => {
    const { all } = accepted(
      '<form><label>Size <span><select name=size><option value="">Pick</option><option selected>Small</option><option>Large</option></select></span></label></form>',
    );
    expect(all.find((n) => n.type === 'field')?.props).toMatchObject({
      type: 'select',
      label: 'Size',
      options: ['Small', 'Large'],
      placeholder: 'Pick',
      value: 'Small',
    });
  });

  it('form parts inside a link are flattened so the store takes the import', () => {
    const { types, warnings } = accepted(
      '<a href="/s"><div>Search</div><input name=b aria-label="Query"><details><summary>More</summary><p>Text</p></details></a>',
    );
    expect(types).not.toContain('field');
    expect(types).not.toContain('details');
    expect(warnings.join(' ')).toContain('inside a link');
  });

  it('odd input types, picture buttons and presets', () => {
    const { all, warnings } = accepted(
      '<form action="/x"><input type="constructor" name=a aria-label="A">' +
        '<textarea name=note aria-label="Note">Hello\nthere</textarea>' +
        '<input type=checkbox name=ok value=yes checked aria-label="OK">' +
        '<input type=radio name=r><input type=radio name=r>' +
        '<input type=image alt="Send it" src="/go.png"></form><constructor>Odd tag</constructor>',
    );
    const props = all.filter((n) => n.type === 'field').map((n) => n.props);
    expect(props).toMatchObject([
      { type: 'text', name: 'a' },
      { type: 'textarea', value: 'Hello\nthere' },
      { type: 'checkbox', name: 'ok', value: 'yes' },
    ]);
    expect(all.find((n) => n.type === 'button')?.props).toMatchObject({
      text: 'Send it',
      type: 'submit',
    });
    expect(warnings.join(' ')).toContain('without labels or values');
    expect(warnings.join(' ')).toContain('start unticked');
  });

  it('scanning stays fast on large, deep or repetitive markup', () => {
    const radios = '<input type=radio name=r value=x>'.repeat(20_000);
    const deep = `${'<div>'.repeat(20_000)}${'<input type=radio name=q value=y>'.repeat(5_000)}`;
    const started = performance.now();
    htmlToNodes(`<form><fieldset><legend>Pick</legend>${radios}</fieldset></form>`);
    htmlToNodes(deep);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
