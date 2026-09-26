'use client';

import { useState } from 'react';
import { Pill } from '../ui';
import {
  Field,
  FormError,
  useConnectionSubmit,
} from './ConnectionForm';

/**
 * AI provider credentials — one row per provider, so Anthropic and OpenAI can
 * both be configured and either can be the fallback for the other.
 *
 * The key is not a field. `sk-ant-…` is a perfectly ordinary-looking string, so
 * "that is a reference, not a secret" is checked in the database: a value with
 * no scheme is refused.
 */

const MESSAGES: Record<string, string> = {
  UNSUPPORTED_PROVIDER: 'Only Anthropic and OpenAI are supported.',
  MODEL_REQUIRED: 'Name the model this credential is for.',
  ENCRYPTION_NOT_CONFIGURED: 'Set AGENTSYNC_ENCRYPTION_KEY in Vercel first, or enter env:ANTHROPIC_API_KEY instead of the key.',
  CAP_MUST_BE_POSITIVE: 'A monthly cap must be greater than zero.',
  NO_CAP_TO_ENFORCE:
    'Either set a monthly cap, or leave the hard stop on. A cap that stops nothing would read as a limit without being one.',
};

const PROVIDERS = [
  {
    value: 'anthropic',
    label: 'Anthropic',
    envHint: 'env:ANTHROPIC_API_KEY',
    modelHint: 'claude-opus-5',
    where: 'console.anthropic.com → Settings → API keys',
    url: 'https://console.anthropic.com/settings/keys',
  },
  {
    value: 'openai',
    label: 'OpenAI',
    envHint: 'env:OPENAI_API_KEY',
    modelHint: 'gpt-5.1',
    where: 'platform.openai.com → API keys',
    url: 'https://platform.openai.com/api-keys',
  },
];

type Credential = Record<string, unknown>;

function ProviderForm({
  tenantSlug,
  provider,
  existing,
}: {
  tenantSlug: string | null;
  provider: (typeof PROVIDERS)[number];
  existing: Credential | null;
}) {
  const { busy, error, call } = useConnectionSubmit(
    '/api/portal/connections/ai',
    MESSAGES,
  );

  const [model, setModel] = useState(String(existing?.model ?? ''));
  // A stored key is never shown back; blank keeps it.
  const storedRef = existing?.key_reference ? String(existing.key_reference) : null;
  const [keyRef, setKeyRef] = useState(
    storedRef && !storedRef.startsWith('db:') ? storedRef : '',
  );
  const [triggers, setTriggers] = useState(
    String(existing?.failover_triggers ?? ''),
  );
  const [optin, setOptin] = useState(
    existing ? Boolean(existing.failover_requires_optin) : true,
  );
  const [cap, setCap] = useState(
    existing?.monthly_cap != null ? String(existing.monthly_cap) : '',
  );
  const [hardStop, setHardStop] = useState(
    existing ? Boolean(existing.hard_stop_at_cap) : true,
  );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantSlug) return;
    await call('POST', {
      tenant_slug: tenantSlug,
      provider: provider.value,
      model,
      key_reference: keyRef.trim() || storedRef || '',
      failover_triggers: triggers,
      failover_requires_optin: optin,
      monthly_cap: cap === '' ? null : Number(cap),
      hard_stop_at_cap: hardStop,
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="text-[14.5px] font-semibold">{provider.label}</div>
        <Pill c={existing ? ['#DDEFE3', '#17603C'] : ['#F0ECE3', '#5B5D66']}>
          {existing ? 'CONFIGURED' : 'NOT CONFIGURED'}
        </Pill>
        <a
          className="mono text-[12px] text-accent"
          href={provider.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          {provider.where} ↗
        </a>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Field
          label="API key"
          hint={
            storedRef?.startsWith('db:')
              ? 'A key is stored, encrypted. Paste a new one to replace it, or leave blank to keep it.'
              : `Paste the key — it is stored encrypted and never shown again. Or enter ${provider.envHint} to use a Vercel variable.`
          }
        >
          <input
            className="field-input mono"
            type="password"
            autoComplete="off"
            value={keyRef}
            onChange={(e) => setKeyRef(e.target.value)}
            placeholder={storedRef?.startsWith('db:') ? '•••••••• stored' : `sk-… or ${provider.envHint}`}
            required={!storedRef}
          />
        </Field>

        <Field
          label="model (optional)"
          hint="Leave blank — each agent uses its own model from Agents → Models by tier. Only used for an agent without a tier model."
        >
          <input
            className="field-input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="use the agents' tier models"
          />
        </Field>

        <Field
          label="monthly_cap"
          hint="Spend ceiling for this provider, in dollars. Leave empty for no cap — then the hard stop must stay on."
        >
          <input
            className="field-input"
            value={cap}
            onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            placeholder="200"
          />
        </Field>

        <Field
          label="hard_stop_at_cap"
          hint="true stops work at the cap. false only warns, and needs a cap set to mean anything."
        >
          <select
            className="field-select"
            value={String(hardStop)}
            onChange={(e) => setHardStop(e.target.value === 'true')}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </Field>

        <Field
          label="failover_triggers"
          hint="When the other provider may take over: rate_limit, timeout, 5xx. Free text."
        >
          <input
            className="field-input"
            value={triggers}
            onChange={(e) => setTriggers(e.target.value)}
            placeholder="rate_limit, timeout"
          />
        </Field>

        <Field
          label="failover_requires_optin"
          hint="true means a project must opt in before its work is sent to the fallback provider."
        >
          <select
            className="field-select"
            value={String(optin)}
            onChange={(e) => setOptin(e.target.value === 'true')}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </Field>
      </div>

      <FormError message={error} />

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={busy || !tenantSlug}>
          {busy ? 'Saving…' : existing ? 'Save changes' : `Add ${provider.label}`}
        </button>
        {existing ? (
          <button
            type="button"
            className="btn-danger"
            disabled={busy}
            onClick={() =>
              call('DELETE', undefined, {
                tenant: tenantSlug ?? '',
                provider: provider.value,
              })
            }
          >
            Remove
          </button>
        ) : null}
      </div>
    </form>
  );
}

export default function AiForm({
  tenantSlug,
  credentials,
}: {
  tenantSlug: string | null;
  credentials: Record<string, unknown>[];
}) {
  return (
    <div className="flex flex-col gap-8">
      {PROVIDERS.map((p) => (
        <ProviderForm
          key={p.value}
          tenantSlug={tenantSlug}
          provider={p}
          existing={credentials.find((c) => String(c.provider) === p.value) ?? null}
        />
      ))}
    </div>
  );
}
