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
    let preview = await startPreview({ store, port: 0 });
    try {
      const { page, errors } = await open(
        `${apps?.mcpEditor}?sync=${encodeURIComponent(preview.syncUrl!)}&name=Sam`,
      );
      const heading = page.locator('[data-bb-node="hero-1/heading"]');
      const subheading = page.locator('[data-bb-node="hero-1/subheading"]');
      const status = page.locator('#status');
      await expect.poll(() => heading.textContent()).toBe('Built by the agent');

      // The agent edits (as it would through MCP tools): the person sees it, and where.
      const agent = { kind: 'agent' as const, id: 'mcp-claude-code', name: 'Claude Code' };
      store.apply({
        actor: agent,
        label: 'Sharper headline',
        ops: [{ op: 'props.set', id: 'hero-1/subheading', props: { text: 'From the agent' } }],
      });
      await expect.poll(() => subheading.textContent()).toBe('From the agent');
      await expect
        .poll(() => page.locator('.bbx-peer-tag', { hasText: 'Claude Code' }).textContent())
        .toBe('Claude Code · Sharper headline');

      // The person edits in the editor: the server's store (and so the agent) has it.
      const edit = async (text: string) => {
        await heading.dblclick();
        await page.keyboard.press('Control+A');
        await page.keyboard.type(text);
        await page.keyboard.press('Enter');
      };
      await edit('Edited by Sam');
      await expect.poll(() => store.view.node('hero-1/heading')?.props.text).toBe('Edited by Sam');
      expect(store.history.at(-1)?.actor).toMatchObject({ id: 'person-sam', kind: 'user' });
      expect(await status.textContent()).toMatch(/Connected to .* also here: Claude Code/);
      expect(errors).toEqual([]);

      // The server restarts (same key): the page reconnects by itself, and an edit made while
      // it was down reaches the server once it's back.
      const port = Number(new URL(preview.url).port);
      const syncKey = new URL(preview.syncUrl!).searchParams.get('key')!;
      await preview.close();
      await expect.poll(() => status.textContent(), { timeout: 10_000 }).toMatch(/Reconnecting/);
      await edit('Written offline');
      expect(await heading.textContent()).toBe('Written offline');
      preview = await startPreview({ store, port, syncKey });
      await expect
        .poll(() => store.view.node('hero-1/heading')?.props.text, { timeout: 15_000 })
        .toBe('Written offline');
      await expect.poll(() => status.textContent()).toMatch(/^Connected/);
      store.apply({
        actor: agent,
        ops: [{ op: 'props.set', id: 'hero-1/subheading', props: { text: 'After the restart' } }],
      });
      await expect.poll(() => subheading.textContent()).toBe('After the restart');
      expect(store.history.filter((e) => e.actor.id === 'person-sam')).toHaveLength(2);
    } finally {
      await preview.close();
    }
  });
});
