import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { decodeEnvFile, findApiKey, maskKey } from '../server/api-key.js';

const KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz-1234';
let root: string;
let showcase: string;

function setup() {
  root = mkdtempSync(join(tmpdir(), 'bb-key-'));
  showcase = join(root, 'apps', 'showcase');
  mkdirSync(showcase, { recursive: true });
}
afterEach(() => rmSync(root, { recursive: true, force: true }));

const lookup = (env: Record<string, string | undefined> = {}) =>
  findApiKey([root, showcase], 'development', env);

describe('finding the API key for the showcase proxy', () => {
  test('files Windows tools write: UTF-8 with BOM and CRLF, UTF-16 from PowerShell', () => {
    setup();
    writeFileSync(join(root, '.env'), `﻿ANTHROPIC_API_KEY=${KEY}\r\nOTHER=1\r\n`);
    expect(lookup()).toMatchObject({ key: KEY, source: join(root, '.env') });

    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(`ANTHROPIC_API_KEY=${KEY}\r\n`, 'utf16le'),
    ]);
    writeFileSync(join(root, '.env'), utf16);
    expect(lookup().key).toBe(KEY);
    expect(decodeEnvFile(Buffer.from('A=1\n', 'utf16le'))).toBe('A=1\n');
    const be = Buffer.from(`﻿A=1\n`, 'utf16le').swap16();
    expect(decodeEnvFile(be)).toBe('A=1\n');
  });

  test('quotes and spaces around the value are fine', () => {
    setup();
    writeFileSync(join(root, '.env'), `ANTHROPIC_API_KEY = "${KEY}"  \n`);
    expect(lookup().key).toBe(KEY);
  });

  test('the showcase folder beats the root, and a .env beats a key set system-wide', () => {
    setup();
    writeFileSync(join(root, '.env'), 'ANTHROPIC_API_KEY=sk-ant-root-key-0000000000\n');
    writeFileSync(join(showcase, '.env'), `ANTHROPIC_API_KEY=${KEY}\n`);
    const found = lookup({ ANTHROPIC_API_KEY: 'sk-ant-old-global-key-99999' });
    expect(found).toMatchObject({ key: KEY, source: join(showcase, '.env') });
    expect(found.notes.join('\n')).toMatch(/environment variable \(sk-ant-old…9999\) is set too/);
    // Without files, the environment is used.
    rmSync(join(root, '.env'));
    rmSync(join(showcase, '.env'));
    expect(lookup({ ANTHROPIC_API_KEY: KEY }).source).toBe(
      'the ANTHROPIC_API_KEY environment variable',
    );
  });

  test('says why there is no key: a .env.txt, a misspelt name, an empty variable', () => {
    setup();
    writeFileSync(join(root, '.env.txt'), `ANTHROPIC_API_KEY=${KEY}\n`);
    writeFileSync(join(showcase, '.env'), `ANTHROPIC_KEY=${KEY}\n`);
    const found = lookup({ ANTHROPIC_API_KEY: '' });
    expect(found.key).toBeUndefined();
    const notes = found.notes.join('\n');
    expect(notes).toContain(
      `${join(showcase, '.env')} has no ANTHROPIC_API_KEY (it has ANTHROPIC_KEY)`,
    );
    expect(notes).toContain(`Found ${join(root, '.env.txt')}: rename it to .env`);
    expect(notes).toContain('environment variable is set but empty');
    // The value itself never appears in notes.
    expect(notes).not.toContain(KEY);
  });

  test('a value that is not an Anthropic key is flagged, keys are masked', () => {
    setup();
    writeFileSync(join(root, '.env'), 'ANTHROPIC_API_KEY=your-key-here\n');
    expect(lookup().notes.join('\n')).toMatch(/doesn't look like an Anthropic API key/);
    expect(maskKey(KEY)).toBe('sk-ant-api…1234');
    expect(maskKey('short')).toBe('(a short value)');
  });
});
