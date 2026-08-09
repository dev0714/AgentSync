'use client';

import type { Connections as ConnectionData } from '@/lib/portal-data';
import { STATE_COLOUR, rowsFrom, swatch } from '@/lib/portal-ui';
import {
  Ago,
  ColLabel,
  Empty,
  FieldRows,
  Pill,
  SetupSteps,
  Tabs,
  type SetupStep,
} from '../ui';
import GithubForm from './GithubForm';

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

/**
 * How to connect GitHub, in the app rather than in a document nobody has open.
 *
 * AgentSync does not yet perform the GitHub App handshake, so the parts that
 * must happen on github.com are spelled out here rather than hidden behind a
 * button that would do nothing. The last step says plainly what connecting does
 * and does not achieve today.
 */
function githubSteps(): SetupStep[] {
  return [
    {
      title: 'Create a GitHub App',
      body: (
        <>
          Under <span className="mono text-ink-3">Settings → Developer settings → GitHub Apps → New</span>.
          Grant the least it can work with: <span className="mono text-ink-3">Contents</span> read
          and write, <span className="mono text-ink-3">Pull requests</span> read and write,{' '}
          <span className="mono text-ink-3">Metadata</span> read,{' '}
          <span className="mono text-ink-3">Checks</span> read. Subscribe to the{' '}
          <span className="mono text-ink-3">push</span>,{' '}
          <span className="mono text-ink-3">pull_request</span> and{' '}
          <span className="mono text-ink-3">check_suite</span> events. Do not grant
          administration or workflow scopes — the pipeline never needs them, and a
          task that tries is meant to fail.
        </>
      ),
      href: { label: 'github.com/settings/apps/new', url: 'https://github.com/settings/apps/new' },
    },
    {
      title: 'Generate a private key and a webhook secret',
      body: (
        <>
          Download the <span className="mono text-ink-3">.pem</span> and set a webhook
          secret on the same page. Neither value is stored in this database — only a
          reference to where it lives is. Put the real values in your deployment
          environment.
        </>
      ),
      code: `GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n…"\nGITHUB_WEBHOOK_SECRET="…"`,
    },
    {
      title: 'Install the App on the repositories it may touch',
      body: (
        <>
          Install it, choosing <em>only select repositories</em>. The URL you land on
          ends in <span className="mono text-ink-3">installations/&lt;id&gt;</span> — that
          number is the installation id for the next step.
        </>
      ),
    },
    {
      title: 'Record the installation below',
      body: (
        <>
          Fill in the form under these steps. The private key and webhook secret are
          not fields — only the names of the environment variables holding them, so
          the row can be read back into this page without ever carrying a credential.
        </>
      ),
    },
    {
      title: 'What this does, and what it does not',
      body: (
        <>
          This screen will then show GitHub as connected, and the repository allowlist
          becomes the outer bound on what any agent can reach. It does{' '}
          <strong className="text-ink-3">not</strong> make tasks run yet: the{' '}
          <span className="mono text-ink-3">analyse</span> stage still has no checkout
          workspace and no token minting, so a submitted task goes{' '}
          <span className="mono text-ink-3">queued → analysing → failed</span> with{' '}
          <span className="mono text-ink-3">STAGE_NOT_CONFIGURED</span> on the record
          rather than pretending to progress.
        </>
      ),
    },
  ];
}

export default function Connections({
  connections,
  tenantSlug,
  tab,
  onTab,
}: {
  connections: ConnectionData;
  tenantSlug: string | null;
  tab: ConnTab;
  onTab: (t: ConnTab) => void;
}) {
  const { github, deployment, ai, secrets, webhooks } = connections;

  // One tile per external system, coloured by whether it is actually connected.
  const tiles: {
    name: string;
    tab: ConnTab;
    connected: boolean;
    target: string;
    meta: string;
  }[] = [
    {
      name: 'GitHub',
      tab: 'github',
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
      tab: 'deploy',
      connected: Boolean(deployment),
      target: deployment ? String(deployment.provider ?? '') : 'no provider',
      meta: deployment
        ? `previews on ${String(deployment.preview_on ?? '—')}`
        : 'Optional. Without it, previews and production deploys are skipped.',
    },
    {
      name: 'AI providers',
      tab: 'ai',
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
            <button
              key={t.name}
              onClick={() => onTab(t.tab)}
              className="card flex cursor-pointer flex-col gap-2 p-4 text-left hover:border-[#3A3A40]"
            >
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
              <div className="mono mt-1 text-[10px] text-accent">
                {t.connected ? 'REVIEW →' : 'SET UP →'}
              </div>
            </button>
          ))}
        </div>
      ) : null}

      {tab === 'github' ? (
        <div className="flex flex-col gap-4">
          {github ? null : (
            <Card title="Connect GitHub" scope="four steps, once per tenant">
              <SetupSteps steps={githubSteps()} />
            </Card>
          )}
          <Card
            title={github ? 'GitHub App installation' : 'Installation details'}
            scope="github_app_installations"
          >
            <GithubForm tenantSlug={tenantSlug} existing={github} />
          </Card>
        </div>
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
