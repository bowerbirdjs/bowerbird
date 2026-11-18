// End-to-end smoke test: starts the built MCP server over stdio (as an MCP client like Claude Code
// would), builds a landing page through the agent tools, makes precise edits, and optionally takes
// screenshots of the live preview.
//
//   pnpm build && node packages/mcp/scripts/smoke.mjs [--screenshots <dir>]
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const shotsIndex = process.argv.indexOf('--screenshots');
const shotsDir = shotsIndex > 0 ? process.argv[shotsIndex + 1] : undefined;
const siteFile = join(mkdtempSync(join(tmpdir(), 'bowerbird-')), 'site.site.json');
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [cli, '--file', siteFile, '--port', '0'],
  // The SDK passes only a minimal environment by default; keep NODE_PATH etc. so the server can
  // find an optional Playwright install.
  env: { ...process.env },
  stderr: 'inherit',
});
const client = new Client({ name: 'Smoke Test', version: '1.0.0' });
await client.connect(transport);

let failures = 0;
async function call(name, args = {}, { expectError = false } = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content.map((c) => c.text).join('\n');
  const ok = !!res.isError === expectError;
  if (!ok) failures++;
  console.log(
    `\n── ${name}${expectError ? ' (expecting an error)' : ''} ${ok ? '✓' : '✗ UNEXPECTED'}\n${text}`,
  );
  return text;
}

const context = await call('get_context');
const previewUrl = /Live preview \(tell the user\): (\S+)/.exec(context)?.[1];
await call('list_sections', { name: 'pricing' });

await call('apply', {
  label: 'Build Clockwise landing page',
  baseRevision: 1,
  ops: [
    {
      op: 'section.insert',
      section: 'nav',
      content: { brand: { text: 'Clockwise' }, cta: { text: 'Start tracking', href: '/signup' } },
    },
    {
      op: 'section.insert',
      section: 'hero',
      variant: { layout: 'split' },
      content: {
        eyebrow: { text: 'Time tracking for freelancers' },
        heading: { text: 'Know where every hour goes' },
        subheading: {
          text: 'Clockwise tracks your time in the background, turns it into invoices, and shows which clients are worth it.',
        },
        primary: { text: 'Start free', href: '/signup' },
        secondary: { text: 'See how it works', href: '#features' },
        media: { alt: 'The Clockwise dashboard' },
      },
    },
    {
      op: 'section.insert',
      section: 'features',
      content: {
        heading: { text: 'Built for people who bill by the hour' },
        intro: { text: 'Everything between "start timer" and "invoice paid", in one calm app.' },
        'item-1/title': { text: 'Automatic timers' },
        'item-1/body': {
          text: 'Clockwise notices what you work on and suggests entries, so you never reconstruct a week from memory.',
        },
        'item-2/title': { text: 'Invoices in one click' },
        'item-2/body': {
          text: 'Turn tracked hours into a clean invoice with your rates, taxes and logo.',
        },
        'item-3/title': { text: 'Client profitability' },
        'item-3/body': { text: 'See your real hourly rate per client and project.' },
      },
    },
    { op: 'section.insert', section: 'pricing' },
    {
      op: 'section.insert',
      section: 'cta',
      variant: { tone: 'dark' },
      content: {
        heading: { text: 'Stop guessing your hours' },
        button: { text: 'Try Clockwise free' },
      },
    },
    {
      op: 'section.insert',
      section: 'footer',
      content: {
        brand: { text: 'Clockwise' },
        legal: { text: '© 2026 Clockwise. All rights reserved.' },
      },
    },
  ],
});

// Precise follow-up edits: prices, one extra feature, the brand colour.
await call('apply', {
  label: 'Adjust pricing',
  ops: [
    { op: 'props.set', id: 'pricing-1/tier-pro/price', props: { text: '$12' } },
    { op: 'props.set', id: 'pricing-1/tier-team/price', props: { text: '$29' } },
    { op: 'node.duplicate', id: 'pricing-1/tier-pro/feature-4' },
    { op: 'props.set', id: 'pricing-1/tier-pro/feature-5', props: { text: 'Invoice export' } },
    { op: 'node.remove', id: 'features-1/item-6' },
    { op: 'node.remove', id: 'features-1/item-5' },
    { op: 'node.remove', id: 'features-1/item-4' },
  ],
});
await call('apply', {
  label: 'Teal brand',
  ops: [
    { op: 'token.set', path: 'color.brand.600', value: '#0d9488' },
    { op: 'token.set', path: 'color.brand.700', value: '#0f766e' },
    { op: 'token.set', path: 'color.brand.50', value: '#f0fdfa' },
    { op: 'style.set', id: 'hero-1/heading', bp: 'lg', css: 'font-size: var(--text-6xl)' },
  ],
});

// Mistakes an agent might make: each must come back as an actionable error, changing nothing.
await call(
  'apply',
  { ops: [{ op: 'style.set', id: 'hero-1', css: 'padding: 24px' }] },
  { expectError: true },
);
await call(
  'apply',
  { ops: [{ op: 'props.set', id: 'hero-1/headline', props: { text: 'x' } }] },
  { expectError: true },
);
await call(
  'apply',
  { baseRevision: 1, ops: [{ op: 'node.remove', id: 'cta-1' }] },
  { expectError: true },
);

const outline = await call('get_outline', { depth: 2 });
if (!outline.includes('pricing-1  section:pricing')) failures++;

// Linked components: the footer becomes a symbol; a definition edit reaches the instance.
await call('apply', {
  label: 'Shared footer',
  ops: [
    { op: 'page.create', path: '/about', title: 'About' },
    { op: 'symbol.create', id: 'footer-1', name: 'Site footer' },
    { op: 'symbol.insert', symbol: 'site-footer', page: 'about' },
    { op: 'props.set', id: 'symbol-site-footer/brand', props: { text: 'Clockwise Inc.' } },
  ],
});
const shared = await call('get_nodes', { ids: ['footer-1/brand', 'footer-2/brand'] });
if ((shared.match(/Clockwise Inc\./g) ?? []).length !== 2) failures++;

// Rendered layout checks (only when the server found Playwright).
const tools = (await client.listTools()).tools.map((t) => t.name);
if (tools.includes('get_layout')) {
  const layout = await call('get_layout', { page: 'home', bp: 'base', depth: 1 });
  if (!/layout home at 390px wide/.test(layout)) failures++;
  const shot = await client.callTool({
    name: 'screenshot',
    arguments: { page: 'home', node: 'hero-1' },
  });
  const image = shot.content.find((c) => c.type === 'image');
  console.log(
    `\n── screenshot ${image ? `✓ ${image.mimeType}, ${Math.round((image.data.length * 0.75) / 1024)} KB` : '✗ no image'}`,
  );
  if (!image) failures++;
} else {
  console.log('\n── get_layout skipped (Playwright not installed)');
}

if (shotsDir && previewUrl) {
  const require = createRequire(import.meta.url);
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const shots = [
    ['desktop', { width: 1280, height: 900 }, '?badge=0'],
    ['mobile', { width: 390, height: 844 }, '?badge=0'],
    ['desktop-dark', { width: 1280, height: 900 }, '?badge=0&theme=dark'],
  ];
  for (const [name, viewport, query] of shots) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    await page.goto(`${previewUrl}/${query}`);
    await page.screenshot({ path: join(shotsDir, `${name}.png`), fullPage: true });
    await page.close();
  }
  await browser.close();
  console.log(`\nScreenshots written to ${shotsDir}`);
}

await client.close();
console.log(failures ? `\n✗ ${failures} unexpected result(s)` : '\n✓ smoke test passed');
console.log(`site file: ${siteFile}`);
process.exit(failures ? 1 : 0);
