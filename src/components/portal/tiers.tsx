'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Low / Medium / High: each agent has a model (and thinking effort) per tier;
 * a request runs at one tier, chosen on the request and defaulting to its
 * project's.
 */

export const TIERS = ['low', 'medium', 'high'] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABEL: Record<Tier, string> = { low: 'Low', medium: 'Medium', high: 'High' };
export const TIER_HINT: Record<Tier, string> = {
  low: 'Cheapest — copy changes, config tweaks, dependency bumps (~$0.40–0.80 a task)',
  medium: 'Balanced — most features and fixes (~$1–2 a task)',
  high: 'Best quality — tricky logic, migrations, security-sensitive code (~$2–4 a task)',
};

export const MODELS: { id: string; label: string; note?: string }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-opus-5', label: 'Claude Opus 5' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: 'no thinking effort' },
  { id: 'claude-fable-5', label: 'Claude Fable 5', note: 'your limit: 50 requests, 20K output tokens a minute' },
];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const EFFORT_LABEL: Record<string, string> = {
  low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max',
};

export type Slot = { agent_key: string; tier: Tier; model: string; effort: string | null; overridden: boolean };
export type TierSettings = { can_edit: boolean; slots: Slot[]; projects: Record<string, Tier> };

export function modelLabel(id: string) {
  return MODELS.find((m) => m.id === id)?.label ?? id;
}

export function useTierSettings(tenantSlug: string | null) {
  const [settings, setSettings] = useState<TierSettings | null>(null);
  const load = useCallback(async () => {
    if (!tenantSlug) return;
    const res = await fetch(`/api/portal/tiers?tenant=${encodeURIComponent(tenantSlug)}`);
    if (res.ok) setSettings((await res.json()) as TierSettings);
  }, [tenantSlug]);
  useEffect(() => {
    void load();
  }, [load]);
  return { settings, reload: load };
}

/** The Agents screen's "Models by tier" tab: three editable slots for one agent. */
export function TierModels({ agentKey, tenantSlug }: { agentKey: string; tenantSlug: string | null }) {
  const { settings, reload } = useTierSettings(tenantSlug);
  const slots = (settings?.slots ?? []).filter((s) => s.agent_key === agentKey);

  if (!settings) return <div className="p-4 text-[14px] text-muted">Loading…</div>;
  if (slots.length === 0) {
    return (
      <div className="p-4 text-[14px] text-muted">
        This agent has no tier models. Tiers apply to the planner, engineer, reviewer, analyst,
        validator, security auditor and documenter.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="max-w-[80ch] text-[14px] text-muted" style={{ lineHeight: 1.6 }}>
        Each request runs at one tier — picked on the request, defaulting to the project&apos;s — and
        this agent uses the model below for it. Higher effort means more thinking: better results,
        more time and tokens.
      </div>
      {slots.map((slot) => (
        <SlotRow
          key={slot.tier}
          slot={slot}
          tenantSlug={tenantSlug}
          canEdit={settings.can_edit}
          onSaved={reload}
        />
      ))}
    </div>
  );
}

function SlotRow({
  slot,
  tenantSlug,
  canEdit,
  onSaved,
}: {
  slot: Slot;
  tenantSlug: string | null;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [model, setModel] = useState(slot.model);
  const [effort, setEffort] = useState(slot.effort ?? 'high');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const noEffort = model.startsWith('claude-haiku-4-5');
  const dirty = model !== slot.model || (!noEffort && effort !== (slot.effort ?? 'high'));

  async function send(method: 'PUT' | 'DELETE') {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch('/api/portal/tiers', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenant_slug: tenantSlug,
          agent_key: slot.agent_key,
          tier: slot.tier,
          ...(method === 'PUT' ? { model, effort: noEffort ? null : effort } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setProblem(data.error === 'NOT_AUTHORISED' ? 'Only a tenant admin can change models.' : `Could not save (${data.error ?? res.status}).`);
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 items-center gap-3 rounded-xl border border-line-soft bg-raised px-4 py-3 md:grid-cols-[110px_1fr_170px_auto]">
      <div className="flex items-center gap-2">
        <TierBadge tier={slot.tier} />
        {slot.overridden ? <span className="text-[11.5px] text-muted-2">custom</span> : null}
      </div>
      <select
        className="field-select"
        value={model}
        disabled={!canEdit || busy}
        onChange={(e) => setModel(e.target.value)}
        aria-label={`${TIER_LABEL[slot.tier]} model`}
      >
        {MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}{m.note ? ` — ${m.note}` : ''}
          </option>
        ))}
      </select>
      <select
        className="field-select"
        value={noEffort ? '' : effort}
        disabled={!canEdit || busy || noEffort}
        onChange={(e) => setEffort(e.target.value)}
        aria-label={`${TIER_LABEL[slot.tier]} effort`}
      >
        {noEffort ? <option value="">No effort setting</option> : null}
        {EFFORTS.map((e) => (
          <option key={e} value={e}>{EFFORT_LABEL[e]} effort</option>
        ))}
      </select>
      <div className="flex gap-2">
        {canEdit && dirty ? (
          <button className="btn-primary" disabled={busy} onClick={() => send('PUT')}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        ) : null}
        {canEdit && slot.overridden && !dirty ? (
          <button className="btn" disabled={busy} onClick={() => send('DELETE')}>Reset</button>
        ) : null}
      </div>
      {problem ? <div className="text-[13px] text-danger-ink md:col-span-4">{problem}</div> : null}
    </div>
  );
}

export function TierBadge({ tier }: { tier: string | null | undefined }) {
  const t = (tier ?? 'medium') as Tier;
  const tone =
    t === 'high' ? 'bg-ink text-canvas' : t === 'medium' ? 'bg-agent-tint text-agent-ink' : 'bg-line-faint text-ink-3';
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${tone}`}>
      {TIER_LABEL[t] ?? t}
    </span>
  );
}

/** A Low / Medium / High segmented picker. */
export function TierPicker({
  value,
  onChange,
  disabled,
}: {
  value: Tier;
  onChange: (t: Tier) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div role="radiogroup" aria-label="Tier" className="inline-flex w-fit rounded-xl border border-line bg-card p-1">
        {TIERS.map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={value === t}
            disabled={disabled}
            onClick={() => onChange(t)}
            className={`min-h-[34px] cursor-pointer rounded-lg px-4 text-[13.5px] font-medium ${
              value === t ? 'bg-ink text-canvas' : 'text-ink-3 hover:bg-canvas'
            }`}
          >
            {TIER_LABEL[t]}
          </button>
        ))}
      </div>
      <span className="text-[12.5px] text-muted-2">{TIER_HINT[value]}</span>
    </div>
  );
}
