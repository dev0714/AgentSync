'use client';

import { useState } from 'react';
import { Ago, ColLabel, Pill } from '../ui';
import { Field, FormError, useConnectionSubmit } from './ConnectionForm';

/**
 * Secret references — the register of what secrets exist, what uses them and
 * when they were last rotated. Values never enter this table, only names.
 *
 * "Mark rotated" is a separate action from saving, because an edit must not be
 * able to claim a rotation that did not happen — a stale rotation date is worse
 * than no date, since it reads as reassurance.
 */

const MESSAGES: Record<string, string> = {
  ROTATION_DAYS_OUT_OF_RANGE: 'Rotation period must be between 1 and 730 days.',
  REFERENCE_IN_USE:
    'A connection still names this reference. Remove or repoint that connection first, otherwise it would point at a secret the platform no longer lists.',
};

export type SecretRow = {
  reference: string;
  used_by: string | null;
  rotated_at: string | null;
  rotation_days: number | null;
  revoked: boolean;
};

const GRID =
  'grid min-w-[820px] grid-cols-[minmax(240px,1fr)_160px_110px_90px_90px_130px] items-center gap-3';

export default function SecretsForm({
  tenantSlug,
  secrets,
}: {
  tenantSlug: string | null;
  secrets: SecretRow[];
}) {
  const { busy, error, call } = useConnectionSubmit(
    '/api/portal/connections/secrets',
    MESSAGES,
  );

  const [reference, setReference] = useState('');
  const [usedBy, setUsedBy] = useState('');
  const [rotationDays, setRotationDays] = useState('90');

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantSlug) return;
    const saved = await call('POST', {
      tenant_slug: tenantSlug,
      reference,
      used_by: usedBy,
      rotation_days: Number(rotationDays),
    });
    if (saved) {
      setReference('');
      setUsedBy('');
    }
  }

  function rotate(row: SecretRow) {
    return call('POST', {
      tenant_slug: tenantSlug,
      reference: row.reference,
      used_by: row.used_by ?? '',
      rotation_days: row.rotation_days ?? 90,
      revoked: row.revoked,
      mark_rotated: true,
    });
  }

  function setRevoked(row: SecretRow, revoked: boolean) {
    return call('POST', {
      tenant_slug: tenantSlug,
      reference: row.reference,
      used_by: row.used_by ?? '',
      rotation_days: row.rotation_days ?? 90,
      revoked,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {secrets.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-line">
          <div className={`${GRID} border-b border-line bg-raised px-3.5 py-[9px]`}>
            <ColLabel>REFERENCE</ColLabel>
            <ColLabel>USED BY</ColLabel>
            <ColLabel>ROTATED</ColLabel>
            <ColLabel>EVERY</ColLabel>
            <ColLabel>STATE</ColLabel>
            <ColLabel right>{''}</ColLabel>
          </div>
          {secrets.map((s) => (
            <div
              key={s.reference}
              className={`${GRID} border-b border-line-faint px-3.5 py-2.5 last:border-b-0`}
            >
              <span className="mono truncate text-[11px] text-ink-2">
                {s.reference}
              </span>
              <span className="text-[12px] text-muted">{s.used_by ?? '—'}</span>
              <span className="mono text-[10.5px] text-muted-2">
                {s.rotated_at ? <Ago iso={s.rotated_at} /> : 'never'}
              </span>
              <span className="mono text-[10.5px] text-muted-2">
                {s.rotation_days ?? '—'}d
              </span>
              <Pill c={s.revoked ? ['#331515', '#F08A80'] : ['#122E1E', '#6FD69C']}>
                {s.revoked ? 'REVOKED' : 'ACTIVE'}
              </Pill>
              <div className="flex justify-end gap-2.5">
                <button
                  type="button"
                  className="mono cursor-pointer text-[10.5px] text-muted-2 hover:text-ink-2"
                  disabled={busy}
                  onClick={() => rotate(s)}
                  title="Record that you have just rotated this secret"
                >
                  Rotated
                </button>
                <button
                  type="button"
                  className="mono cursor-pointer text-[10.5px] text-muted-2 hover:text-ink-2"
                  disabled={busy}
                  onClick={() => setRevoked(s, !s.revoked)}
                >
                  {s.revoked ? 'Restore' : 'Revoke'}
                </button>
                <button
                  type="button"
                  className="mono cursor-pointer text-[10.5px] text-muted-2 hover:text-danger"
                  disabled={busy}
                  onClick={() =>
                    call('DELETE', undefined, {
                      tenant: tenantSlug ?? '',
                      reference: s.reference,
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
        <div className="label">REGISTER A REFERENCE</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field
            label="reference"
            hint="The name of the variable holding the secret, with a scheme. The value never comes here."
          >
            <input
              className="field-input"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="env:ANTHROPIC_API_KEY"
              required
            />
          </Field>

          <Field label="used_by" hint="What relies on it. Optional but worth filling in.">
            <input
              className="field-input"
              value={usedBy}
              onChange={(e) => setUsedBy(e.target.value)}
              placeholder="anthropic credential"
            />
          </Field>

          <Field
            label="rotation_days"
            hint="How often it should be rotated. Recorded as intent — nothing enforces it yet."
          >
            <input
              className="field-input"
              value={rotationDays}
              onChange={(e) => setRotationDays(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
            />
          </Field>
        </div>

        <FormError message={error} />

        <div>
          <button className="btn-primary" disabled={busy || !tenantSlug}>
            {busy ? 'Saving…' : 'Register'}
          </button>
        </div>
      </form>
    </div>
  );
}
