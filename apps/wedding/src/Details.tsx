import type { ApplyResult, Store } from '@bowerbirdjs/core';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Field, Item, Select } from './fields.js';
import type {
  Dresscode,
  EventInfo,
  FaqItem,
  Gifts,
  ScheduleItem,
  SiteLocale,
  Stay,
  Travel,
  Venue,
} from './site/facts.js';
import { OCCASIONS } from './site/facts.js';

type Change = (ops: unknown[], label: string) => ApplyResult;

const errorOf = (r: ApplyResult) => (r.ok ? null : (r.errors[0]?.message ?? 'Not saved.'));

const NEW: Record<
  SiteLocale,
  { venue: string; item: string; stay: string; q: string; a: string; colour: string; link: string }
> = {
  de: {
    venue: 'Neuer Ort',
    item: 'Neuer Programmpunkt',
    stay: 'Neue Unterkunft',
    q: 'Neue Frage',
    a: 'Antwort',
    colour: 'Farbe',
    link: 'Link',
  },
  en: {
    venue: 'New venue',
    item: 'New item',
    stay: 'New place to stay',
    q: 'New question',
    a: 'Answer',
    colour: 'Colour',
    link: 'Link',
  },
};

/** The Details group that holds a data path (places to stay live under travel). */
const groupOf = (path: string) => {
  const group = path.split('.')[0]!;
  return group === 'stays' ? 'travel' : group;
};

const OCCASION_LABELS: Record<(typeof OCCASIONS)[number], string> = {
  wedding: 'Wedding',
  birthday: 'Birthday',
  anniversary: 'Anniversary',
  party: 'Party',
  company: 'Company event',
};

/**
 * The event details: everything guests ask about, stored once. Sections on the page show these;
 * a change here reaches every section that shows it. Each edit is one undoable change, shared
 * with the page editor's history.
 */
export function Details({
  store,
  change,
  focus,
  onLanguage,
}: {
  store: Store;
  change: Change;
  /** Data path to bring into view and focus (after a click on the page). */
  focus: { path: string; at: number; field: boolean } | null;
  onLanguage: (locale: SiteLocale) => void;
}) {
  const data = <T,>(key: string) => store.view.data(key) as T | undefined;
  const event = data<EventInfo>('event')!;
  const locale = event.locale;
  const n = NEW[locale];
  const set = (key: string, path: (string | number)[], value: unknown, label: string) =>
    errorOf(change([{ op: 'data.set', key, ...(path.length ? { path } : {}), value }], label));
  /** Optional text: empty removes it. */
  const text = (key: string, path: (string | number)[], label: string) => (v: string) =>
    set(key, path, v.trim() === '' ? null : v, label);
  const list = <T,>(key: string, label: string) => {
    const items = data<T[]>(key) ?? [];
    return {
      items,
      add: (item: T) => set(key, [items.length], item, `Add ${label}`),
      move: (from: number, to: number) => {
        const next = [...items];
        next.splice(to, 0, ...next.splice(from, 1));
        return set(key, [], next, `Reorder ${label}`);
      },
      remove: (i: number) => set(key, [i], null, `Remove ${label}`),
    };
  };

  const venues = list<Venue>('venues', 'venue');
  const schedule = list<ScheduleItem>('schedule', 'schedule item');
  const stays = list<Stay>('stays', 'place to stay');
  const faq = list<FaqItem>('faq', 'question');
  const travel = data<Travel>('travel') ?? {};
  const dress = data<Dresscode>('dresscode') ?? { colors: [] };
  const gifts = data<Gifts>('gifts') ?? { links: [] };

  // Bring a field into view when the page asks for it (a click on fact text). The group opens
  // first; the field is focused once it is rendered open.
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(['event']));
  const pending = useRef<typeof focus>(null);
  useEffect(() => {
    if (!focus) return;
    pending.current = focus;
    const group = groupOf(focus.path);
    setOpen((o) => (o.has(group) ? o : new Set([...o, group])));
  }, [focus]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after the group has opened
  useEffect(() => {
    const target = pending.current;
    if (!target) return;
    const group = groupOf(target.path);
    const box = root.current?.querySelector<HTMLDetailsElement>(
      `[data-group="${CSS.escape(group)}"]`,
    );
    if (!box?.open) return;
    pending.current = null;
    if (!target.field) {
      box.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    const el =
      box.querySelector<HTMLElement>(`[data-path="${CSS.escape(target.path)}"]`) ??
      box.querySelector<HTMLElement>('[data-path]');
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }, [open, focus]);

  const group = (key: string, title: string, status: string, children: ReactNode) => (
    <details
      className="group"
      data-group={key}
      open={open.has(key)}
      onToggle={(e) => {
        const isOpen = (e.target as HTMLDetailsElement).open;
        setOpen((o) => {
          const next = new Set(o);
          if (isOpen) next.add(key);
          else next.delete(key);
          return next;
        });
      }}
    >
      <summary>
        <span>{title}</span>
        <span className="status">{status}</span>
      </summary>
      <div className="group-body">{children}</div>
    </details>
  );
  const count = (k: number, one: string, many: string) =>
    k ? `${k} ${k === 1 ? one : many}` : 'missing';

  return (
    <div className="details" ref={root}>
      {group(
        'event',
        'Event',
        event.date ?? 'no date',
        <>
          <Field
            label="Title (your names)"
            path="event.title"
            value={event.title}
            onCommit={(v) => set('event', [], { ...event, title: v }, 'Event title')}
          />
          <Field
            label="Date"
            path="event.date"
            type="date"
            value={event.date ?? ''}
            onCommit={(v) => set('event', [], { ...event, date: v || null }, 'Event date')}
          />
          <Select
            label="Language of the site"
            path="event.locale"
            value={locale}
            options={[
              ['de', 'Deutsch'],
              ['en', 'English'],
            ]}
            onCommit={(v) => {
              onLanguage(v as SiteLocale);
              return null;
            }}
          />
          <Select
            label="Occasion"
            path="event.occasion"
            value={event.occasion}
            options={OCCASIONS.map((o) => [o, OCCASION_LABELS[o]])}
            onCommit={(v) => set('event', ['occasion'], v, 'Occasion')}
          />
        </>,
      )}

      {group(
        'venues',
        'Venues',
        count(venues.items.length, 'venue', 'venues'),
        <>
          <ol className="items">
            {venues.items.map((v, i) => (
              <Item
                key={v.id}
                title={v.name}
                index={i}
                count={venues.items.length}
                onMove={(to) => venues.move(i, to)}
                onRemove={() => venues.remove(i)}
              >
                <Field
                  label="Role (e.g. ceremony)"
                  path={`venues.${i}.role`}
                  value={v.role}
                  onCommit={text('venues', [i, 'role'], 'Venue')}
                />
                <Field
                  label="Name"
                  path={`venues.${i}.name`}
                  value={v.name}
                  onCommit={(x) => set('venues', [i, 'name'], x, 'Venue')}
                />
                <Field
                  label="Address"
                  path={`venues.${i}.address`}
                  multiline
                  value={v.address}
                  onCommit={text('venues', [i, 'address'], 'Venue')}
                />
                <Field
                  label="Map link"
                  path={`venues.${i}.mapUrl`}
                  type="url"
                  value={v.mapUrl}
                  placeholder="https://"
                  hint="Optional. Without it, guests get directions from the address."
                  onCommit={text('venues', [i, 'mapUrl'], 'Venue')}
                />
                <Field
                  label="Note"
                  path={`venues.${i}.note`}
                  multiline
                  value={v.note}
                  onCommit={text('venues', [i, 'note'], 'Venue')}
                />
              </Item>
            ))}
          </ol>
          <button
            type="button"
            className="add"
            disabled={venues.items.length >= 6}
            onClick={() => {
              let k = venues.items.length + 1;
              while (venues.items.some((v) => v.id === `venue-${k}`)) k++;
              venues.add({ id: `venue-${k}`, name: n.venue });
            }}
          >
            Add venue
          </button>
        </>,
      )}

      {group(
        'schedule',
        'Schedule',
        count(schedule.items.length, 'item', 'items'),
        <>
          <ol className="items">
            {schedule.items.map((s, i) => (
              <Item
                // biome-ignore lint/suspicious/noArrayIndexKey: items have no ids; position is the identity
                key={i}
                title={`${s.time} ${s.title}`}
                index={i}
                count={schedule.items.length}
                onMove={(to) => schedule.move(i, to)}
                onRemove={() => schedule.remove(i)}
              >
                <Field
                  label="Time"
                  type="time"
                  path={`schedule.${i}.time`}
                  value={s.time}
                  onCommit={(x) => set('schedule', [i, 'time'], x, 'Schedule')}
                />
                <Field
                  label="What"
                  path={`schedule.${i}.title`}
                  value={s.title}
                  onCommit={(x) => set('schedule', [i, 'title'], x, 'Schedule')}
                />
                <Field
                  label="Details"
                  path={`schedule.${i}.text`}
                  multiline
                  value={s.text}
                  onCommit={text('schedule', [i, 'text'], 'Schedule')}
                />
                <Select
                  label="Where"
                  path={`schedule.${i}.venue`}
                  value={s.venue ?? ''}
                  options={[
                    ['', '—'],
                    ...venues.items.map((v) => [v.id, v.name] as [string, string]),
                  ]}
                  onCommit={text('schedule', [i, 'venue'], 'Schedule')}
                />
              </Item>
            ))}
          </ol>
          <button
            type="button"
            className="add"
            disabled={schedule.items.length >= 24}
            onClick={() =>
              schedule.add({ time: schedule.items.at(-1)?.time ?? '12:00', title: n.item })
            }
          >
            Add schedule item
          </button>
        </>,
      )}

      {group(
        'travel',
        'Travel and stay',
        travel.text || stays.items.length
          ? count(stays.items.length, 'place to stay', 'places to stay').replace(
              'missing',
              'no places to stay',
            )
          : 'missing',
        <>
          <Field
            label="Getting there"
            path="travel.text"
            multiline
            value={travel.text}
            onCommit={text('travel', ['text'], 'Travel')}
          />
          <Field
            label="Parking"
            path="travel.parking"
            multiline
            value={travel.parking}
            onCommit={text('travel', ['parking'], 'Travel')}
          />
          <h4>Places to stay</h4>
          <ol className="items">
            {stays.items.map((s, i) => (
              <Item
                // biome-ignore lint/suspicious/noArrayIndexKey: items have no ids; position is the identity
                key={i}
                title={s.name}
                index={i}
                count={stays.items.length}
                onMove={(to) => stays.move(i, to)}
                onRemove={() => stays.remove(i)}
              >
                <Field
                  label="Name"
                  path={`stays.${i}.name`}
                  value={s.name}
                  onCommit={(x) => set('stays', [i, 'name'], x, 'Place to stay')}
                />
                <Field
                  label="Address"
                  path={`stays.${i}.address`}
                  value={s.address}
                  onCommit={text('stays', [i, 'address'], 'Place to stay')}
                />
                <Field
                  label="Website"
                  type="url"
                  path={`stays.${i}.url`}
                  value={s.url}
                  placeholder="https://"
                  onCommit={text('stays', [i, 'url'], 'Place to stay')}
                />
                <Field
                  label="Note"
                  path={`stays.${i}.note`}
                  multiline
                  value={s.note}
                  onCommit={text('stays', [i, 'note'], 'Place to stay')}
                />
              </Item>
            ))}
          </ol>
          <button
            type="button"
            className="add"
            disabled={stays.items.length >= 8}
            onClick={() => stays.add({ name: n.stay })}
          >
            Add place to stay
          </button>
        </>,
      )}

      {group(
        'dresscode',
        'Dress code',
        dress.style || dress.text || dress.colors.length
          ? (dress.style ?? `${dress.colors.length} colours`)
          : 'missing',
        <>
          <Field
            label="Style"
            path="dresscode.style"
            value={dress.style}
            onCommit={text('dresscode', ['style'], 'Dress code')}
          />
          <Field
            label="Text"
            path="dresscode.text"
            multiline
            value={dress.text}
            onCommit={text('dresscode', ['text'], 'Dress code')}
          />
          <h4>Colours</h4>
          <ol className="items colours">
            {dress.colors.map((c, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: items have no ids; position is the identity
                key={i}
                className="colour"
              >
                <input
                  type="color"
                  aria-label={`${c.name} colour`}
                  value={c.hex}
                  onChange={(e) =>
                    set('dresscode', ['colors', i, 'hex'], e.target.value, 'Dress code colour')
                  }
                />
                <Field
                  label="Name"
                  path={`dresscode.colors.${i}.name`}
                  value={c.name}
                  onCommit={(x) => set('dresscode', ['colors', i, 'name'], x, 'Dress code colour')}
                />
                <button
                  type="button"
                  aria-label={`Remove ${c.name}`}
                  onClick={() => set('dresscode', ['colors', i], null, 'Remove colour')}
                >
                  ✕
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="add"
            disabled={dress.colors.length >= 8}
            onClick={() =>
              set(
                'dresscode',
                [],
                { ...dress, colors: [...dress.colors, { hex: '#c9a27e', name: n.colour }] },
                'Add colour',
              )
            }
          >
            Add colour
          </button>
        </>,
      )}

      {group(
        'gifts',
        'Gifts',
        gifts.text || gifts.links.length
          ? count(gifts.links.length, 'link', 'links').replace('missing', 'text only')
          : 'missing',
        <>
          <Field
            label="Text"
            path="gifts.text"
            multiline
            value={gifts.text}
            onCommit={text('gifts', ['text'], 'Gifts')}
          />
          <ol className="items">
            {gifts.links.map((l, i) => (
              <Item
                // biome-ignore lint/suspicious/noArrayIndexKey: items have no ids; position is the identity
                key={i}
                title={l.label}
                index={i}
                count={gifts.links.length}
                onMove={(to) => {
                  const next = [...gifts.links];
                  next.splice(to, 0, ...next.splice(i, 1));
                  set('gifts', ['links'], next, 'Reorder links');
                }}
                onRemove={() => set('gifts', ['links', i], null, 'Remove link')}
              >
                <Field
                  label="Label"
                  path={`gifts.links.${i}.label`}
                  value={l.label}
                  onCommit={(x) => set('gifts', ['links', i, 'label'], x, 'Gift link')}
                />
                <Field
                  label="Link"
                  type="url"
                  path={`gifts.links.${i}.url`}
                  value={l.url}
                  onCommit={(x) => set('gifts', ['links', i, 'url'], x, 'Gift link')}
                />
              </Item>
            ))}
          </ol>
          <button
            type="button"
            className="add"
            disabled={gifts.links.length >= 6}
            onClick={() =>
              set(
                'gifts',
                [],
                {
                  ...gifts,
                  links: [...gifts.links, { label: n.link, url: 'https://example.com' }],
                },
                'Add link',
              )
            }
          >
            Add link
          </button>
        </>,
      )}

      {group(
        'faq',
        'Questions',
        count(faq.items.length, 'question', 'questions'),
        <>
          <ol className="items">
            {faq.items.map((f, i) => (
              <Item
                // biome-ignore lint/suspicious/noArrayIndexKey: items have no ids; position is the identity
                key={i}
                title={f.q}
                index={i}
                count={faq.items.length}
                onMove={(to) => faq.move(i, to)}
                onRemove={() => faq.remove(i)}
              >
                <Field
                  label="Question"
                  path={`faq.${i}.q`}
                  value={f.q}
                  onCommit={(x) => set('faq', [i, 'q'], x, 'Question')}
                />
                <Field
                  label="Answer"
                  path={`faq.${i}.a`}
                  multiline
                  value={f.a}
                  onCommit={(x) => set('faq', [i, 'a'], x, 'Answer')}
                />
              </Item>
            ))}
          </ol>
          <button
            type="button"
            className="add"
            disabled={faq.items.length >= 20}
            onClick={() => faq.add({ q: n.q, a: n.a })}
          >
            Add question
          </button>
        </>,
      )}
    </div>
  );
}
