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
