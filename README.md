# AgentSync

The AgentSync control-plane front end, built with Next.js (App Router), TypeScript
and Tailwind CSS v4. Two surfaces live in this repository:

| Route     | What it is                                                                                |
| --------- | ----------------------------------------------------------------------------------------- |
| `/`       | Public site — how the pipeline works, guardrails, configuration model, rollout phases.      |
| `/portal` | Control plane — tasks, approvals, deployments, audit log, project, agent and tenant config. |

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
```

Other scripts:

```bash
npm run build      # production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```

## Structure

```
src/
  app/
    page.tsx              public site
    portal/page.tsx       control plane entry
    layout.tsx            fonts (IBM Plex Sans/Mono) + metadata
    globals.css           design tokens and shared primitives
  components/
    Aurora.tsx            WebGL hero backdrop (ogl, loaded on the client)
    portal/
      Portal.tsx          shell: screen routing, tenant + tab state
      Sidebar.tsx         navigation and tenant switcher
      ui.tsx              Pill, Tabs, FieldRows, CodeBlock, TableCard …
      screens/            Tasks, Detail, Ops, Config, Agents, Connections, Tenants
  lib/
    portal-data.ts        typed reads for every portal screen
    portal-ui.ts          colours, status maps, formatters — no data
    tasks.ts              submission, queue, transitions
    worker.ts             one tick: reclaim, claim, run a stage
    memory.ts             recall / remember, prompt rendering
  data/
    site.ts               marketing copy for the public page
```

## Database

The schema lives in `supabase/migrations/` and installs everything under a
dedicated `agentsync` schema:

| Migration                                    | What it does                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `0001_agentsync_schema.sql`                  | 27 tables, enums, `updated_at` triggers, row-level security and role grants.                       |
| `0002_agentsync_default_agents.sql`          | The seven platform-default agent definitions with prompts, model routing and tool grants.          |
| `0003_agentsync_pin_trigger_search_path.sql` | Pins `search_path` on the trigger functions.                                                       |
| `0004_agentsync_own_users_and_roles.sql`     | `agentsync.users` with bcrypt credentials; drops every dependency on Supabase Auth.                |
| `0005_agentsync_agent_memory.sql`            | `agentsync.memories`, derived edit history, and `recall()`.                                        |
| `0006` / `0007`                              | Staleness by checksum, then a monotonic sequence so "newest edit" is deterministic.                |
| `0008_agentsync_state_machine_and_queue.sql` | Legal transitions as data, `transition_task()`, `submit_task()`, and the worker queue.             |
| `0009_agentsync_source_system_auth.sql`      | Hashed source-system keys, `authenticate_source()`, and the `public.agentsync_*` wrappers.         |
| `0010_…_fix_authenticate_source_ambiguity`   | Qualifies a column the OUT parameter shadowed.                                                      |
| `0011_agentsync_portal_reads.sql`            | `portal_overview()` and `portal_task()` — everything the control plane displays.                    |
| `0012_agentsync_connect_github.sql`          | `connect_github()` / `disconnect_github()`, so the portal can record an installation.               |
| `0013_agentsync_github_app_id.sql`           | Adds `app_id` — the JWT that mints an installation token is signed against it, not the slug.        |
| `0014_agentsync_optional_webhook_secret.sql` | Makes the webhook secret optional while nothing receives webhooks.                                  |
| `0015_agentsync_connect_deployment.sql`      | `connect_deployment()`, plus `is_secret_reference()` — a reference must carry a scheme.              |
| `0016_…_github_uses_secret_reference_check`  | Holds the GitHub connection to that same rule.                                                      |
| `0017_agentsync_connect_remaining.sql`       | AI credentials, webhook endpoints and secret references — upsert and delete for each.                |

Applied to the **Supersync** project (`khojukxurlhjjgeeyobo`). For a new
project:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

…or paste each file into the SQL editor in order.

To read the schema over the Data API, add `agentsync` to **Project Settings →
API → Exposed schemas**; `src/lib/supabase.ts` pins every query to it.

### Identity

AgentSync does not use Supabase Auth. Users, credentials and roles are ordinary
rows in this schema:

- `agentsync.users` — email, display name, platform role, state, and
  `password_hash`. Nothing else references `auth.users`.
- Passwords are hashed with **bcrypt inside the database** by
  `agentsync.set_password()`, so plaintext never reaches application logs or
  query history. `password_hash` is excluded from every read grant — the
  `authenticated` role can select ten columns of `users`, and that is not one of
  them.
- `agentsync.verify_password(email, password)` returns the user id or `null`,
  without distinguishing a wrong password from an unknown email. Five
  consecutive failures lock the account for fifteen minutes.
- `agentsync.create_user(email, display_name, password, role)` is the way to
  add someone; it refuses passwords under 12 characters. All three helpers are
  `SECURITY DEFINER` and executable by the service role only.
- Per-tenant roles stay in `agentsync.tenant_users`
  (`SUPER_ADMIN` … `VIEWER`), separate from the platform role.

Because there is no JWT, RLS resolves the caller from a session setting:

```sql
set local agentsync.user_id = '<uuid>';   -- after your app has verified them
```

`agentsync.current_user_id()` reads it, and returns null when unset — so a
connection with no identity sees nothing. PostgREST cannot set this per
request, so RLS-governed queries need a direct PostgreSQL connection;
`src/lib/auth.ts` documents the split.

### Isolation model

- Every tenant-scoped table carries `tenant_id`, has RLS enabled **and forced**,
  and resolves membership through `agentsync.tenant_users`.
- `is_member()`, `has_role()` and `can_configure()` are `SECURITY DEFINER`
  helpers so policies don't recurse through `tenant_users`.
- Task records are read-only to the portal — workers write them with the service
  role. Approvals are the one task-side row a human writes, restricted to
  `SUPER_ADMIN`, `TENANT_ADMIN` and `APPROVER`.
- `task_events` is append-only: INSERT and SELECT policies only, no UPDATE or
  DELETE privilege for `authenticated`, plus a trigger that raises on either.
- `agent_tasks` is unique on `(tenant_id, idempotency_key)`, so a retry can
  never produce a second branch, pull request, deployment or callback.

Verified against the live database (all probes rolled back): a member sees only
their own tenant's rows, a connection with no `agentsync.user_id` sees nothing,
`can_configure()` is false across tenants, stored hashes are salted bcrypt with
no trace of the plaintext, wrong passwords and unknown emails are both rejected,
email matching is case-insensitive, and no foreign key to `auth` remains.

## Submitting work

`POST /api/v1/agent/tasks` is the intake for every system that can present a
source-system key — service desk, intake portal, CRM, cron, another agent.

```http
POST /api/v1/agent/tasks
Authorization: Bearer ask_live_…
Content-Type: application/json

{
  "project_id": "…uuid…",
  "idempotency_key": "SD-4821",
  "title": "Add rate limiting to the public search endpoint",
  "description": "…",
  "request_type": "code_change",
  "priority": "high",
  "acceptance_criteria": ["429 after 60 req/min", "existing tests pass"],
  "external_reference": "SD-4821",
  "requested_by": { "id": "u_91", "name": "Support" },
  "callback_url": "https://desk.example.com/hooks/agentsync",
  "tier": "medium",
  "attachments": [
    { "filename": "spec.pdf", "url": "https://files.desk.example.com/signed/…" },
    { "filename": "screen.png", "content_base64": "iVBORw0KGgo…" }
  ]
}
```

```json
202  { "task_id": "…", "correlation_id": "…", "status": "queued", "duplicate": false }
```

- **202** for new work, **200** with `duplicate: true` when the
  `idempotency_key` has been seen before for that tenant. The original task is
  returned rather than a second one started, so a caller that retries on a
  timeout never causes a duplicate branch, pull request or deployment.
- Errors carry a machine-readable code, not just prose:
  `INVALID_API_KEY` 401 · `SOURCE_DISABLED` / `IP_NOT_ALLOWED` 403 ·
  `PROJECT_NOT_FOUND` 404 · `PROJECT_DISABLED` / `CLIENT_NOT_MAPPED` 409 · `RATE_LIMITED` 429 ·
  `VALIDATION_FAILED` 422 (with every problem listed at once, not one per round
  trip).
- `callback_url` must be an absolute `https` URL — it is an outbound request
  AgentSync will make on the caller's behalf.
- `attachments` (optional, up to 10, 25 MB each): documents from the source
  system — PDF, PNG, JPEG, GIF, WebP, TXT, MD, CSV, JSON, DOCX, XLSX. Send each
  as an https `url` (a signed link is fine — the worker downloads it once,
  before analysis) or inline `content_base64` for small files (the request body
  is capped at 4.5 MB). Files are checked against their type, kept in a private
  bucket, and shown on the task. PDFs and images go to the models as files
  (Claude and OpenAI Files APIs); Word and Excel are converted to text; both
  sandboxes get the originals (`/workspace/attachments/…` for Claude). The
  Planner, Engineer and Reviewer all see them, as reference material rather than
  instructions. Provider copies expire after a week and are deleted when the task
  ends. Problems with individual files come back as `attachment_problems`.

### Routing by client, and what comes back

A service desk knows its work by client, not by repository. Send `client`
instead of `project_id` and AgentSync routes the task to the project that
client is mapped to (Source systems → **Map clients**):

```json
{ "client": { "id": "4b1e…", "name": "Acme Ltd" }, "idempotency_key": "leadsync-ticket-…", "title": "…" }
```

An unmapped client is recorded so it appears in the mapping table, and the task
is refused with `CLIENT_NOT_MAPPED` (409) until someone maps it.

A client can be mapped to several repositories, each with a short note on what
it is for. A ticket still goes to exactly one: with a single mapping it goes
straight there; with several, a small model reads the ticket against each
repository's name, note and recent task titles and picks one (logged on the
task as `task.routed`). When it isn't confident the answer is
`REPOSITORY_CHOICE_REQUIRED` (409) with the `candidates`; the source asks a
person and sends the ticket again with the chosen `project_id`, which must be
one of that client's repositories (`PROJECT_NOT_MAPPED_TO_CLIENT` otherwise). A source can
also report its whole client list up front, so clients can be mapped before
their first ticket:

```http
PUT /api/v1/agent/clients
Authorization: Bearer ask_live_…

{ "clients": [{ "id": "4b1e…", "name": "Acme Ltd", "active": true }] }
```

When `callback_url` is set, AgentSync POSTs to it as the task moves:

| `event` | when |
| --- | --- |
| `plan_ready` | the plan is waiting for approval |
| `pr_opened` | the pull request is waiting for the merge approval |
| `completed` | merged; carries `client_note`, a plain-language line for the requester |
| `failed` | the task stopped, with the reason in `summary` |
| `cancelled` | a person rejected it |

Each body also has `task_id`, `external_reference`, `title`, `status`,
`summary`, `plan_summary`, `pull_request_url`, `commit_sha` and `portal_url`
(a link straight to the task). It is signed as
`x-agentsync-signature: sha256=<hex HMAC-SHA256 of the raw body>` with the
source's callback secret (Source systems → Map clients → **Generate callback
secret**, shown once and stored encrypted), or the project's secret when the
source has none. A 5xx is retried once; a callback never fails the task.

### One-click connection for source systems

A multi-tenant source such as LeadSync connects each of its tenants without
anyone copying keys. The source sends its admin to:

```
/connect?app=LeadSync&account=<its tenant>&return_url=<https callback>&state=…&challenge=<base64url SHA-256 of a verifier>
```

The admin signs in (login honours a same-site `next`), picks one of the AgentSync
tenants they administer and approves. AgentSync finds or creates the source
`LeadSync · <account>` — reconnecting rotates its key and keeps its client
mappings — generates its callback secret, seals the key behind a one-time code
(10 minutes, single use) and sends the browser back to `return_url?code=…&state=…`.
The source's server then trades the code for its credentials:

```http
POST /api/v1/connect/exchange
{ "code": "…", "verifier": "…" }
→ { "api_key": "ask_live_…", "callback_secret": "whsec_…", "source_id": "…", "tenant_name": "…" }
```

The code only works with the verifier whose hash was sent as `challenge`, so a
code seen in a browser or a log is useless. `POST /api/v1/connect/revoke` with the
source's bearer key disables it (Disconnect).

Keys are issued once and stored hashed:

```sql
select public.agentsync_issue_source_key('acme', 'Service desk', '{}', 60, true);
-- {"source_system_id": "…", "api_key": "ask_live_…"}   ← shown exactly once
```

`agentsync.authenticate_source()` looks the key up by its stored prefix, compares
the bcrypt hash, then enforces the IP allowlist and the per-minute rate limit —
so no caller can skip one of those by forgetting to check it.

### State machine

Legal moves are **rows**, not code: `agentsync.task_transitions` holds every
`(from, to)` pair with a `requires_human` flag, and
`agentsync.transition_task()` refuses anything not in it. The audit event is
written in the same transaction as the status change, so the log cannot
disagree with the record, and a worker-driven move must present the worker id
holding the task.

```
received → validating → queued → analysing → planning
  → awaiting_plan_approval? → implementing ⇄ testing
  → creating_pull_request → deploying_preview? → awaiting_merge_approval
  → deploying_production → completed → rolled_back?
```

`needs_information` is reachable from any working stage, `failed` from any
stage that can error, and `cancelled` from anything not yet merged.

### Queue and workers

`agentsync.claim_next_task()` takes one task with `for update skip locked`:
queued work, or work in progress (`analysing`, `planning`, `implementing`,
`testing`, `creating_pull_request`, `deploying_production`) whose lease is free
and whose `next_attempt_at` has passed. Work already started is resumed before
new work is picked up, and the tenant's `maximum_concurrent_tasks` is never
exceeded. A crashed worker loses nothing — its lease expires and the next tick
resumes the task in the status it had reached.

On Vercel there is no long-running process. The worker runs inside a request:
right after a task is submitted and right after a person decides at a gate
(`after()` from `next/server`), with the per-minute cron in `vercel.json` as the
backstop (per-minute crons need a Vercel Pro plan). `/api/v1/worker/tick` is
authorised by `WORKER_SECRET` (or Vercel's `CRON_SECRET`), never by a
source-system key. A tick carries a task through as many stages as fit in about
200 seconds.

### What each agent does

| Status | Agent | Work | Recorded in |
|---|---|---|---|
| `analysing` | Analyst | Reads the repository tree and the files that match the request, through the GitHub App | `task_events` |
| `planning` | Planner (Claude) | Writes the plan: steps, files to touch, assumptions, open questions, rollback | `task_plans`, `task_ai_usage` |
| `awaiting_plan_approval` | a person | Approve, request changes (re-plans with the note), or reject | `task_approvals` |
| `implementing` | Engineer (Claude) | Writes full new file contents for the planned paths only, commits to `agentsync/<ref>`, opens the pull request | `task_file_changes` |
| `testing` | Validator, then Reviewer (Claude) | Waits for the repository's GitHub checks; a failure goes back to the Engineer with the log (2 repair rounds by default). Then the Reviewer judges the diff against every acceptance criterion | `task_command_runs`, `task_reviews` |
| `creating_pull_request` | worker | Writes the plan, checks and review into the pull request | `pull_request_body` |
| `awaiting_merge_approval` | a person | Approve (AgentSync merges), request changes (back to the Engineer), or reject (the pull request is closed) | `task_approvals` |
| `deploying_production` | worker | Squash-merges; Vercel's Git integration deploys main. Records a project memory and sends the callback | `task_events` |

**Model tiers.** Every agent has a model and thinking effort for each of three
tiers — Low, Medium, High — seeded with platform defaults and editable per
tenant (Agents → *Models by tier*). Each project has a default tier; a request
(portal or API, `"tier": "low" | "medium" | "high"`) can pick another.

**The Engineer in a sandbox (hybrid).** In projects set to *Sandbox* (the
default), the Engineer runs as a Claude Managed Agent: one session per attempt,
at the task's tier (`agent_with_overrides`), with the repository cloned in via a
short-lived GitHub App token (rotated while it runs) and a spending cap per
tier. It installs, lints, tests and builds, fixes failures and pushes the
branch; the worker polls the session. AgentSync then checks what was actually
pushed against the approved plan and protected paths before opening the pull
request. The Planner and Reviewer remain direct model calls. *Direct* mode keeps
the single-call Engineer. The agent and environment are created once per
Anthropic credential and updated (new version) when the Engineer prompt changes.

**OpenAI.** GPT models (GPT-5.5, 5.5 Pro, 5.4, 5.4 mini/nano) can fill any tier
slot; those agents call the Responses API with a strict JSON schema and the
slot's reasoning effort. Projects can also run the Engineer in an **OpenAI
sandbox** — a background Responses run with the hosted `shell` tool in a
container whose network is limited to GitHub and package registries, the GitHub
token passed as a secret scoped to github.com — with the same report, plan
check and pull request as the Claude sandbox. **Failover:** when a call fails
with a trigger listed on the provider's credential (`rate_limit`, `timeout`,
`5xx`), the step is retried once on the other provider — for projects that opt
in (Projects → *Fail over to the other provider*) where the credential requires
it — and the usage row is marked as a failover. OpenAI prices in `src/lib/ai.ts`
are estimates; correct them from OpenAI's pricing page.

Guardrails are enforced in code, not asked for in prompts: the Engineer's
changes outside the approved plan's paths are dropped, protected paths
(`.github/workflows/**`, `.env*`, keys) are never written, and file and line
limits come from `project_repositories`. Human-only transitions are refused by
the database unless they come through `decide_approval`, which checks the
user's role — the worker cannot approve its own work. Each agent's prompt and
model come from `agent_definitions` / `agent_ai_configs` (the Agents screen);
without a model set there, the tenant's Anthropic credential model is used,
then `claude-opus-5`.

Verified against the live database (all probes rolled back): an illegal
transition is refused, two concurrent claims never take the same task, the
concurrency cap holds, a repeated idempotency key returns the original task, a
disabled source and a non-allowlisted IP are both rejected, and an expired
lease returns its task to the queue.

## Project descriptions and releases

Every project has an **AGENTSYNC.md** in its repository: what the project is and
does, its main parts and how to run it. The agents read it before planning a
change, and the repository router reads it to tell a client's repositories apart.

- **Import** (Projects → Description → *Create for this project* / *for every
  project*): AgentSync reads `AGENTSYNC.md` from the default branch; where there
  is none, it copies the current description (README, else `CLAUDE.md` /
  `AGENTS.md`) into a new one and opens a pull request adding it.
- **Versions**: every change is a numbered version recording who or which task
  made it, when, and the text (`agentsync.project_document_versions`). The
  History tab compares any version with the one before and restores it. Edits and
  restores reach the repository by pull request (branch
  `agentsync/project-description`); *Check repository* records edits made
  directly in the repo as versions too.
- **Kept current by AgentSync**: the Reviewer writes the updated AGENTSYNC.md when
  a change alters what the project does, and it is committed to the task's own
  pull request, so it is reviewed with the code. When merged it becomes a version
  "Edited by AgentSync" linked to the task.

**Releases.** Each project has a version (read from `package.json` or its highest
`vX.Y.Z` tag at import). The Reviewer chooses the bump (major / minor / patch) and
writes a changelog entry; preparing the pull request reserves the next version
(`agentsync.project_releases`, so two open PRs never take the same number) and
commits the `CHANGELOG.md` entry to the PR. The merge releases it, tags the merge
commit `vX.Y.Z` and updates the project's version; a failed or rejected task frees
its reserved version.

## Code maps (Graphify)

Every project gets a map of its code made with
[Graphify](https://github.com/Graphify-Labs/graphify) (`graphifyy[sql,anthropic]==0.9.69`,
pinned): which files, functions and services connect to which, and the
subsystems they form. The code is parsed with tree-sitter (**code-only**: no
documents, no AI extraction) in a Vercel Sandbox that clones the repository with
a short-lived GitHub App token. One run:

```
graphify extract . --code-only [--update]   # graph.json
graphify cluster-only .                      # GRAPH_REPORT.md, graph.html
graphify label . --backend claude            # AI names for the subsystems (only with a key)
graphify god-nodes --json                    # hubs.json: the most-connected code
graphify export callflow-html                # callflow.html: architecture / call-flow diagrams
graphify tree                                # tree.html: file → symbol tree
graphify export wiki                         # wiki.json: one article per subsystem
graphify export svg                          # graph.svg: a picture of the graph
graphify reflect                             # LESSONS.md: what past tasks taught
```

- **AI names**: `label` runs with the tenant's Anthropic key and
  `claude-haiku-4-5` (a couple of short calls per run). Without a key, or if it
  fails, subsystems are named after their most-connected item and the run goes
  on. Every other command runs under `env -i`, so no key reaches it.
- **Lessons**: each finished task records an outcome against the map nodes it
  worked from (`agentsync.project_map_feedback`): *useful* when merged, *dead end*
  when it failed or was rejected without a reason, *corrected* when a person sent
  it back with one. A run writes them as Graphify memory files and `reflect`
  turns them into LESSONS.md.
- **When**: on import, after every merge, and on request (Projects → Map → *Map
  again* / *Map every project*). The worker's tick starts queued runs, two at a
  time (`AGENTSYNC_MAP_CONCURRENCY`), and collects finished ones; a run is stopped
  after 30 minutes. Outputs and Graphify's cache (so the next run re-parses only
  what changed) go to the private `project-maps` bucket; `agentsync.project_maps`
  tracks each run.
- **Portal** (Projects → Map): Report, Interactive map, Call flow, File tree,
  Wiki, Hubs, Lessons, Picture, and *Ask the map* (search, explain, what depends
  on it, how two things connect). Graphify's pages are served under a sandbox CSP
  (an opaque origin with no access to the portal), each with its library inlined
  from `public/vendor/` and checked against a pinned sha384: vis-network 9.1.6,
  d3 7.9.0, mermaid 11.17.2.
- **Agents** (`src/lib/graph-query.ts` answers Graphify's `query`, `affected`,
  `path` and `explain` from graph.json, following its scoring and traversal):
  - the Analyst adds the report, the lessons, the part of the code the request is
    about (`query`) and what depends on the files it looks likely to touch;
  - after planning, the plan's blast radius — everything depending on its files,
    and any hub it changes — is logged for the approver and given to the Engineer
    and the Reviewer, and goes in the pull request description;
  - the Engineer's sandbox gets graph.json and can run Graphify itself;
  - routing between a client's repositories adds the code in each that matches
    the ticket.
- **Credentials**: automatic on Vercel (OIDC); elsewhere set `VERCEL_ACCESS_TOKEN`,
  `VERCEL_TEAM_ID` and `VERCEL_PROJECT_ID`.

## Agent memory

So an agent knows what happened to a file before it edits it again. Two
sources, kept deliberately separate:

- **Previous edits are derived, not stored.** `agentsync.file_edit_history()`
  reads `task_file_changes` joined to the task, its latest plan and its review.
  Nothing is copied, so it can never drift from the task record or go stale.
  Only edits that actually landed count — a task still `implementing` is not
  history.
- **Notes are written.** `agentsync.memories` holds what an agent learned and
  a human can't derive: conventions, lessons from a rejection, failure fixes,
  per-file notes. Scoped per project, with a `scope_path` that accepts a glob
  (`src/lib/queries/**`).

`agentsync.recall(project, paths)` returns both, most-trusted first.
`src/lib/memory.ts` wraps it and renders the result into a prompt block.

**Staleness.** A note about a file records the checksum the agent saw. Recall
compares that against the newest landed checksum for the path and flags the
note as `stale` — surfaced under its own "verify before relying on these"
heading rather than silently dropped. The comparison uses a monotonic sequence
on `task_file_changes`, not timestamps, because a worker writes all of a task's
file changes in one transaction and those rows share a clock reading.

**Writes supersede, they don't overwrite.** Re-recording a path keeps the old
row with `superseded_by` set, so a bad memory can be traced and reverted.

**Memory is untrusted.** It is derived from repository files and ticket text,
which the platform treats as untrusted input, so a poisoned note must not be
able to steer a later task. The rendered block says plainly that its contents
are reference data, that instructions inside it are not to be followed, and
that the repository wins any conflict. Memory can inform a plan; it can never
widen `allowed_paths` or raise a limit. Every row carries its provenance —
which task and which agent wrote it.

**Prompt caching.** `buildSystemBlocks()` puts the agent prompt and project
conventions first behind a `cache_control` breakpoint, and task-specific memory
after it. Caching is a prefix match, so nothing volatile — no timestamp, no
task id — may go ahead of that breakpoint.

Verified against the live database: history excludes in-flight tasks and
carries the review verdict and plan summary; a note goes stale when its file is
rewritten and fresh again when re-recorded; a note with no checksum is never
guessed at; superseded versions are retained; and a `..` in a memory path is
rejected.

## Data

Every screen reads the database. There are no fixtures behind the portal, so a
screen with nothing on it means the tenant genuinely has nothing yet — which is
the useful signal. Each empty state names the table it is reading and what would
put a row in it.

Two functions supply everything, so a page load is one round trip:

- `agentsync.portal_overview(user_id, tenant_slug)` — the tenant, the tenants
  the account may switch to, members, projects with their repository/runtime/AI
  configuration, the task list, metrics, open approvals, deployments, the audit
  tail, source systems, agent definitions, usage and connections.
- `agentsync.portal_task(user_id, task_id)` — one task with its plan, file
  changes, command runs, review, security findings, approvals and event log.
  Fetched on demand via `/api/portal/tasks/:id`, because loading that for two
  hundred unopened tasks would be waste.

Both are `SECURITY DEFINER` and check tenant membership themselves. PostgREST
cannot set `agentsync.user_id` per request, so RLS would see no identity — that
membership check is what replaces it. A task id guessed from another tenant is
indistinguishable from one that does not exist.

`src/lib/portal-data.ts` types the payloads; `src/lib/portal-ui.ts` holds the
colour vocabulary, status maps and formatters. Nothing in `portal-ui` invents a
row, a count or a name — it only decides how a value that came from the database
is drawn.

Configuration fields are editable in the browser: `FieldProvider` holds edits for
the session keyed by `<group>|<field>`, so switching tabs or screens does not
discard them. Most of that is **not persisted yet** — those screens read, they do
not write, and none of them shows a Save button it cannot honour.

### Connecting GitHub

Connections → GitHub is the one screen that writes. It carries the steps that
have to happen on github.com — creating the App with least privilege, generating
the key, installing it on selected repositories — and then a form that records
the installation, through `POST /api/portal/connections/github`.

- The steps cover the whole GitHub form field by field, including the ones whose
  right answer is *leave it empty* — callback URL, setup URL, user authorization
  — because AgentSync acts as the App itself and never signs a user in.
- **Switch the App's webhook off.** Nothing here receives GitHub events yet, so
  the webhook secret is optional and the field is left blank.
- The private key and webhook secret are **not fields**. What is stored is the
  name of the environment variable holding each one, so the row can be read back
  into a web page without ever carrying a credential. `connect_github()` rejects
  a reference that looks like a pasted key.
- Both the **App ID** and the **installation id** are recorded. They are
  different numbers and easy to swap, so the database refuses a save where they
  match: the App ID signs the JWT that mints a token, the installation id names
  which installation that token is for.
- Only a `SUPER_ADMIN` or `TENANT_ADMIN` may connect a repository host — the
  check is in the database, not the form.
- `repository_allowlist` entries must be `owner/repository`, and one tenant has
  one installation: a unique index makes a second save an update rather than a
  duplicate the portal would never show.

Verified against the live database (probes rolled back): a viewer is refused, a
malformed repository name, an out-of-range token lifetime, an empty allowlist and
a pasted private key are each rejected by name, a valid call succeeds, re-saving
updates in place, and disconnecting removes the row.

**One click.** Connections → GitHub → *Connect GitHub* uses GitHub's App
manifest flow: GitHub opens with the AgentSync App pre-filled (permissions
below), you click Create, pick repositories, and are sent back connected. The
App's private key is stored AES-256-GCM encrypted in `agentsync.encrypted_secrets`
and referenced as `db:<id>`; the encryption key lives only in the deployment as
`AGENTSYNC_ENCRYPTION_KEY` (set it once before the first connection). The state
carried through GitHub's redirects is signed and bound to the person who
started it.

**Requests from the portal.** Each project has a *New request* form (title,
details, acceptance criteria, type, priority). It goes through exactly the
same pipeline as an API submission, attributed to the signed-in person;
viewers can see projects but not submit.

**Each repository is a project.** Connecting GitHub creates one project per
repository the App is installed on (plan and merge approval on; workflows,
`.env*` and keys protected). Adding or removing repositories on GitHub and
returning through its redirect — or pressing *Sync from GitHub* on the Projects
screen — keeps them in step: new repositories get projects, removed ones have
their project disabled (history kept), and returning ones are re-enabled. A
task names its project by the Project ID shown on that screen.

**By hand.** **What the App needs.** Repository permissions: Contents (read & write), Pull
requests (read & write), Checks (read), Actions (read), Metadata (read). Put the
private key in a Vercel environment variable (for example
`GITHUB_APP_PRIVATE_KEY`, with newlines or `\n`) and enter
`env:GITHUB_APP_PRIVATE_KEY` as its reference. The repository should have a
GitHub Actions workflow that runs on `pull_request` — `docs/agentsync-ci.example.yml`
is a starting point; without one, tasks go to review with checks marked as not
reported.

### Connecting a deployment provider

Connections → Deployment does the same for Vercel (Netlify, Cloudflare Pages and
Render are accepted too). Optional: without it, tasks still reach a pull request
and the preview and production stages are skipped.

- `preview_on` and `production_trigger` are the settings that decide how much a
  task does unattended, so the steps argue for `pull_request` and `approval`
  rather than defaulting them silently.
- `promote_via_api` while `production_trigger` is `manual` is refused — asking
  AgentSync to promote through the provider API while saying production is never
  automatic contradicts itself.
- `token_scope` is required. It records what the stored token may actually do,
  so a reviewer can judge the blast radius without logging in to the provider;
  defaulting it would put a claim on the record nobody made.

**A secret reference must carry a scheme** — `env:VERCEL_API_TOKEN`, not
`VERCEL_API_TOKEN` and certainly not the token. `agentsync.is_secret_reference()`
enforces it for both connections. The previous check only caught a pasted PEM,
which a 24-character Vercel token would have walked straight past.

Verified against the live database: a raw token, an unsupported provider, a
missing scope, a bad trigger and the promotion contradiction are each rejected by
name; a valid call succeeds; re-saving updates in place; disconnect removes the
row; and GitHub now refuses a bare variable name too.

As with GitHub, this records the configuration and deploys nothing — no call is
made to the provider and no deployment webhook is received, so `deployments`
stays empty until those stages exist.

### The remaining connections

**AI providers** — one credential per provider, so Anthropic and OpenAI can both
be configured and either can be the fallback for the other. The key is a
reference, never the value. A credential with no monthly cap *and* no hard stop
is refused: a cap that stops nothing would read as a limit without being one.

**Webhooks** — inbound paths on this application, outbound `https` callbacks
elsewhere. An enabled endpoint with no signing secret is refused rather than
allowed to look configured, since it would accept or send unauthenticated
traffic; save it disabled while the receiving code does not exist.

**Secrets** — the register of what secrets exist, what uses them and when they
were last rotated. Recording a rotation is a separate action from editing the
row, because an edit must not claim a rotation that did not happen — a stale
date reads as reassurance. Deleting a reference another connection still names
is refused.

Every one of these resolves the caller through `agentsync.configurable_tenant()`,
so the role check lives in one place and a new connection type cannot ship
without it.

Verified against the live database: 30 probes covering each rejection by name,
upsert-not-duplicate on re-save, delete, and the viewer gate on all three.

## Design system

One dark theme, defined as Tailwind theme tokens in `globals.css`:

- surfaces `--color-canvas` → `--color-raised`, borders `--color-line*`
- text `--color-ink` → `--color-muted-4`
- status colours `--color-ok` / `--color-warn` / `--color-danger` / `--color-info`,
  applied as `[background, foreground]` pairs on status pills
- IBM Plex Sans for prose, IBM Plex Mono for identifiers, table headers, config
  keys and log output
