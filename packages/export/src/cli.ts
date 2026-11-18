#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { createDefaultRegistry } from '@bowerbirdjs/blocks';
import { normalizeDoc } from '@bowerbirdjs/core';
import { exportReact } from './react.js';
import { exportStaticSite } from './site.js';

const USAGE = `bowerbird-export: write a Bowerbird site as files

Usage: bowerbird-export --file site.site.json --out dist [options]

  -f, --file <path>    Site JSON file (as saved by the MCP server)
  -o, --out <dir>      Output folder (created if missing)
      --react          React components instead of static HTML
      --base-url <url> Public URL, for canonical links and sitemap.xml
      --theme <name>   Theme to publish (e.g. dark)
  -h, --help           Show this help`;

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string', short: 'f' },
      out: { type: 'string', short: 'o' },
      react: { type: 'boolean', default: false },
      'base-url': { type: 'string' },
      theme: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help || !values.file || !values.out) {
    console.error(USAGE);
    process.exit(values.help ? 0 : 1);
  }
  const doc = normalizeDoc(JSON.parse(await readFile(values.file, 'utf8')));
  if (!doc) throw new Error(`${values.file} is not a Bowerbird site file.`);
  const registry = createDefaultRegistry();
  const files = values.react
    ? exportReact(doc, registry)
    : exportStaticSite(doc, registry, {
        ...(values['base-url'] ? { baseUrl: values['base-url'] } : {}),
        ...(values.theme ? { theme: values.theme } : {}),
      });
  const out = resolve(values.out);
  for (const file of files) {
    const target = resolve(join(out, file.path));
    // Page paths come from the document; never write outside the output folder.
    if (!target.startsWith(out + sep))
      throw new Error(`Refusing to write outside ${out}: ${file.path}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.contents);
  }
  console.error(`wrote ${files.length} files to ${out}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
