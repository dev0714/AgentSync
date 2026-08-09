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

## Data

Every screen reads from `src/data/*`. Each configuration group carries the
Supabase table it maps to (`project_repositories`, `agent_definitions`,
`tenants.settings`, …), so wiring the portal to a real backend means replacing
the fixture module behind each screen rather than reshaping the components.

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
