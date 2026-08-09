'use client';

import type { Connections as ConnectionData } from '@/lib/portal-data';
import { STATE_COLOUR, rowsFrom, swatch } from '@/lib/portal-ui';
import { Ago, ColLabel, Empty, FieldRows, Pill, Tabs } from '../ui';

export type ConnTab = 'overview' | 'github' | 'deploy' | 'ai' | 'webhooks' | 'secrets';

export const CONN_TABS: { k: ConnTab; label: string }[] = [
  { k: 'overview', label: 'Overview' },
  { k: 'github', label: 'GitHub' },
  { k: 'deploy', label: 'Deployment' },
  { k: 'ai', label: 'AI providers' },
  { k: 'webhooks', label: 'Webhooks' },
  { k: 'secrets', label: 'Secrets' },
];

function Card({
  title,
  scope,
  children,
}: {
  title: string;
  scope?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <div className="text-[13px] font-semibold">{title}</div>
        {scope ? (
          <div className="mono text-[10px] text-muted-2">{scope}</div>
        ) : null}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Missing({ what }: { what: string }) {
  return (
    <div className="text-[12.5px] text-muted" style={{ lineHeight: 1.6 }}>
      {what}
    </div>
  );
}

export default function Connections({
  connections,
  tab,
  onTab,
}: {
  connections: ConnectionData;
  tab: ConnTab;
  onTab: (t: ConnTab) => void;
}) {
  const { github, deployment, ai, secrets, webhooks } = connections;

  // One tile per external system, coloured by whether it is actually connected.
  const tiles = [
    {
      name: 'GitHub',
      connected: Boolean(github),
      target: github
        ? `installation ${String(github.installation_id ?? '')}`
        : 'no installation',
      meta: github
        ? `${(github.repository_allowlist as string[] | null)?.length ?? 0} repositories allowlisted`
        : 'Required before any task can be checked out.',
    },
    {
      name: 'Deployment',
      connected: Boolean(deployment),
      target: deployment ? String(deployment.provider ?? '') : 'no provider',
      meta: deployment
        ? `previews on ${String(deployment.preview_on ?? '—')}`
        : 'Optional. Without it, previews and production deploys are skipped.',
    },
    {
      name: 'AI providers',
      connected: ai.length > 0,
      target: ai.length ? ai.map((c) => String(c.provider)).join(', ') : 'none',
      meta: ai.length
        ? `${ai.length} credential${ai.length === 1 ? '' : 's'} configured`
        : 'Required before any agent can call a model.',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="text-[12.5px] text-muted" style={{ lineHeight: 1.6 }}>
        Every external system AgentSync talks to. Credentials are never stored
        here in plain text — each connection holds a reference into the secret
        manager, and any one of them can be disabled without touching project
        configuration.
      </div>

      <div className="border-b border-line">
        <Tabs tabs={CONN_TABS} active={tab} onSelect={onTab} />
      </div>

      {tab === 'overview' ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.name} className="card flex flex-col gap-2 p-4">
              <div className="flex items-center gap-2">
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: t.connected ? '#4ADE80' : '#6A6A73' }}
                />
                <span className="flex-1 text-[13.5px] font-semibold">
                  {t.name}
                </span>
                <Pill c={t.connected ? ['#122E1E', '#6FD69C'] : ['#212125', '#9A9AA3']}>
                  {t.connected ? 'CONNECTED' : 'NOT CONNECTED'}
                </Pill>
              </div>
              <div className="mono text-[10.5px] text-ink-3">{t.target}</div>
              <div className="text-[11.5px] text-muted" style={{ lineHeight: 1.5 }}>
                {t.meta}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'github' ? (
        <Card title="GitHub App installation" scope="github_app_installations">
          {github ? (
            <FieldRows prefix="conn.github" rows={rowsFrom(github)} />
          ) : (
            <Missing what="No GitHub App is installed for this tenant. Until one is, the analyse stage has no repository to check out and every task fails there with the reason recorded." />
          )}
        </Card>
      ) : null}

      {tab === 'deploy' ? (
        <Card title="Deployment provider" scope="deployment_providers">
          {deployment ? (
            <FieldRows prefix="conn.deploy" rows={rowsFrom(deployment)} />
          ) : (
            <Missing what="No deployment provider is connected. Tasks still reach a pull request; preview and production deployments are simply skipped." />
          )}
        </Card>
      ) : null}

      {tab === 'ai' ? (
        ai.length === 0 ? (
          <Empty
            title="No AI provider credential"
            detail="Each credential names a provider, a model, a spend cap and the secret reference holding the key. Without one, no agent can make a model call."
            table="agentsync.ai_provider_credentials"
          />
        ) : (
          <div className="flex flex-col gap-4">
            {ai.map((c, i) => (
              <Card
                key={String(c.id ?? i)}
                title={String(c.provider)}
                scope="ai_provider_credentials"
              >
                <FieldRows prefix={`conn.ai.${i}`} rows={rowsFrom(c)} />
              </Card>
            ))}
          </div>
        )
      ) : null}

      {tab === 'webhooks' ? (
        webhooks.length === 0 ? (
          <Empty
            title="No webhook endpoints"
            detail="Inbound endpoints receive GitHub and deployment events; outbound ones deliver signed callbacks to the system that submitted a task."
            table="agentsync.webhook_endpoints"
          />
        ) : (
          <div className="card overflow-hidden">
            <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
              <div className="text-[13px] font-semibold">Webhook endpoints</div>
              <div className="mono text-[10px] text-muted-2">signed</div>
            </div>
            {webhooks.map((h) => (
              <div
                key={h.path}
                className="flex flex-wrap items-center gap-3 border-b border-line-faint px-4 py-2.5 last:border-b-0"
              >
                <div
                  className="mono w-8 shrink-0 text-[10px]"
                  style={{ color: h.direction === 'inbound' ? '#7FB6E0' : '#6FD69C' }}
                >
                  {h.direction === 'inbound' ? 'IN' : 'OUT'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mono truncate text-[11.5px] text-ink-2">
                    {h.path}
                  </div>
                  <div className="text-[11px] text-muted-2">{h.note ?? ''}</div>
                </div>
                <div className="mono text-[10.5px] text-muted-2">
                  replay {h.replay_window_seconds ?? '—'}s
                </div>
                <Pill c={h.enabled ? ['#122E1E', '#6FD69C'] : ['#212125', '#9A9AA3']}>
                  {h.enabled ? 'ENABLED' : 'DISABLED'}
                </Pill>
              </div>
            ))}
          </div>
        )
      ) : null}

      {tab === 'secrets' ? (
        secrets.length === 0 ? (
          <Empty
            title="No secret references"
            detail="AgentSync stores references, never values. Each row names a secret in the secret manager, what uses it, and when it was last rotated."
            table="agentsync.secret_references"
          />
        ) : (
          <div className="card overflow-hidden">
            <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
              <div className="text-[13px] font-semibold">Secret references</div>
              <div className="mono text-[10px] text-muted-2">
                values never leave the secret manager
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="grid min-w-[720px] grid-cols-[minmax(280px,1fr)_160px_120px_90px] gap-3 border-b border-line bg-raised px-4 py-[9px]">
                <ColLabel>REFERENCE</ColLabel>
                <ColLabel>USED BY</ColLabel>
                <ColLabel>ROTATED</ColLabel>
                <ColLabel right>STATE</ColLabel>
              </div>
              {secrets.map((sr) => (
                <div
                  key={sr.reference}
                  className="grid min-w-[720px] grid-cols-[minmax(280px,1fr)_160px_120px_90px] items-center gap-3 border-b border-line-faint px-4 py-2.5"
                >
                  <div className="mono truncate text-[11px] text-ink-2">
                    {sr.reference}
                  </div>
                  <div className="text-[12px] text-muted">{sr.used_by ?? '—'}</div>
                  <div className="mono text-[10.5px] text-muted-2">
                    <Ago iso={sr.rotated_at} />
                  </div>
                  <div className="text-right">
                    <Pill
                      c={swatch(STATE_COLOUR, sr.revoked ? 'DISABLED' : 'ACTIVE')}
                    >
                      {sr.revoked ? 'REVOKED' : 'ACTIVE'}
                    </Pill>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}
