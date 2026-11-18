#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createDefaultRegistry, createStarterDoc } from '@bowerbirdjs/blocks';
import {
  createPolicy,
  createStore,
  type FreedomLevel,
  normalizeDoc,
  type SiteDoc,
} from '@bowerbirdjs/core';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPlaywrightLayoutProvider, hasPlaywright } from './browser.js';
import { type PreviewServer, startPreview } from './preview.js';
import { createMcpServer } from './server.js';

const USAGE = `bowerbird-mcp: MCP server (stdio) and live preview for a Bowerbird site

Options:
  -f, --file <path>       Site JSON file to load and save (default: in-memory only)
  -p, --port <port>       Preview port (default 4321; 0 picks a free port)
      --host <host>       Preview host (default 127.0.0.1)
      --no-preview        Don't start the preview server
      --allow-raw         Allow raw CSS values (px, hex colours) instead of tokens only
      --agent-level <l>   Limit agents to content | layout | design | code (default code)
      --review            Agents propose changes; accept or reject them in the preview
      --protect <mode>    People's edits vs agents: warn (default) | confirm | off
      --no-browser        Don't offer get_layout/screenshot (they need Playwright)
  -h, --help              Show this help

Example (Claude Code):
  claude mcp add bowerbird -- node packages/mcp/dist/cli.js --file site.site.json`;

const log = (...args: unknown[]) => console.error('[bowerbird]', ...args);

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string', short: 'f' },
      port: { type: 'string', short: 'p', default: '4321' },
      host: { type: 'string', default: '127.0.0.1' },
      'no-preview': { type: 'boolean', default: false },
      'allow-raw': { type: 'boolean', default: false },
      'agent-level': { type: 'string' },
      review: { type: 'boolean', default: false },
      protect: { type: 'string' },
      'no-browser': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.error(USAGE);
    return;
  }
  const level = values['agent-level'] as FreedomLevel | undefined;
  if (level && !['content', 'layout', 'design', 'code'].includes(level)) {
    throw new Error(`--agent-level must be content, layout, design or code (got "${level}").`);
  }

  const protect = values.protect as 'warn' | 'confirm' | 'off' | undefined;
  if (protect && !['warn', 'confirm', 'off'].includes(protect)) {
    throw new Error(`--protect must be warn, confirm or off (got "${protect}").`);
  }

  let doc: SiteDoc;
  const file = values.file;
  if (file && existsSync(file)) {
    const parsed = normalizeDoc(JSON.parse(await readFile(file, 'utf8')));
    if (!parsed) throw new Error(`${file} is not a Bowerbird site file.`);
    doc = parsed;
    log(`loaded ${file} (revision ${doc.revision})`);
  } else {
    doc = createStarterDoc();
  }

  const store = createStore({
    registry: createDefaultRegistry(),
    doc,
    policy: createPolicy({
      allowRawValues: values['allow-raw'],
      ...(level ? { levels: { agent: level } } : {}),
      ...(values.review ? { review: { agent: true } } : {}),
      ...(protect ? { protectHumanEdits: protect } : {}),
    }),
  });
  if (!Object.keys(store.doc.pages).length) {
    store.apply({
      actor: { kind: 'system', id: 'bowerbird' },
      label: 'Create home page',
      ops: [{ op: 'page.create', path: '/', title: 'Home' }],
    });
  }

  let saving: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;
  const save = () => {
    if (!file) return Promise.resolve();
    // A failed write must not poison the chain: later saves still run.
    saving = saving
      .catch(() => undefined)
      .then(async () => {
        const tmp = `${file}.tmp`;
        await writeFile(tmp, `${JSON.stringify(store.doc, null, 2)}\n`);
        await rename(tmp, file);
      });
    return saving;
  };
  if (file) {
    store.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void save().catch((e) => log('save failed:', e)), 50);
    });
    await save();
  }

  let preview: PreviewServer | undefined;
  if (!values['no-preview']) {
    const port = Number(values.port);
    try {
      preview = await startPreview({ store, port, host: values.host });
    } catch (error) {
      log(`port ${port} unavailable (${(error as Error).message}); using a free port`);
      preview = await startPreview({ store, port: 0, host: values.host });
    }
    log(`live preview at ${preview.url}`);
  }

  const layout =
    !values['no-browser'] && hasPlaywright() ? createPlaywrightLayoutProvider(store) : undefined;
  if (!layout && !values['no-browser'])
    log('Playwright not found: get_layout and screenshot are off (npm i -D playwright to enable)');

  const server = createMcpServer({
    store,
    previewUrl: () => preview?.url,
    ...(layout ? { layout } : {}),
  });
  await server.connect(new StdioServerTransport());
  log('MCP server ready on stdio');

  const shutdown = async () => {
    clearTimeout(timer);
    await save().catch(() => undefined);
    await preview?.close();
    await layout?.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.on('end', shutdown);
}

main().catch((error) => {
  log(error instanceof Error ? error.message : error);
  process.exit(1);
});
