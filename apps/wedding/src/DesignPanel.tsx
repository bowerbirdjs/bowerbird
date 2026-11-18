import type { ApplyResult, Store } from '@bowerbirdjs/core';
import { useEffect, useRef, useState } from 'react';
import {
  type Corners,
  DESIGNS,
  designById,
  readableAccent,
  type SiteStyle,
  type Spacing,
  styleOps,
} from './site/designs.js';
import type { Dresscode, EventInfo } from './site/facts.js';

type Change = (ops: unknown[], label: string) => ApplyResult;

const ACCENTS = ['#9a4f39', '#b8486e', '#7a5c9e', '#2f6f8f', '#46704f', '#b07d2b'];

/**
 * Design and its knobs. Every pick is one undoable change that writes tokens (and, for a design,
 * each section's layout and background). The accent is adjusted until text on and around it
 * stays readable, so no choice here can make the site hard to read.
 */
export function DesignPanel({ store, change }: { store: Store; change: Change }) {
  const style = store.view.data('style') as SiteStyle;
  const event = store.view.data('event') as EventInfo;
  const dress = store.view.data('dresscode') as Dresscode | undefined;
  const design = designById(style.design);
  const apply = (next: SiteStyle, label: string) =>
    change(styleOps(store.view, next, style), label);

  // The colour input fires while dragging: show the colour at once, write it once it settles.
  const shownAccent = style.accent ?? design.tokens['color.accent']!;
  const [picking, setPicking] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const pickAccent = (hex: string) => {
    setPicking(hex);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setPicking(null);
      apply({ ...style, accent: hex }, 'Accent colour');
    }, 350);
  };
  const wanted = picking ?? style.accent;
  const adjusted =
    wanted && readableAccent(wanted, design).accent.toLowerCase() !== wanted.toLowerCase();

  return (
    <div className="design">
      <section aria-labelledby="design-h">
        <h3 id="design-h">Design</h3>
        <div className="design-cards">
          {DESIGNS.map((d) => (
            <button
              key={d.id}
              type="button"
              className="design-card"
              aria-pressed={d.id === style.design}
              onClick={() =>
                d.id !== style.design &&
                apply({ ...style, design: d.id, accent: null }, `Design: ${d.name}`)
              }
              style={{
                background: d.tokens['color.surface'],
                color: d.tokens['color.on-surface'],
                borderColor: d.id === style.design ? d.tokens['color.accent'] : undefined,
              }}
            >
              <span
                className="design-sample"
                style={{
                  fontFamily: d.tokens['font.heading'],
                  fontWeight: Number(d.tokens['weight.heading']),
                }}
              >
                {event.title}
              </span>
              <span className="design-dots" aria-hidden="true">
                {(['color.accent', 'color.surface-subtle', 'color.inverse'] as const).map((k) => (
                  <i key={k} style={{ background: d.tokens[k] }} />
                ))}
              </span>
              <span className="design-name">{d.name}</span>
              <span className="design-desc" style={{ color: d.tokens['color.muted'] }}>
                {d.description[event.locale]}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="accent-h">
        <h3 id="accent-h">Accent colour</h3>
        <div className="swatches">
          {[...new Set([...ACCENTS, ...(dress?.colors.map((c) => c.hex) ?? [])])].map((hex) => (
            <button
              key={hex}
              type="button"
              className="swatch"
              aria-label={`Accent ${hex}`}
              aria-pressed={wanted === hex}
              style={{ background: hex }}
              onClick={() => apply({ ...style, accent: hex }, 'Accent colour')}
            />
          ))}
          <label className="swatch custom" title="Pick any colour">
            <input
              type="color"
              aria-label="Pick any accent colour"
              value={picking ?? shownAccent}
              onChange={(e) => pickAccent(e.target.value)}
            />
          </label>
          {style.accent ? (
            <button
              type="button"
              className="link"
              onClick={() => apply({ ...style, accent: null }, 'Accent colour')}
            >
              Design’s own
            </button>
          ) : null}
        </div>
        {adjusted ? (
          <p className="note" role="status">
            Made a little darker so text stays readable.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="corners-h">
        <h3 id="corners-h">Corners</h3>
        <div className="segmented">
          {(['sharp', 'soft', 'round'] as Corners[]).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={style.corners === c}
              onClick={() => apply({ ...style, corners: c }, 'Corners')}
            >
              {c[0]!.toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="spacing-h">
        <h3 id="spacing-h">Spacing</h3>
        <div className="segmented">
          {(['compact', 'regular', 'airy'] as Spacing[]).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={style.spacing === s}
              onClick={() => apply({ ...style, spacing: s }, 'Spacing')}
            >
              {s[0]!.toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
