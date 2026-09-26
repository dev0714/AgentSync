'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CopyBlock } from '../ui';

/**
 * The two things a tenant needs before any task can run — a project pointed at
 * a repository, and a key for the system that submits work — made from the
 * portal instead of the SQL editor.
 */

const ERRORS: Record<string, string> = {
  NOT_AUTHORISED: 'Only a tenant admin can do this.',
  PROJECT_EXISTS: 'A project with that name already exists.',
  NAME_REQUIRED: 'Give it a name.',
  REPOSITORY_REQUIRED: 'Enter the repository owner and name.',
};

export function NewProjectForm({ tenantSlug }: { tenantSlug: string | null }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [planGate, setPlanGate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const [owner, repository] = repo.trim().replace(/^https:\/\/github\.com\//, '').split('/');
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch('/api/portal/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenant_slug: tenantSlug,
          name,
          github_owner: owner ?? '',
          repository: repository ?? '',
          default_branch: branch,
          plan_approval_required: planGate,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; project_id?: string };
      if (!res.ok) {
        setProblem(ERRORS[data.error ?? ''] ?? `Could not create the project (${data.error ?? res.status}).`);
        return;
      }
      setCreated(data.project_id ?? null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-[14.5px] font-semibold text-ok-ink">Project created.</div>
        <div className="text-[14px] text-muted">Its id — source systems send this as <code>project_id</code>:</div>
        <CopyBlock text={created} />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid max-w-[640px] grid-cols-1 gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-2">Project name</span>
        <input className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer portal" required />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-2">GitHub repository</span>
        <input className="field-input mono" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repository" required />
        <span className="text-[12.5px] text-muted-2">The GitHub App must be installed on it.</span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-2">Default branch</span>
        <input className="field-input mono" value={branch} onChange={(e) => setBranch(e.target.value)} required />
      </label>
      <label className="flex items-center gap-2.5 text-[14px] text-ink-2">
        <input type="checkbox" className="size-4 accent-[var(--color-gate)]" checked={planGate} onChange={(e) => setPlanGate(e.target.checked)} />
        A person approves each plan before code is written
      </label>
      <div className="text-[13px] text-muted-2">
        Merges always need a person&apos;s approval. Workflows, <code>.env</code> files and keys are protected paths the agents cannot touch.
      </div>
      {problem ? <div className="text-[13.5px] text-danger-ink">{problem}</div> : null}
      <button className="btn-primary w-fit" disabled={busy || !tenantSlug}>
        {busy ? 'Creating…' : 'Create project'}
      </button>
    </form>
  );
}

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
