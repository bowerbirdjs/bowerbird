import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

/**
 * Finds the Claude API key for the showcase's dev-server proxy, and says where it came from or
 * why there is none. Read on every request, so editing .env needs no restart.
 *
 * Precedence, highest first: the .env files in the showcase folder, then those in the repository
 * root (in each, `.env.<mode>.local`, `.env.<mode>`, `.env.local`, `.env`, like Vite), then the
 * environment. A project's .env is the more specific choice, so it beats a key set system-wide.
 */

export interface KeyLookup {
  key?: string;
  /** Where the key came from: a file path or "the ANTHROPIC_API_KEY environment variable". */
  source?: string;
  /** Files looked at, in precedence order. */
  checked: string[];
  /** Things worth telling the person (lookalike files, an overridden variable, odd keys). */
  notes: string[];
}

const NAME = 'ANTHROPIC_API_KEY';

/** Text of a .env file, whatever Windows tools saved it as (UTF-8 with or without BOM, UTF-16). */
export function decodeEnvFile(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2, 2 + ((bytes.length - 2) & ~1)));
    return swapped.swap16().toString('utf16le');
  }
  // UTF-16 without a BOM: ASCII text has a zero in every other byte.
  if (bytes.length >= 4 && bytes[1] === 0 && bytes[3] === 0) return bytes.toString('utf16le');
  const text = bytes.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** `sk-ant-api…AbCd`: enough to recognise a key, not enough to use it. */
export const maskKey = (key: string) =>
  key.length > 16 ? `${key.slice(0, 10)}…${key.slice(-4)}` : '(a short value)';

export function findApiKey(
  dirs: readonly string[],
  mode: string,
  env: Record<string, string | undefined> = process.env,
): KeyLookup {
  const names = [`.env.${mode}.local`, `.env.${mode}`, '.env.local', '.env'];
  // Highest precedence first: the last folder given is the most specific.
  const files = [...dirs].reverse().flatMap((dir) => names.map((name) => join(dir, name)));
  const notes: string[] = [];
  // Files without the key only matter when no file has it.
  const missing: string[] = [];
  let found: { key: string; source: string } | undefined;

  for (const file of files) {
    if (!existsSync(file)) continue;
    let vars: Record<string, string | undefined>;
    try {
      vars = parseEnv(decodeEnvFile(readFileSync(file)));
    } catch (error) {
      notes.push(`${file} could not be read: ${error instanceof Error ? error.message : error}.`);
      continue;
    }
    const value = vars[NAME]?.trim();
    if (value) {
      if (!found) found = { key: value, source: file };
      continue;
    }
    const similar = Object.keys(vars).filter((k) => /anthropic|api.?key/i.test(k));
    missing.push(
      similar.length
        ? `${file} has no ${NAME} (it has ${similar.join(', ')}).`
        : `${file} has no ${NAME}=… line.`,
    );
  }

  // Lookalikes: Windows hides file extensions, so Notepad's ".env" is often ".env.txt".
  for (const dir of dirs) {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {}
    for (const entry of entries)
      if (/^\.?env(\.[\w-]+)*\.txt$|^\.env\s+$|^env$/i.test(entry))
        notes.push(`Found ${join(dir, entry)}: rename it to .env (Windows may have added .txt).`);
  }

  const fromEnv = env[NAME]?.trim();
  if (found && fromEnv && fromEnv !== found.key)
    notes.push(
      `The ${NAME} environment variable (${maskKey(fromEnv)}) is set too; ${found.source} wins.`,
    );
  if (!found && fromEnv) found = { key: fromEnv, source: `the ${NAME} environment variable` };
  if (!found) notes.unshift(...missing);
  if (!found && env[NAME] !== undefined)
    notes.push(`The ${NAME} environment variable is set but empty.`);
  if (found && !found.key.startsWith('sk-ant-'))
    notes.push(
      `The key from ${found.source} doesn't look like an Anthropic API key (those start with "sk-ant-"); check for quotes or stray characters.`,
    );

  return { ...(found ?? {}), checked: files, notes };
}
