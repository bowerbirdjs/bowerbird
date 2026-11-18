import { AGENT_GUIDE, createAgentTools, runTool } from '@bowerbirdjs/agent';
import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createStore, RICH_TEXT_TAGS } from '@bowerbirdjs/core';
import { describe, expect, it } from 'vitest';

function setup() {
  const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
  store.apply({
    ops: [
      { op: 'page.create', path: '/', title: 'Home' },
      { op: 'section.insert', section: 'hero' },
      { op: 'locale.set', add: ['de', 'fr'] },
      {
        op: 'props.set',
        id: 'hero-1/heading',
        locale: 'de',
        props: { text: 'Hallo' },
      },
      { op: 'props.set', id: 'hero-1/heading', locale: 'fr', props: { text: 'Salut' } },
    ],
  });
  const tools = createAgentTools({ store, actor: { kind: 'agent', id: 'test-agent' } });
  return { store, run: (name: string, input: unknown = {}) => runTool(tools, name, input) };
}

describe('agent guide', () => {
  it('every op example is valid JSON, and the rich-text tags are all listed', () => {
    const examples = AGENT_GUIDE.split('## Op examples\n')[1]!.trim().split('\n');
    for (const line of examples) expect(() => JSON.parse(line), line).not.toThrow();
    for (const tag of RICH_TEXT_TAGS) expect(AGENT_GUIDE).toContain(`<${tag}`);
  });
});

describe('reading translations', () => {
  it('get_nodes shows translations, optionally for one language', async () => {
    const { run } = setup();
    const all = JSON.parse((await run('get_nodes', { ids: ['hero-1/heading'] })).text);
    expect(all[0].l10n).toEqual({ de: { text: 'Hallo' }, fr: { text: 'Salut' } });
    const de = JSON.parse((await run('get_nodes', { ids: ['hero-1/heading'], locale: 'de' })).text);
    expect(de[0].l10n).toEqual({ de: { text: 'Hallo' } });
    const bad = await run('get_nodes', { ids: ['hero-1/heading'], locale: 'xx' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/no language "xx"/);
  });

  it('get_outline refuses unknown languages and explains the default one', async () => {
    const { run } = setup();
    const bad = await run('get_outline', { locale: 'es' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toBe('The site has no language "es". Languages: en, de, fr (default en).');
    const def = (await run('get_outline', { locale: 'en' })).text;
    expect(def).toContain('"en" is the default language');
    expect(def).not.toContain('untranslated');
    const de = (await run('get_outline', { locale: 'de' })).text;
    expect(de).toContain('"Hallo"');
    expect(de).toMatch(/hero-1\/subheading .*\[untranslated de\]/);
  });
});
