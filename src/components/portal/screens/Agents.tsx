'use client';

import type { AgentDefinition } from '@/lib/portal-data';
import {
  ACCENT,
  GRANT_COLOUR,
  compact,
  duration,
  money,
  rowsFrom,
  swatch,
} from '@/lib/portal-ui';
import { Ago, CodeBlock, ColLabel, Empty, FieldRows, Pill, Tabs } from '../ui';

export const AGENT_TABS = [
  { k: 'setup', label: 'Setup' },
  { k: 'prompt', label: 'Prompt' },
  { k: 'tools', label: 'Tools' },
  { k: 'pipeline', label: 'Pipeline' },
  { k: 'limits', label: 'Limits' },
  { k: 'runs', label: 'Runs' },
] as const;

export type AgentTab = (typeof AGENT_TABS)[number]['k'];

/** The prompt is stored as one string; render it as lines without inventing colour. */
function promptLines(prompt: string | null) {
  if (!prompt) return [{ text: 'No system prompt is set.', color: '#71717B' }];
  return prompt.split('\n').map((text) => ({ text, color: '#C6C6CD' }));
}

function setupGroups(agent: AgentDefinition) {
  return [
    {
      title: 'Definition',
      table: 'agent_definitions',
      rows: rowsFrom({
        key: agent.key,
        display_name: agent.display_name,
        stage_order: agent.stage_order,
        enabled: agent.enabled,
        optional_stage: agent.optional_stage,
        terminal_stage: agent.terminal_stage,
        blocking: agent.blocking,
        veto_power: agent.veto_power,
        may_self_approve: agent.may_self_approve,
        requires_approved_plan: agent.requires_approved_plan,
        request_types: agent.request_types,
      }),
    },
    {
      title: 'Model routing',
      table: 'agent_ai_configs',
      rows: rowsFrom(agent.ai as Record<string, unknown> | null),
      missing: 'No model routing is configured for this agent.',
    },
    {
      title: 'Inputs',
      table: 'agent_definitions.inputs',
      rows: rowsFrom(agent.inputs),
      missing: 'No declared inputs.',
    },
    {
      title: 'Outputs',
      table: 'agent_definitions.outputs',
      rows: rowsFrom(agent.outputs),
      missing: 'No declared outputs.',
    },
    {
      title: 'Checks',
      table: 'agent_definitions.checks',
      rows: rowsFrom(agent.checks),
      missing: 'This agent declares no checks of its own.',
    },
  ];
}

export default function Agents({
  agents,
  agentKey,
  onAgent,
  tab,
  onTab,
  setupGroup,
  onSetupGroup,
}: {
  agents: AgentDefinition[];
  agentKey: string | null;
  onAgent: (k: string) => void;
  tab: AgentTab;
  onTab: (t: AgentTab) => void;
  setupGroup: number;
  onSetupGroup: (i: number) => void;
}) {
  if (agents.length === 0) {
    return (
      <Empty
        title="No agent definitions"
        detail="Agent definitions carry the prompt, model routing, tool grants and limits for each pipeline stage. The platform defaults install with the schema."
        table="agentsync.agent_definitions"
      />
    );
  }

  const agent = agents.find((a) => a.key === agentKey) ?? agents[0];
  const groups = setupGroups(agent);
  const sg = groups[Math.min(setupGroup, groups.length - 1)];

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[268px_1fr]">
      {/* ---- agent list ---- */}
      <div className="flex flex-col gap-2">
        <div className="label">AGENT DEFINITIONS</div>
        {agents.map((a) => (
          <button
            key={a.key}
            onClick={() => onAgent(a.key)}
            className="cursor-pointer rounded-lg border p-3 text-left"
            style={{
              background: agent.key === a.key ? '#1A1A1D' : '#141416',
              borderColor: agent.key === a.key ? '#3A3A40' : '#242428',
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="size-1.5 rounded-full"
                style={{ background: a.enabled ? '#4ADE80' : '#6A6A73' }}
              />
              <span className="flex-1 text-[13px] font-semibold">
                {a.display_name}
              </span>
              <span className="mono text-[9.5px] text-muted-2">
                stage {a.stage_order}
              </span>
            </div>
            <div className="mono mt-1 text-[10px] text-muted-3">{a.key}</div>
            <div className="mt-1 line-clamp-2 text-[11.5px] text-muted">
              {a.purpose}
            </div>
          </button>
        ))}
      </div>

      {/* ---- agent detail ---- */}
      <div className="card min-w-0 overflow-hidden">
        <div className="flex flex-col items-start gap-4 p-4 lg:flex-row">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
              <span className="mono text-[11px] text-accent">{agent.key}</span>
              <Pill c={agent.enabled ? ['#122E1E', '#6FD69C'] : ['#212125', '#9A9AA3']}>
                {agent.enabled ? 'ENABLED' : 'DISABLED'}
              </Pill>
              <span className="mono text-[10.5px] text-muted-2">
                {agent.platform_default ? 'platform default' : 'tenant override'}
              </span>
              {agent.veto_power ? (
                <Pill c={['#331515', '#F08A80']}>VETO</Pill>
              ) : null}
            </div>
            <div className="text-[18px] font-semibold tracking-[-0.02em]">
              {agent.display_name}
            </div>
            <div
              className="mt-1.5 max-w-[720px] text-[12.5px] text-muted"
              style={{ lineHeight: 1.6 }}
            >
              {agent.purpose}
            </div>
          </div>
        </div>

        <div className="card-head">
          <Tabs
            tabs={AGENT_TABS.map((t) => ({ k: t.k, label: t.label }))}
            active={tab}
            onSelect={onTab}
          />
        </div>

        {tab === 'setup' ? (
          <div className="p-4">
            <div className="mb-3.5 flex flex-wrap gap-1.5">
              {groups.map((c, i) => (
                <button
                  key={c.title}
                  onClick={() => onSetupGroup(i)}
                  className="cursor-pointer rounded-md border px-3 py-1.5 text-[11.5px] font-medium"
                  style={{
                    background: sg.title === c.title ? '#F2F2F4' : '#141416',
                    color: sg.title === c.title ? '#0A0A0B' : '#9A9AA3',
                    borderColor: sg.title === c.title ? '#F2F2F4' : '#242428',
                  }}
                >
                  {c.title}
                </button>
              ))}
            </div>
            <div className="mb-3 flex items-center gap-2.5">
              <div className="text-[13px] font-semibold">{sg.title}</div>
              <div className="mono text-[10px] text-muted-2">{sg.table}</div>
            </div>
            {sg.rows.length === 0 ? (
              <div className="text-[12.5px] text-muted">
                {sg.missing ?? 'Nothing configured.'}
              </div>
            ) : (
              <FieldRows prefix={`${agent.key}.${sg.title}`} rows={sg.rows} />
            )}
          </div>
        ) : null}

        {tab === 'prompt' ? (
          <div className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2.5">
              <div className="text-[13px] font-semibold">System prompt</div>
              <div className="mono text-[10px] text-muted-2">
                agent_definitions.system_prompt
              </div>
              <div className="flex-1" />
              <Pill c={['#33240F', '#F0B45E']}>
                AGENTS.md IN REPO TAKES PRECEDENCE
              </Pill>
            </div>
            <CodeBlock lines={promptLines(agent.system_prompt)} />
            {Object.keys(agent.templates).length > 0 ? (
              <div className="mt-4">
                <div className="label mb-2">TEMPLATES</div>
                <FieldRows
                  prefix={`${agent.key}.templates`}
                  rows={rowsFrom(agent.templates)}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'tools' ? (
          agent.tools.length === 0 ? (
            <div className="p-8 text-[12.5px] text-muted">
              This agent has no tool grants, so it can call nothing.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="grid min-w-[720px] grid-cols-[200px_1fr_100px] gap-3 border-b border-line bg-raised px-4 py-[9px]">
                <ColLabel>TOOL</ColLabel>
                <ColLabel>SCOPE</ColLabel>
                <ColLabel right>GRANT</ColLabel>
              </div>
              {agent.tools.map((t) => (
                <div
                  key={t.tool_name}
                  className="grid min-w-[720px] grid-cols-[200px_1fr_100px] items-center gap-3 border-b border-line-faint px-4 py-2.5"
                >
                  <span className="mono text-[11.5px] text-ink-2">
                    {t.tool_name}
                  </span>
                  <span className="text-[12px] text-muted">{t.scope}</span>
                  <div className="text-right">
                    <Pill c={swatch(GRANT_COLOUR, t.grant_level)}>
                      {t.grant_level}
                    </Pill>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : null}

        {tab === 'pipeline' ? (
          <div className="p-4">
            <div className="label mb-3">STAGE ORDER · ALL AGENTS</div>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
              {agents.map((p) => {
                const current = p.key === agent.key;
                return (
                  <div
                    key={p.key}
                    className="rounded-lg border p-3"
                    style={{
                      borderColor: current ? ACCENT : '#242428',
                      background: current ? '#1A1A1D' : '#141416',
                      opacity: p.enabled ? 1 : 0.55,
                    }}
                  >
                    <div className="mono text-[9.5px] text-muted-2">
                      STAGE {p.stage_order}
                      {p.optional_stage ? ' · OPTIONAL' : ''}
                      {p.enabled ? '' : ' · DISABLED'}
                    </div>
                    <div
                      className="mt-1 text-[13px] font-semibold"
                      style={{ color: current ? '#F2F2F4' : '#C6C6CD' }}
                    >
                      {p.display_name}
                    </div>
                    <div className="mt-1 text-[11.5px] text-muted">
                      {p.request_types.join(', ')}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {tab === 'limits' ? (
          <div className="p-4">
            <div className="mb-3 flex items-center gap-2.5">
              <div className="text-[13px] font-semibold">Limits &amp; budget</div>
              <div className="mono text-[10px] text-muted-2">
                agent_definitions.limits
              </div>
            </div>
            {Object.keys(agent.limits).length === 0 ? (
              <div className="text-[12.5px] text-muted">
                No limits are configured for this agent, so it inherits the
                project and tenant caps.
              </div>
            ) : (
              <FieldRows
                prefix={`${agent.key}.limits`}
                rows={rowsFrom(agent.limits)}
              />
            )}
          </div>
        ) : null}

        {tab === 'runs' ? (
          agent.runs.length === 0 ? (
            <div className="p-8 text-[12.5px] text-muted">
              This agent has not run yet. Every model call is recorded per task
              with its token counts, cost and duration.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="grid min-w-[820px] grid-cols-[120px_minmax(160px,1fr)_100px_80px_80px_90px] gap-3 border-b border-line bg-raised px-4 py-[9px]">
                <ColLabel>TASK</ColLabel>
                <ColLabel>MODEL</ColLabel>
                <ColLabel>TOKENS</ColLabel>
                <ColLabel>COST</ColLabel>
                <ColLabel>TIME</ColLabel>
                <ColLabel right>WHEN</ColLabel>
              </div>
              {agent.runs.map((r, i) => (
                <div
                  key={`${r.reference}-${i}`}
                  className="grid min-w-[820px] grid-cols-[120px_minmax(160px,1fr)_100px_80px_80px_90px] items-center gap-3 border-b border-line-faint px-4 py-2.5"
                >
                  <span className="mono text-[11px] text-accent">
                    {r.reference}
                  </span>
                  <span className="mono text-[11px] text-ink-3">
                    {r.model ?? '—'}
                    {r.failover ? (
                      <span className="text-warn"> · failover</span>
                    ) : null}
                  </span>
                  <span className="mono text-[10.5px] text-muted">
                    {compact(r.input_tokens)} / {compact(r.output_tokens)}
                  </span>
                  <span className="mono text-[10.5px] text-muted">
                    {money(r.cost)}
                  </span>
                  <span className="mono text-[10.5px] text-muted">
                    {duration(r.duration_seconds)}
                  </span>
                  <span className="mono text-right text-[10.5px] text-muted-2">
                    <Ago iso={r.created_at} />
                  </span>
                </div>
              ))}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
