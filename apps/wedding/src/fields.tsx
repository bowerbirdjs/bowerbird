import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

/** Commits a value; returns an error message when the change was refused. */
export type Commit = (value: string) => string | null;

interface FieldProps {
  label: string;
  /** Data path (`schedule.0.time`): clicks on the page find the field with it. */
  path: string;
  value: string | undefined;
  onCommit: Commit;
  multiline?: boolean;
  type?: 'text' | 'date' | 'time' | 'url';
  placeholder?: string;
  hint?: string;
}

/**
 * A text field that commits on blur or Enter (one undo step per edit, not per keystroke) and
 * shows why a value was refused. Outside changes (undo, an agent) show unless it's being edited.
 */
export function Field({
  label,
  path,
  value,
  onCommit,
  multiline,
  type = 'text',
  placeholder,
  hint,
}: FieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(value ?? '');
  const [error, setError] = useState<string | null>(null);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) {
      setDraft(value ?? '');
      setError(null);
    }
  }, [value]);
  const commit = () => {
    editing.current = false;
    if (draft === (value ?? '')) return;
    setError(onCommit(draft));
  };
  const common = {
    id,
    value: draft,
    placeholder,
    'data-path': path,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
    onFocus: () => {
      editing.current = true;
    },
    onBlur: commit,
  };
  return (
    <div className={`field${error ? ' invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea {...common} rows={3} onChange={(e) => setDraft(e.target.value)} />
      ) : (
        <input
          {...common}
          type={type}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
        />
      )}
      {error ? (
        <p className="error" id={`${id}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Select({
  label,
  path,
  value,
  options,
  onCommit,
}: {
  label: string;
  path: string;
  value: string;
  options: [string, string][];
  onCommit: Commit;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={`field${error ? ' invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        data-path={path}
        value={value}
        onChange={(e) => setError(onCommit(e.target.value))}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

/** One item of a list (a schedule entry, a venue) with move and remove. */
export function Item({
  title,
  index,
  count,
  onMove,
  onRemove,
  children,
}: {
  title: string;
  index: number;
  count: number;
  onMove: (to: number) => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <li className="item">
      <div className="item-head">
        <strong>{title}</strong>
        <span className="item-actions">
          <button
            type="button"
            aria-label={`Move ${title} up`}
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`Move ${title} down`}
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
          >
            ↓
          </button>
          <button type="button" aria-label={`Remove ${title}`} onClick={onRemove}>
            ✕
          </button>
        </span>
      </div>
      {children}
    </li>
  );
}
