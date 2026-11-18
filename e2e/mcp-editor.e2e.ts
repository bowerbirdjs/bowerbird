import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import { createStore } from '@bowerbirdjs/core';
import { startPreview } from '@bowerbirdjs/mcp';
import { describe, expect, test } from 'vitest';
import { apps, useBrowser } from './browser.js';

describe.skipIf(!apps)('editing alongside an MCP agent', () => {
  const open = useBrowser();

  test('the editor syncs with the MCP server’s store, both ways', async () => {
    // What `bowerbird-mcp --file site.json` runs: a store the agent edits, plus the preview.
    const store = createStore({ registry: createDefaultRegistry(), doc: createStarterDoc() });
    store.apply({
      actor: { kind: 'system', id: 'setup' },
      ops: [
        { op: 'page.create', path: '/', title: 'Home' },
        {
          op: 'section.insert',
          section: 'hero',
          content: { heading: { text: 'Built by the agent' } },
        },
      ],
    });
    const preview = await startPreview({ store, port: 0 });
    try {
      const { page, errors } = await open(
        `${apps?.mcpEditor}?server=${encodeURIComponent(preview.url)}&name=Sam`,
      );
      const heading = page.locator('[data-bb-node="hero-1/heading"]');
      await expect.poll(() => heading.textContent()).toBe('Built by the agent');

      // The agent edits (as it would through MCP tools): the person sees it, and where.
      const agent = { kind: 'agent' as const, id: 'mcp-claude-code', name: 'Claude Code' };
      store.apply({
        actor: agent,
        label: 'Sharper headline',
        ops: [{ op: 'props.set', id: 'hero-1/subheading', props: { text: 'From the agent' } }],
      });
      await expect
        .poll(() => page.locator('[data-bb-node="hero-1/subheading"]').textContent())
        .toBe('From the agent');
      await expect
        .poll(() => page.locator('.bbx-peer-tag', { hasText: 'Claude Code' }).textContent())
        .toBe('Claude Code · Sharper headline');

      // The person edits in the editor: the server's store (and so the agent) has it.
      await heading.dblclick();
      await page.keyboard.press('Control+A');
      await page.keyboard.type('Edited by Sam');
      await page.keyboard.press('Enter');
      await expect.poll(() => store.view.node('hero-1/heading')?.props.text).toBe('Edited by Sam');
      expect(store.history.at(-1)?.actor).toMatchObject({ id: 'person-sam', kind: 'user' });
      expect(await page.locator('#status').textContent()).toMatch(
        /Connected to .* also here: Claude Code/,
      );
      expect(errors).toEqual([]);
    } finally {
      await preview.close();
    }
  });
});
