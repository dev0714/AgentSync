'use client';

import { useState } from 'react';
import { ColLabel, Pill } from '../ui';
import { Field, FormError, useConnectionSubmit } from './ConnectionForm';

/**
 * Webhook endpoints — inbound paths on this application, outbound callback
 * URLs somewhere else.
 *
 * An enabled endpoint with no signing secret would accept or send
 * unauthenticated traffic, so the database refuses that combination outright
 * rather than letting the row look configured.
 */

const MESSAGES: Record<string, string> = {
  BAD_DIRECTION: 'Choose inbound or outbound.',
  BAD_PATH: 'An inbound endpoint is a path on this application, starting with /.',
  CALLBACK_MUST_BE_HTTPS: 'An outbound callback must be an https URL.',
  SIGNING_SECRET_REQUIRED:
    'An enabled endpoint needs a signing secret — without one it would accept or send unauthenticated traffic. Add a reference, or save it disabled.',
  REPLAY_WINDOW_OUT_OF_RANGE: 'The replay window must be between 30 and 3600 seconds.',
};

export type Endpoint = {
  direction: string;
  path: string;
  note: string | null;
  replay_window_seconds: number | null;
  enabled: boolean;
  signing_secret_ref?: string | null;
};

const GRID =
  'grid min-w-[820px] grid-cols-[60px_minmax(240px,1fr)_180px_110px_90px_90px] items-center gap-3';

export default function WebhookForm({
  tenantSlug,
  endpoints,
}: {
  tenantSlug: string | null;
  endpoints: Endpoint[];
}) {
  const { busy, error, call } = useConnectionSubmit(
    '/api/portal/connections/webhooks',
    MESSAGES,
  );

  const [direction, setDirection] = useState('IN');
  const [path, setPath] = useState('');
  const [note, setNote] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [replay, setReplay] = useState('300');
  const [enabled, setEnabled] = useState(true);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantSlug) return;
    const saved = await call('POST', {
      tenant_slug: tenantSlug,
      direction,
      path,
      note,
      signing_secret_ref: secretRef,
      replay_window_seconds: Number(replay),
      enabled,
    });
    if (saved) {
      setPath('');
      setNote('');
      setSecretRef('');
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {endpoints.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-line">
          <div className={`${GRID} border-b border-line bg-raised px-3.5 py-[9px]`}>
            <ColLabel>DIR</ColLabel>
            <ColLabel>PATH / URL</ColLabel>
            <ColLabel>SIGNING SECRET</ColLabel>
            <ColLabel>REPLAY</ColLabel>
            <ColLabel>STATE</ColLabel>
            <ColLabel right>{''}</ColLabel>
          </div>
          {endpoints.map((h) => (
            <div
              key={h.path}
              className={`${GRID} border-b border-line-faint px-3.5 py-2.5 last:border-b-0`}
            >
              <span
                className="mono text-[10px]"
                style={{ color: h.direction === 'IN' ? '#7FB6E0' : '#6FD69C' }}
              >
                {h.direction}
              </span>
              <div className="min-w-0">
                <div className="mono truncate text-[11.5px] text-ink-2">{h.path}</div>
                <div className="text-[11px] text-muted-2">{h.note ?? ''}</div>
              </div>
              <span className="mono truncate text-[10.5px] text-muted">
                {h.signing_secret_ref ?? '—'}
              </span>
              <span className="mono text-[10.5px] text-muted-2">
                {h.replay_window_seconds ?? '—'}s
              </span>
              <Pill c={h.enabled ? ['#122E1E', '#6FD69C'] : ['#212125', '#9A9AA3']}>
                {h.enabled ? 'ENABLED' : 'DISABLED'}
              </Pill>
              <div className="text-right">
                <button
                  type="button"
                  className="mono cursor-pointer text-[10.5px] text-muted-2 hover:text-danger"
                  disabled={busy}
                  onClick={() =>
                    call('DELETE', undefined, {
                      tenant: tenantSlug ?? '',
                      path: h.path,
                    })
                  }
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <form onSubmit={add} className="flex flex-col gap-4">
        <div className="label">ADD AN ENDPOINT</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field
            label="direction"
            hint="IN receives events here. OUT delivers a signed callback elsewhere."
          >
            <select
              className="field-select"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            >
              <option value="IN">IN — inbound</option>
              <option value="OUT">OUT — outbound callback</option>
            </select>
          </Field>

          <Field
            label="path"
            hint={
              direction === 'IN'
                ? 'A path on this application, such as /api/v1/webhooks/github.'
                : 'An https URL to deliver to.'
            }
          >
            <input
              className="field-input"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={
                direction === 'IN'
                  ? '/api/v1/webhooks/github'
                  : 'https://desk.example.com/hooks/agentsync'
              }
              required
            />
          </Field>

          <Field label="note" hint="What it carries. Optional.">
            <input
              className="field-input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="push + pull_request"
            />
          </Field>

          <Field
            label="signing_secret_ref"
            hint="Required while enabled. The name of the variable holding the secret, with a scheme."
          >
            <input
              className="field-input"
              value={secretRef}
              onChange={(e) => setSecretRef(e.target.value)}
              placeholder="env:GITHUB_WEBHOOK_SECRET"
            />
          </Field>

          <Field
            label="replay_window_seconds"
            hint="How old a signed delivery may be before it is rejected. 30–3600."
          >
            <input
              className="field-input"
              value={replay}
              onChange={(e) => setReplay(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
            />
          </Field>

          <Field
            label="enabled"
            hint="Save it disabled if the receiving code does not exist yet."
          >
            <select
              className="field-select"
              value={String(enabled)}
              onChange={(e) => setEnabled(e.target.value === 'true')}
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </Field>
        </div>

        <FormError message={error} />

        <div>
          <button className="btn-primary" disabled={busy || !tenantSlug}>
            {busy ? 'Saving…' : 'Add endpoint'}
          </button>
        </div>
      </form>
    </div>
  );
}
