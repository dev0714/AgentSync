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
 * must happen on github.com are spelled out field by field — including the ones
 * whose right answer is "leave it empty", which are the easiest to get wrong.
 * The last step says plainly what connecting does and does not achieve today.
 */

function Setting({
  name,
  value,
  why,
}: {
  name: string;
  value: string;
  why: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-x-3 gap-y-0.5 border-b border-line-faint py-1.5 last:border-b-0 sm:grid-cols-[190px_130px_1fr]">
      <div className="mono text-[11px] text-ink-2">{name}</div>
      <div className="mono text-[11px] text-accent">{value}</div>
      <div className="text-[11.5px] text-muted-2" style={{ lineHeight: 1.5 }}>
        {why}
      </div>
    </div>
  );
}

function githubSteps(): SetupStep[] {
  return [
    {
      title: 'Create the App — the fields on the first form',
      body: (
        <div className="flex flex-col gap-3">
          <div>
            Most of this form is for Apps that sign users in. AgentSync does not: it
            acts as the App itself, using an installation token. So several required-
            looking fields are deliberately left empty.
          </div>
          <div className="rounded-lg border border-line bg-raised px-3.5 py-2">
            <Setting
              name="GitHub App name"
              value="anything"
              why="Must be unique across GitHub. The URL slug it produces is what goes in app_slug below — “Agent sync” becomes agent-sync."
            />
            <Setting
              name="Homepage URL"
              value="your portal URL"
              why="Required by GitHub but unused by the pipeline. Your deployed portal, or the repository URL, is fine."
            />
            <Setting
              name="Callback URL"
              value="Delete it"
              why="Only used when an App signs users in. AgentSync never does, so leave none."
            />
            <Setting
              name="Request user authorization"
              value="unchecked"
              why="Same reason — no user OAuth flow."
            />
            <Setting
              name="Enable Device Flow"
              value="unchecked"
              why="Not used."
            />
            <Setting
              name="Setup URL"
              value="empty"
              why="There is no post-install page to send you to yet."
            />
            <Setting
              name="Webhook → Active"
              value="UNCHECK"
              why="Nothing here receives GitHub events yet. Unchecking it removes the required Webhook URL and the secret. Switch it on when webhook handling exists."
            />
            <Setting
              name="Where can this be installed"
              value="Only on this account"
              why="Correct unless you intend to offer AgentSync to other GitHub accounts."
            />
          </div>
        </div>
      ),
      href: {
        label: 'github.com/settings/apps/new',
        url: 'https://github.com/settings/apps/new',
      },
    },
    {
      title: 'Permissions — grant only these',
      body: (
        <div className="flex flex-col gap-3">
          <div>
            Under <span className="mono text-ink-3">Repository permissions</span>. Everything
            not listed stays <span className="mono text-ink-3">No access</span>. The
            allowlist you set below bounds <em>which</em> repositories; this bounds{' '}
            <em>what</em> can be done inside them.
          </div>
          <div className="rounded-lg border border-line bg-raised px-3.5 py-2">
            <Setting
              name="Contents"
              value="Read and write"
              why="Clone the repository and push the task's branch."
            />
            <Setting
              name="Pull requests"
              value="Read and write"
              why="Open the pull request and write its body."
            />
            <Setting
              name="Metadata"
              value="Read-only"
              why="Mandatory; GitHub selects it for you."
            />
            <Setting
              name="Checks"
              value="Read-only"
              why="Read CI results rather than trusting the agent's own account of them."
            />
            <Setting
              name="Administration"
              value="No access"
              why="Would let a task change branch protection — the thing the merge gate depends on."
            />
            <Setting
              name="Workflows"
              value="No access"
              why="Would let a task rewrite CI, which is what verifies the task."
            />
          </div>
          <div>
            Organization and Account permissions: none. Leave{' '}
            <span className="mono text-ink-3">Subscribe to events</span> empty — with the
            webhook switched off, nothing would be delivered anyway.
          </div>
        </div>
      ),
    },
    {
      title: 'Create it, then note two things and generate a key',
      body: (
        <>
          On the App&apos;s settings page, copy the{' '}
          <span className="mono text-ink-3">App ID</span> — a number near the top, and
          not the same as the installation id. Then scroll to{' '}
          <span className="mono text-ink-3">Private keys</span> and generate one; the{' '}
          <span className="mono text-ink-3">.pem</span> downloads once and cannot be
          retrieved again. Put its contents in your deployment environment. It is never
          stored in this database — only the name of the variable holding it.
        </>
      ),
      code: `# Vercel → Settings → Environment Variables (paste the whole .pem, newlines and all)
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
…
-----END RSA PRIVATE KEY-----"`,
    },
    {
      title: 'Install it on the repositories it may touch',
      body: (
        <>
          <span className="mono text-ink-3">Install App</span> in the left sidebar, and
          choose <em>Only select repositories</em>. The URL you land on ends in{' '}
          <span className="mono text-ink-3">installations/12345678</span> — that number
          is the installation id, and it is a different number from the App ID.
        </>
      ),
    },
    {
      title: 'Record it below',
      body: (
        <>
          Fill in the form under these steps and save. Leave{' '}
          <span className="mono text-ink-3">webhook_secret_reference</span> empty while
          the webhook is switched off.
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
