'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CopyBlock } from '../ui';

/**
 * A key for a system that submits work, issued from the portal instead of the
 * SQL editor. (Projects come from the GitHub installation's repositories.)
 */

const ERRORS: Record<string, string> = {
  NOT_AUTHORISED: 'Only a tenant admin can do this.',
  NAME_REQUIRED: 'Give it a name.',
};

export function IssueKeyForm({ tenantSlug }: { tenantSlug: string | null }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch('/api/portal/sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenant_slug: tenantSlug, name }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; api_key?: string };
      if (!res.ok || !data.api_key) {
        setProblem(ERRORS[data.error ?? ''] ?? `Could not issue a key (${data.error ?? res.status}).`);
        return;
      }
      setKey(data.api_key);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (key) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-[14.5px] font-semibold text-gate-ink">Copy this key now — it will not be shown again.</div>
        <CopyBlock text={key} />
        <div className="text-[13px] text-muted-2">Only its hash is stored. Send it as <code>Authorization: Bearer …</code> to <code>/api/v1/agent/tasks</code>.</div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-[640px] flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex flex-1 flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-2">System name</span>
        <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Service desk" required />
      </label>
      <button className="btn-primary" disabled={busy || !tenantSlug}>{busy ? 'Issuing…' : 'Issue key'}</button>
      {problem ? <div className="text-[13.5px] text-danger-ink">{problem}</div> : null}
    </form>
  );
}
