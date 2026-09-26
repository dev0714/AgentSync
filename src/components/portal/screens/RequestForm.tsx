'use client';

import { useState } from 'react';

/**
 * A request for the agents, typed into the project it is for.
 *
 * It goes through exactly the same pipeline as one sent by an external system:
 * the Planner writes a plan, a person approves it, the Engineer builds it, and
 * nothing merges without an approval.
 */

const TYPES: [string, string][] = [
  ['code_change', 'Code change'],
  ['refactor', 'Refactor'],
  ['dependency_update', 'Dependency update'],
  ['migration', 'Migration'],
  ['investigation', 'Investigation (no code)'],
  ['custom', 'Other'],
];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const ERRORS: Record<string, string> = {
  NOT_AUTHORISED: 'Your role can view but not submit requests.',
  PROJECT_DISABLED: 'This repository was removed from the GitHub installation.',
  PROJECT_NOT_FOUND: 'This project no longer exists.',
};

export default function RequestForm({
  projectId,
  repository,
  enabled,
  canSubmit,
  onSubmitted,
}: {
  projectId: string;
  repository: string;
  enabled: boolean;
  canSubmit: boolean;
  onSubmitted: (taskId: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [criteria, setCriteria] = useState('');
  const [type, setType] = useState('code_change');
  const [priority, setPriority] = useState('normal');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const blocked = !canSubmit
    ? 'Your role can view but not submit requests.'
    : !enabled
      ? 'This repository was removed from the GitHub installation.'
      : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch('/api/portal/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          title: title.trim(),
          description: description.trim() || undefined,
          request_type: type,
          priority,
          acceptance_criteria: criteria.split('\n').map((c) => c.trim()).filter(Boolean),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        problems?: string[];
        task_id?: string;
      };
      if (!res.ok || !data.task_id) {
        setProblem(
          data.problems?.join('; ') ?? ERRORS[data.error ?? ''] ?? `Could not submit (${data.error ?? res.status}).`,
        );
        return;
      }
      setTitle('');
      setDescription('');
      setCriteria('');
      onSubmitted(data.task_id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card flex flex-col gap-4 p-5" aria-label={`New request for ${repository}`}>
      <div>
        <div className="text-[16px] font-semibold text-ink">New request</div>
        <div className="text-[13.5px] text-muted">
          For <span className="mono text-ink-2">{repository}</span>. The Planner writes a plan for you to
          approve before any code is written.
        </div>
      </div>

      <fieldset disabled={!!blocked || busy} className="flex flex-col gap-4 disabled:opacity-60">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">What should change?</span>
          <input
            className="field-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={500}
            placeholder="Add a status filter to the customer dashboard"
            required
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Details <span className="font-normal text-muted-2">(optional)</span></span>
          <textarea
            className="field-input min-h-[96px] py-2"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Context, where it goes, anything the agents should know."
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">
            Acceptance criteria <span className="font-normal text-muted-2">(one per line — the Reviewer checks each)</span>
          </span>
          <textarea
            className="field-input min-h-[80px] py-2"
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            placeholder={'Filter shows Active, Paused and Closed\nThe choice survives a page reload'}
          />
        </label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-col gap-1.5 sm:w-[240px]">
            <span className="text-[13px] font-medium text-ink-2">Type</span>
            <select className="field-select" value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 sm:w-[160px]">
            <span className="text-[13px] font-medium text-ink-2">Priority</span>
            <select className="field-select" value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
              ))}
            </select>
          </label>
          <button className="btn-primary sm:ml-auto" disabled={!title.trim()}>
            {busy ? 'Submitting…' : 'Submit to agents'}
          </button>
        </div>
      </fieldset>

      {blocked ? <div className="text-[13.5px] text-muted">{blocked}</div> : null}
      {problem ? <div className="text-[13.5px] text-danger-ink">{problem}</div> : null}
    </form>
  );
}
