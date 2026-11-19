import { describe, expect, test } from 'vitest';
import { DEFAULT_STRINGS, resolveStrings } from '../src/strings.js';

describe('editor strings', () => {
  test('a host replaces any subset; the rest stay English', () => {
    const t = resolveStrings({ moveUp: 'Nach oben', selectionLabel: (n) => n.title ?? n.type });
    expect(t.moveUp).toBe('Nach oben');
    expect(t.moveDown).toBe(DEFAULT_STRINGS.moveDown);
    expect(t.selectionLabel({ id: 'hero-1', type: 'joy-hero', title: 'Titelbild' })).toBe(
      'Titelbild',
    );
    expect(resolveStrings(undefined)).toBe(DEFAULT_STRINGS);
  });

  test('values of the wrong kind are ignored instead of breaking the canvas', () => {
    const t = resolveStrings({
      moveUp: 42 as unknown as string,
      peerTyping: 'typing' as unknown as (name: string) => string,
      unknownKey: 'x',
    } as never);
    expect(t.moveUp).toBe('Move up');
    expect(t.peerTyping('Ana')).toBe('Ana is typing…');
    expect('unknownKey' in t).toBe(false);
  });

  test('the default selection label names the id and the type or section', () => {
    expect(DEFAULT_STRINGS.selectionLabel({ id: 'hero-1', type: 'box', section: 'hero' })).toBe(
      'hero-1 · hero',
    );
    expect(DEFAULT_STRINGS.selectionLabel({ id: 'x', type: 'text' })).toBe('x · text');
  });
});
