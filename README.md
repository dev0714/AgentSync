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
  data/
    site.ts               marketing copy
    portal.ts             tasks, approvals, deployments, audit, tenants, connections
    agents.ts             agent definitions, prompts, tool grants, limits, runs
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

## Data

Every screen currently reads fixtures from `src/data/*`. Each configuration
group carries the Supabase table it maps to (`project_repositories`,
`agent_definitions`, `tenants.settings`, …), so wiring a screen to the database
means swapping the fixture import for a query — the component shapes already
match the tables.

Configuration fields are editable in the browser: `FieldProvider` holds edits for
the session keyed by `<group>|<field>`, so switching tabs or screens does not
discard them. Nothing is persisted yet.

## Design system

One dark theme, defined as Tailwind theme tokens in `globals.css`:

- surfaces `--color-canvas` → `--color-raised`, borders `--color-line*`
- text `--color-ink` → `--color-muted-4`
- status colours `--color-ok` / `--color-warn` / `--color-danger` / `--color-info`,
  applied as `[background, foreground]` pairs on status pills
- IBM Plex Sans for prose, IBM Plex Mono for identifiers, table headers, config
  keys and log output
