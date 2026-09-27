'use client';

import { useEffect, useState } from 'react';

/**
 * The documents the source system sent with a task: download the original,
 * and see the text the agents were given for Word and Excel files.
 */

type Item = {
  id: string;
  filename: string;
  media_type: string;
  size_bytes: number;
  status: 'pending' | 'ready' | 'rejected';
  problem: string | null;
  extracted_text: string | null;
};

const KIND: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
  'text/plain': 'Text',
  'text/markdown': 'Markdown',
  'text/csv': 'CSV',
  'application/json': 'JSON',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
};

function size(n: number) {
  return n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export default function Attachments({ taskId }: { taskId: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/portal/tasks/${taskId}/attachments`)
      .then((r) => (r.ok ? r.json() : { attachments: [] }))
      .then((d: { attachments: Item[] }) => {
        if (!cancelled) setItems(d.attachments ?? []);
      })
      .catch(() => setItems([]));
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (!items || items.length === 0) return null;

  return (
    <div className="card p-4">
      <div className="label mb-3">Attachments</div>
      <ul className="flex flex-col gap-2.5">
        {items.map((a) => (
          <li key={a.id} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <a
                className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-agent-ink hover:underline"
                href={`/api/portal/tasks/${taskId}/attachments/${a.id}`}
              >
                {a.filename}
              </a>
              <span className="mono shrink-0 text-[11.5px] text-muted-2">
                {KIND[a.media_type] ?? a.media_type} · {size(a.size_bytes)}
              </span>
            </div>
            {a.status === 'rejected' ? (
              <div className="text-[12.5px] text-danger-ink">Not used: {a.problem}</div>
            ) : a.status === 'pending' ? (
              <div className="text-[12.5px] text-muted-2">Waiting to be checked</div>
            ) : a.extracted_text ? (
              <button
                className="w-fit cursor-pointer text-[12.5px] text-muted hover:text-ink"
                onClick={() => setOpen(open === a.id ? null : a.id)}
              >
                {open === a.id ? 'Hide text' : 'Show the text the agents read'}
              </button>
            ) : null}
            {open === a.id && a.extracted_text ? (
              <pre className="mono max-h-[280px] overflow-auto rounded-lg border border-line bg-canvas p-2.5 text-[11.5px] whitespace-pre-wrap text-ink-3">
                {a.extracted_text}
              </pre>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
