export type IssueCode =
  | 'invalid_op'
  | 'not_found'
  | 'duplicate_id'
  | 'invalid_id'
  | 'invalid_parent'
  | 'cycle'
  | 'root_node'
  | 'invalid_props'
  | 'unknown_prop'
  | 'unknown_type'
  | 'unknown_section'
  | 'unknown_part'
  | 'invalid_variant'
  | 'invalid_style'
  | 'unknown_token'
  | 'raw_value'
  | 'unknown_breakpoint'
  | 'unknown_state'
  | 'invalid_var'
  | 'invalid_token'
  | 'text_not_found'
  | 'ambiguous_text'
  | 'policy'
  | 'stale_revision'
  | 'conflict'
  | 'nothing_to_undo'
  | 'no_change'
  | 'integrity'
  | 'token_in_use'
  | 'parts_removed';

/**
 * A structured problem report. Messages are written for both humans and agents: they say what is
 * wrong, where, and (in `hint`) how to fix it.
 */
export interface Issue {
  code: IssueCode;
  message: string;
  opIndex?: number;
  nodeId?: string;
  path?: string;
  hint?: string;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Closest candidates to `input`, best first. */
export function closest(input: string, candidates: Iterable<string>, limit = 3): string[] {
  const needle = input.toLowerCase();
  const max = Math.max(2, Math.floor(needle.length / 3));
  const scored: { c: string; d: number }[] = [];
  for (const c of new Set(candidates)) {
    const hay = c.toLowerCase();
    const d = levenshtein(needle, hay);
    const contains = needle.length >= 3 && (hay.includes(needle) || needle.includes(hay));
    if (d <= max || contains) scored.push({ c, d: contains ? Math.min(d, max) : d });
  }
  return scored
    .sort((a, b) => a.d - b.d || a.c.localeCompare(b.c))
    .slice(0, limit)
    .map((s) => s.c);
}

export function didYouMean(input: string, candidates: Iterable<string>): string {
  const matches = closest(input, candidates);
  return matches.length ? ` Did you mean ${matches.map((m) => `"${m}"`).join(' or ')}?` : '';
}

export function listPreview(items: Iterable<string>, max = 12): string {
  const all = [...items];
  const shown = all.slice(0, max).join(', ');
  return all.length > max ? `${shown}, … (${all.length - max} more)` : shown;
}

export function formatIssue(issue: Issue): string {
  const where = [
    issue.opIndex !== undefined ? `ops[${issue.opIndex}]` : '',
    issue.nodeId ? `node "${issue.nodeId}"` : '',
    issue.path ? `at ${issue.path}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `${where ? `${where}: ` : ''}${issue.message}${issue.hint ? ` (${issue.hint})` : ''} [${issue.code}]`;
}

export class BowerbirdError extends Error {
  constructor(readonly issues: Issue[]) {
    super(issues.map(formatIssue).join('\n'));
    this.name = 'BowerbirdError';
  }
}
