'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ago, type Line, type Row } from '@/lib/portal-ui';

/* ---- editable configuration fields ---------------------------------- */

type FieldStore = {
  values: Record<string, string>;
  set: (id: string, value: string) => void;
};

const FieldContext = createContext<FieldStore | null>(null);

/**
 * Holds every edited configuration value for the session, keyed by
 * `<group>|<field>`. Edits survive tab and screen changes the way they would
 * once the portal is writing back to Supabase.
 */
export function FieldProvider({ children }: { children: React.ReactNode }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const set = useCallback((id: string, value: string) => {
    setValues((prev) => ({ ...prev, [id]: value }));
  }, []);
  const store = useMemo(() => ({ values, set }), [values, set]);
  return (
    <FieldContext.Provider value={store}>{children}</FieldContext.Provider>
  );
}

function useFieldStore(): FieldStore {
  const store = useContext(FieldContext);
  if (!store) throw new Error('FieldProvider is missing');
  return store;
}

/** A boolean-valued row renders as a select; everything else as a text input. */
export function FieldRows({ prefix, rows }: { prefix: string; rows: Row[] }) {
  const { values, set } = useFieldStore();

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-2">
      {rows.map((r) => {
        const id = `${prefix}|${r.key}`;
        const value = values[id] ?? r.value;
        const isBool = value === 'true' || value === 'false';
        return (
          <div
            key={r.key}
            className="grid grid-cols-[minmax(140px,190px)_1fr] items-center gap-3"
          >
            <label
              className="mono truncate text-muted-2"
              style={{ fontSize: 11 }}
              htmlFor={id}
            >
              {r.key}
            </label>
            {isBool ? (
              <select
                id={id}
                className="field-select"
                style={{ color: r.color }}
                value={value}
                onChange={(e) => set(id, e.target.value)}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                id={id}
                className="field-input"
                style={{ color: r.color }}
                value={value}
                onChange={(e) => set(id, e.target.value)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function useRoleField(id: string, initial: string) {
  const { values, set } = useFieldStore();
  return [values[id] ?? initial, (v: string) => set(id, v)] as const;
}

/* ---- presentational primitives -------------------------------------- */

/**
 * "4m ago", but only once the browser has it.
 *
 * How long ago something happened depends on the clock reading it, so the
 * server and the browser would disagree and React would report a hydration
 * mismatch. The date renders first and is replaced on mount.
 */
export function Ago({ iso }: { iso: string | null }) {
  const [relative, setRelative] = useState<string | null>(null);
  useEffect(() => {
    setRelative(ago(iso));
    const id = setInterval(() => setRelative(ago(iso)), 30_000);
    return () => clearInterval(id);
  }, [iso]);

  if (!iso) return <>—</>;
  return <>{relative ?? iso.slice(0, 10)}</>;
}

export function Pill({
  children,
  c,
  className = '',
  style,
}: {
  children: React.ReactNode;
  c: [string, string];
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={`pill ${className}`}
      style={{ background: c[0], color: c[1], ...style }}
    >
      {children}
    </span>
  );
}

export function ColLabel({
  children,
  right = false,
}: {
  children: React.ReactNode;
  right?: boolean;
}) {
  return <div className={`label ${right ? 'text-right' : ''}`}>{children}</div>;
}

export function SectionTitle({
  title,
  meta,
  right,
}: {
  title: string;
  meta?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="text-[13px] font-semibold">{title}</div>
      {meta ? (
        <div className="mono text-muted-2" style={{ fontSize: 10 }}>
          {meta}
        </div>
      ) : null}
      <div className="flex-1" />
      {right}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: { k: T; label: string; dot?: string }[];
  active: T;
  onSelect: (k: T) => void;
}) {
  return (
    <div className="flex flex-wrap">
      {tabs.map((t) => (
        <button
          key={t.k}
          onClick={() => onSelect(t.k)}
          className="flex cursor-pointer items-center gap-2 border-b-2 px-4 py-[11px] text-[12.5px] font-medium"
          style={{
            borderBottomColor: active === t.k ? 'var(--color-accent)' : 'transparent',
            color: active === t.k ? '#F2F2F4' : '#71717B',
          }}
        >
          {t.label}
          {t.dot && t.dot !== 'transparent' ? (
            <span
              className="size-1.5 rounded-full"
              style={{ background: active === t.k ? t.dot : '#2E2E33' }}
            />
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function CodeBlock({ lines }: { lines: Line[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-canvas p-3.5">
      {lines.map((l, i) => (
        <div
          key={i}
          className="mono whitespace-pre"
          style={{ fontSize: 11.5, lineHeight: 1.75, color: l.color }}
        >
          {l.text || ' '}
        </div>
      ))}
    </div>
  );
}

export function Bar({
  pct,
  color,
  height = 4,
}: {
  pct: string;
  color: string;
  height?: number;
}) {
  return (
    <div
      className="overflow-hidden rounded-[3px] bg-line"
      style={{ height }}
      role="presentation"
    >
      <div className="h-full" style={{ width: pct, background: color }} />
    </div>
  );
}

/**
 * What a screen shows when the tenant has no rows for it.
 *
 * It says which table is empty and what would put something in it, because
 * "nothing here" and "something is broken" look identical otherwise. It never
 * stands in for data that failed to load — that is an error, not an empty
 * state, and the screens raise it separately.
 */
export function Empty({
  title,
  detail,
  table,
}: {
  title: string;
  detail: string;
  table?: string;
}) {
  return (
    <div className="card flex flex-col items-start gap-2 p-8">
      <div className="text-[13.5px] font-semibold text-ink-2">{title}</div>
      <div
        className="max-w-[62ch] text-[12.5px] text-muted"
        style={{ lineHeight: 1.6 }}
      >
        {detail}
      </div>
      {table ? (
        <div className="mono mt-1 text-[10px] text-muted-3">{table}</div>
      ) : null}
    </div>
  );
}

/** Wrapper that keeps wide tables scrollable inside the card instead of the page. */
export function TableCard({
  children,
  head,
}: {
  children: React.ReactNode;
  head?: React.ReactNode;
}) {
  return (
    <div className="card overflow-hidden">
      {head}
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}
