'use client';

import type { Connections as ConnectionData } from '@/lib/portal-data';
import { Ago, SetupSteps, Tabs, type SetupStep } from '../ui';
import AiForm from './AiForm';
import DeploymentForm from './DeploymentForm';
import GithubOneClick from './GithubOneClick';
import GithubForm from './GithubForm';
import SecretsForm from './SecretsForm';
import SupabaseForm, { useSupabaseConnection } from './SupabaseForm';
import WebhookForm from './WebhookForm';

export type ConnTab = 'overview' | 'github' | 'deploy' | 'ai' | 'supabase' | 'webhooks' | 'secrets';

export const CONN_TABS: { k: ConnTab; label: string }[] = [
  { k: 'overview', label: 'Overview' },
  { k: 'github', label: 'GitHub' },
  { k: 'deploy', label: 'Deployment' },
  { k: 'ai', label: 'AI providers' },
  { k: 'supabase', label: 'Supabase' },
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
        <div className="text-[14.5px] font-semibold">{title}</div>
        {scope ? (
          <div className="mono text-[11.5px] text-muted-2">{scope}</div>
        ) : null}
      </div>
      <div className="p-4">{children}</div>
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
    <div className="grid grid-cols-1 gap-x-5 gap-y-0.5 border-b border-line-faint py-2 last:border-b-0 sm:grid-cols-[minmax(200px,240px)_minmax(140px,180px)_1fr]">
      <div className="mono text-[12.5px] text-ink-2">{name}</div>
      <div className="mono text-[12.5px] text-accent">{value}</div>
      <div className="text-[13px] text-muted-2" style={{ lineHeight: 1.5 }}>
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
          <div className="max-w-[76ch]">
            Most of this form is for Apps that sign users in. AgentSync does not: it
            acts as the App itself, using an installation token. So several
            required-looking fields are deliberately left empty.
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
      wide: true,
    },
    {
      title: 'Permissions — grant only these',
      body: (
        <div className="flex flex-col gap-3">
          <div className="max-w-[76ch]">
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
              name="Actions"
              value="Read-only"
              why="Read a failing job's log so the Engineer can repair what actually broke."
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
          <div className="max-w-[76ch]">
            Organization and Account permissions: none. Leave{' '}
            <span className="mono text-ink-3">Subscribe to events</span> empty — with the
            webhook switched off, nothing would be delivered anyway.
          </div>
        </div>
      ),
      wide: true,
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
      title: 'What happens next',
      body: (
        <>
          The repository allowlist becomes the outer bound on what any agent can reach.
          The agents read the repository, commit to an{' '}
          <span className="mono text-ink-3">agentsync/…</span> branch and open a pull
          request through this App; merging happens only after a person approves it here.
          Give the repository a GitHub Actions workflow that runs on{' '}
          <span className="mono text-ink-3">pull_request</span> so every change is checked
          before review — without one, tasks reach review with checks marked as not reported.
        </>
      ),
    },
  ];
}

/**
 * How to connect Vercel.
 *
 * Same shape as the GitHub steps and for the same reason: the parts that must
 * happen on vercel.com cannot be done from here, so they are spelled out rather
 * than hidden behind a button that would do nothing.
 */
function vercelSteps(): SetupStep[] {
  return [
    {
      title: 'Import the repository into Vercel',
      body: (
        <>
          The project AgentSync deploys is an ordinary Vercel project connected to the
          same repository the GitHub App is installed on. If it is already deployed,
          this is done — the project you are reading this in counts.
        </>
      ),
      href: { label: 'vercel.com/new', url: 'https://vercel.com/new' },
    },
    {
      title: 'Create an access token',
      body: (
        <div className="flex flex-col gap-3">
          <div className="max-w-[76ch]">
            <span className="mono text-ink-3">Account Settings → Tokens → Create</span>.
            Scope it to the team that owns the project, not to your whole account, and
            give it the shortest expiry you are willing to rotate.
          </div>
          <div className="rounded-lg border border-line bg-raised px-3.5 py-2">
            <Setting
              name="Scope"
              value="the team only"
              why="A full-account token can redeploy every project you have access to, not just this one."
            />
            <Setting
              name="Expiration"
              value="90 days or less"
              why="The reference in AgentSync does not change when you rotate the value, so rotation costs one environment-variable edit."
            />
          </div>
          <div className="max-w-[76ch]">
            The token is shown once. Put it in your deployment environment — it is
            never stored in this database, only the name of the variable holding it.
          </div>
        </div>
      ),
      code: `# Vercel → Settings → Environment Variables
VERCEL_API_TOKEN="…"`,
      wide: true,
    },
    {
      title: 'Find the team id',
      body: (
        <>
          <span className="mono text-ink-3">Team Settings → General → Team ID</span>, which
          starts <span className="mono text-ink-3">team_</span>. Leave it empty if the
          project lives on a personal account rather than a team.
        </>
      ),
    },
    {
      title: 'Decide the two triggers',
      body: (
        <div className="flex flex-col gap-3">
          <div className="max-w-[76ch]">
            These are the settings that decide how much a task can do on its own, so
            they are worth a moment rather than a default.
          </div>
          <div className="rounded-lg border border-line bg-raised px-3.5 py-2">
            <Setting
              name="preview_on"
              value="pull_request"
              why="Build a preview once the PR opens rather than on every push, so a reviewer has one URL rather than a stream of them."
            />
            <Setting
              name="production_trigger"
              value="approval"
              why="Production waits for a human in AgentSync. Choosing merge hands that decision to whoever merges; manual means AgentSync never promotes."
            />
            <Setting
              name="promote_via_api"
              value="false to start"
              why="Leave the provider's own git integration in charge until you want AgentSync calling the deploy API itself."
            />
          </div>
        </div>
      ),
      wide: true,
    },
    {
      title: 'What this does, and what it does not',
      body: (
        <>
          The connection is recorded and the Deployments screen will show builds once
          they exist. It does <strong className="text-ink-3">not</strong> deploy
          anything yet: nothing calls the Vercel API, and no deployment webhook is
          received, so no row is written to{' '}
          <span className="mono text-ink-3">deployments</span> until those stages are
          built. Tasks reach a pull request either way.
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
  const supabase = useSupabaseConnection(tenantSlug);

  // One card per external system: what it is for, whether it is connected,
  // the facts that matter, and the one thing to do next.
  const anthropic = ai.find((c) => String(c.provider) === 'anthropic');
  const openai = ai.find((c) => String(c.provider) === 'openai');
  const ref = (c: Record<string, unknown> | undefined) => (c ? String(c.key_reference ?? '—') : '—');
  const cards: {
    mark: string;
    name: string;
    role: string;
    tab: ConnTab;
    state: 'connected' | 'missing' | 'optional';
    rows: [string, string, boolean?][];
  }[] = [
    {
      mark: 'GH',
      name: 'GitHub',
      role: 'Reads code, pushes branches and opens pull requests',
      tab: 'github',
      state: github ? 'connected' : 'missing',
      rows: github
        ? [
            ['App', String(github.app_slug ?? github.installation_id ?? '—'), true],
            ['Repositories', `${(github.repository_allowlist as string[] | null)?.length ?? 0} allowed`],
          ]
        : [['Needed for', 'Every task: nothing can be checked out without it']],
    },
    {
      mark: '▲',
      name: 'Deployments',
      role: 'Preview and production releases',
      tab: 'deploy',
      state: deployment ? 'connected' : 'optional',
      rows: deployment
        ? [
            ['Provider', String(deployment.provider ?? '—')],
            ['Previews on', String(deployment.preview_on ?? '—')],
          ]
        : [['Without it', 'Previews and production releases are skipped']],
    },
    {
      mark: 'A',
      name: 'Anthropic',
      role: 'Claude models and the Engineer’s sandbox',
      tab: 'ai',
      state: anthropic ? 'connected' : 'missing',
      rows: anthropic
        ? [['Key', ref(anthropic), true], ['Default model', String(anthropic.model ?? '—'), true]]
        : [['Needed for', 'Every agent: no model can be called without a provider']],
    },
    {
      mark: 'O',
      name: 'OpenAI',
      role: 'Optional: a second provider for failover',
      tab: 'ai',
      state: openai ? 'connected' : 'optional',
      rows: openai
        ? [['Key', ref(openai), true], ['Default model', String(openai.model ?? '—'), true]]
        : [['Used for', 'Taking over when Claude is busy, where projects allow it']],
    },
    {
      mark: 'SB',
      name: 'Supabase',
      role: 'Runs a change’s database scripts before it merges',
      tab: 'supabase',
      state: supabase.connection ? 'connected' : 'optional',
      rows: supabase.connection
        ? [
            ['Organisation', supabase.connection.organization ?? '—'],
            ['Projects', `${supabase.connection.projects.length} reachable`],
          ]
        : [['Without it', 'Database changes are applied by hand, then marked as applied']],
    },
  ];
  const missing = cards.filter((c) => c.state === 'missing' && !(c.name === 'Anthropic' && openai));

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[14px] leading-relaxed text-muted-3">
        The services AgentSync works through. Keys are never shown here: AgentSync stores a reference to where each one
        lives, and any connection can be turned off without touching your projects.
      </p>

      <div className="border-b border-line-soft">
        <Tabs tabs={CONN_TABS} active={tab} onSelect={onTab} />
      </div>

      {tab === 'overview' ? (
        <div className="flex flex-col gap-4">
          {missing.length ? (
            <div role="status" className="flex flex-wrap items-center gap-3 rounded-[10px] bg-caution-tint px-4 py-3 text-ink">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-caution-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
              <span className="flex-1 text-[13.5px]">
                <strong className="font-semibold">Finish setting up.</strong>{' '}
                {missing.map((c) => c.name).join(' and ')} {missing.length === 1 ? 'is' : 'are'} needed before tasks can run.
              </span>
              <button className="btn" onClick={() => onTab(missing[0].tab)}>Connect {missing[0].name}</button>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
            {cards.map((c) => {
              const pill: [string, string, string] =
                c.state === 'connected'
                  ? ['var(--color-ok-tint)', 'var(--color-ok-ink)', 'var(--color-ok)']
                  : c.state === 'missing'
                    ? ['var(--color-caution-tint)', 'var(--color-caution-ink)', 'var(--color-caution-ink)']
                    : ['var(--color-line-faint)', 'var(--color-ink-3)', 'var(--color-muted-4)'];
              return (
                <section key={c.name} aria-label={c.name} className="card flex flex-col gap-3 p-5">
                  <div className="flex items-center gap-3">
                    <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line-soft bg-raised text-[12px] font-bold">
                      {c.mark}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <h2 className="m-0 text-[15.5px] font-semibold">{c.name}</h2>
                      <span className="text-[12.5px] text-muted-3">{c.role}</span>
                    </div>
                    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-[5px] px-2 text-[12.5px] font-medium" style={{ background: pill[0], color: pill[1] }}>
                      <span className="size-1.5 rounded-full" style={{ background: pill[2] }} />
                      {c.state === 'connected' ? 'Connected' : c.state === 'missing' ? 'Needs setting up' : 'Not connected'}
                    </span>
                  </div>
                  <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                    {c.rows.map(([k, v, mono]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted-3">{k}</dt>
                        <dd className={`m-0 truncate ${mono ? 'mono text-[12.5px]' : ''}`}>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div>
                    <button className={c.state === 'connected' ? 'btn' : 'btn-primary'} onClick={() => onTab(c.tab)}>
                      {c.state === 'connected' ? 'Manage' : `Connect ${c.name}`}
                    </button>
                  </div>
                </section>
              );
            })}
          </div>

          {secrets.length ? (
            <section aria-labelledby="refs-h" className="card overflow-hidden">
              <div className="flex items-center gap-3 border-b border-line-soft px-5 py-3">
                <h2 id="refs-h" className="m-0 flex-1 text-[15px] font-semibold">Where the keys live</h2>
                <button className="btn" onClick={() => onTab('secrets')}>Manage references</button>
              </div>
              {secrets.slice(0, 6).map((sr) => (
                <div key={sr.reference} className="grid grid-cols-[minmax(0,1fr)_200px_140px] items-center gap-4 border-b border-line-faint px-5 py-2.5 last:border-0">
                  <span className="mono truncate text-[12.5px] text-ink-3">{sr.reference}</span>
                  <span className="truncate text-[13px] text-muted-3">{sr.used_by ?? '—'}</span>
                  <span className="text-right text-[12.5px] text-muted-3">
                    {sr.revoked ? 'Revoked' : sr.rotated_at ? <>Rotated <Ago iso={sr.rotated_at} /> ago</> : 'Never rotated'}
                  </span>
                </div>
              ))}
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === 'github' ? (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          {github ? (
            <Card title="GitHub App installation" scope="github_app_installations">
              <GithubForm tenantSlug={tenantSlug} existing={github} />
            </Card>
          ) : (
            <>
              <div className="xl:col-span-2">
                <Card title="Connect GitHub in one click" scope="creates and installs the AgentSync App">
                  <GithubOneClick tenantSlug={tenantSlug} />
                </Card>
              </div>
              <details className="card overflow-hidden xl:col-span-2">
                <summary className="cursor-pointer px-4 py-3 text-[14px] font-medium text-ink-2">
                  Set it up by hand instead
                </summary>
                <div className="grid grid-cols-1 items-start gap-4 border-t border-line p-4 xl:grid-cols-2">
                  <SetupSteps steps={githubSteps()} />
                  <GithubForm tenantSlug={tenantSlug} existing={github} />
                </div>
              </details>
            </>
          )}
        </div>
      ) : null}

      {tab === 'deploy' ? (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          {deployment ? null : (
            <Card title="Connect Vercel" scope="optional — tasks reach a pull request without it">
              <SetupSteps steps={vercelSteps()} />
            </Card>
          )}
          <Card
            title={deployment ? 'Deployment provider' : 'Provider details'}
            scope="deployment_providers"
          >
            <DeploymentForm tenantSlug={tenantSlug} existing={deployment} />
          </Card>
        </div>
      ) : null}

      {tab === 'ai' ? (
        <Card
          title="AI providers"
          scope="ai_provider_credentials · one credential per provider"
        >
          <AiForm tenantSlug={tenantSlug} credentials={ai} />
        </Card>
      ) : null}

      {tab === 'supabase' ? (
        <Card title="Supabase" scope="tenant_supabase_connections · token stored encrypted">
          <SupabaseForm tenantSlug={tenantSlug} conn={supabase} />
        </Card>
      ) : null}

      {tab === 'webhooks' ? (
        <Card title="Webhook endpoints" scope="webhook_endpoints · signed">
          <WebhookForm tenantSlug={tenantSlug} endpoints={webhooks} />
        </Card>
      ) : null}

      {tab === 'secrets' ? (
        <Card
          title="Secret references"
          scope="secret_references · values never leave the secret manager"
        >
          <SecretsForm tenantSlug={tenantSlug} secrets={secrets} />
        </Card>
      ) : null}
    </div>
  );
}
