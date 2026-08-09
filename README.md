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
  "callback_url": "https://desk.example.com/hooks/agentsync"
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
  `PROJECT_NOT_FOUND` 404 · `PROJECT_DISABLED` 409 · `RATE_LIMITED` 429 ·
  `VALIDATION_FAILED` 422 (with every problem listed at once, not one per round
  trip).
- `callback_url` must be an absolute `https` URL — it is an outbound request
  AgentSync will make on the caller's behalf.

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

`agentsync.claim_next_task()` takes one queued task with
`for update skip locked`, ordered by priority then age, and refuses to exceed
the tenant's `maximum_concurrent_tasks`. The claim sets a lease;
`heartbeat_task()` extends it and `reclaim_expired_tasks()` returns tasks whose
worker died. A crashed worker therefore loses nothing — the lease expires and
the task goes back on the queue.

On Vercel there is no long-running process, so the loop lives in a cron
(`vercel.json`) that calls `/api/v1/worker/tick`, authorised by `WORKER_SECRET`
(or Vercel's `CRON_SECRET`) — never by a source-system key. Each tick reclaims,
claims at most one task, and runs exactly one stage.

**What is not built yet.** The `analyse` stage needs a GitHub App installation
and a checkout workspace; the `plan` stage needs `ANTHROPIC_API_KEY` and a
provider adapter. Both throw `StageNotConfigured` and fail the task with that
reason on the record, rather than silently advancing it — a stage that no-ops
would move a task forward with nothing behind it, which is the one failure mode
this pipeline must not have.

Verified against the live database (all probes rolled back): an illegal
transition is refused, two concurrent claims never take the same task, the
concurrency cap holds, a repeated idempotency key returns the original task, a
disabled source and a non-allowlisted IP are both rejected, and an expired
lease returns its task to the queue.

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

**Connecting GitHub does not yet make tasks run.** The `analyse` stage still has
no checkout workspace and no token minting, so a submitted task goes
`queued → analysing → failed` with `STAGE_NOT_CONFIGURED` recorded. The screen
says so as its last setup step.

## Design system

One dark theme, defined as Tailwind theme tokens in `globals.css`:

- surfaces `--color-canvas` → `--color-raised`, borders `--color-line*`
- text `--color-ink` → `--color-muted-4`
- status colours `--color-ok` / `--color-warn` / `--color-danger` / `--color-info`,
  applied as `[background, foreground]` pairs on status pills
- IBM Plex Sans for prose, IBM Plex Mono for identifiers, table headers, config
  keys and log output
