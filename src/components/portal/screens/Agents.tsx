'use client';

import {
  AGENTS,
  AGENT_TABS,
  HANDOFFS,
  LIMIT_BEHAVIOUR,
  PIPELINE,
  PROMPT_VARS,
  type AgentTab,
} from '@/data/agents';
import { ACCENT } from '@/data/portal';
import { CodeBlock, ColLabel, FieldRows, Pill, Tabs } from '../ui';

export default function Agents({
  agentKey,
  onAgent,
  tab,
  onTab,
  setupGroup,
  onSetupGroup,
}: {
  agentKey: string;
  onAgent: (k: string) => void;
  tab: AgentTab;
  onTab: (t: AgentTab) => void;
  setupGroup: number;
  onSetupGroup: (i: number) => void;
}) {
  const agent = AGENTS.find((a) => a.key === agentKey) ?? AGENTS[1];
  const sg = agent.setup[Math.min(setupGroup, agent.setup.length - 1)];

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[268px_1fr]">
      {/* ---- agent list ---- */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="label flex-1">AGENT DEFINITIONS</div>
          <button className="mono cursor-pointer text-[10.5px] text-accent">
            + New agent
          </button>
        </div>
        {AGENTS.map((a) => (
          <button
            key={a.key}
            onClick={() => onAgent(a.key)}
            className="cursor-pointer rounded-lg border p-3 text-left"
            style={{
              background: agentKey === a.key ? '#1A1A1D' : '#141416',
              borderColor: agentKey === a.key ? '#3A3A40' : '#242428',
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="size-1.5 rounded-full"
                style={{ background: a.enabled ? '#4ADE80' : '#6A6A73' }}
              />
              <span className="text-[13px] font-semibold">{a.name}</span>
              <span className="mono text-[9.5px] text-muted-2">{a.stage}</span>
            </div>
            <div className="mono mt-1 text-[10px] text-muted-3">{a.key}</div>
            <div className="mt-1 text-[11.5px] text-muted">{a.blurb}</div>
          </button>
        ))}
        <div className="mono text-[10px] text-muted-3">
          Duplicate an agent to start a new one
        </div>
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
                {agent.scope}
              </span>
            </div>
            <div className="text-[18px] font-semibold tracking-[-0.02em]">
              {agent.name}
            </div>
            <div
              className="mt-1.5 max-w-[720px] text-[12.5px] text-muted"
              style={{ lineHeight: 1.6 }}
            >
              {agent.purpose}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn">Duplicate</button>
            <button className="btn">Dry run</button>
            <button className="btn-primary">Save</button>
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
              {agent.setup.map((c, i) => (
                <button
                  key={c.title}
                  onClick={() => onSetupGroup(i)}
                  className="cursor-pointer rounded-md border px-3 py-1.5 text-[11.5px] font-medium"
                  style={{
                    background: setupGroup === i ? '#F2F2F4' : '#141416',
                    color: setupGroup === i ? '#0A0A0B' : '#9A9AA3',
                    borderColor: setupGroup === i ? '#F2F2F4' : '#242428',
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
            <FieldRows prefix={`${agent.key}.${sg.title}`} rows={sg.rows} />
          </div>
        ) : null}

        {tab === 'prompt' ? (
          <div className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2.5">
              <div className="text-[13px] font-semibold">System prompt</div>
              <div className="mono text-[10px] text-muted-2">
                agent_definitions.system_prompt · {agent.promptMeta}
              </div>
              <div className="flex-1" />
              <Pill c={['#33240F', '#F0B45E']}>
                AGENTS.md IN REPO TAKES PRECEDENCE
              </Pill>
            </div>
            <CodeBlock lines={agent.prompt} />
            <div className="mt-4">
              <div className="label mb-2">AVAILABLE VARIABLES</div>
              <div className="flex flex-wrap gap-1.5">
                {PROMPT_VARS.map((v) => (
                  <span
                    key={v}
                    className="mono rounded-[5px] border border-line bg-raised px-2 py-1 text-[10px] text-muted"
                  >
                    {v}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'tools' ? (
          <div className="overflow-x-auto">
            <div className="grid min-w-[720px] grid-cols-[200px_1fr_100px] gap-3 border-b border-line bg-raised px-4 py-[9px]">
              <ColLabel>TOOL</ColLabel>
              <ColLabel>SCOPE</ColLabel>
              <ColLabel right>GRANT</ColLabel>
            </div>
            {agent.tools.map((t) => (
              <div
                key={t.name}
                className="grid min-w-[720px] grid-cols-[200px_1fr_100px] items-center gap-3 border-b border-line-faint px-4 py-2.5"
              >
                <span className="mono text-[11.5px] text-ink-2">{t.name}</span>
                <span className="text-[12px] text-muted">{t.scope}</span>
                <div className="text-right">
                  <Pill c={t.c}>{t.grant}</Pill>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {tab === 'pipeline' ? (
          <div className="p-4">
            <div className="label mb-3">
              PIPELINE FOR REQUEST TYPE · code_change
            </div>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
              {PIPELINE.map((p) => {
                const current = p.name === agent.name;
                return (
                  <div
                    key={p.order}
                    className="rounded-lg border p-3"
                    style={{
                      borderColor: current ? ACCENT : '#242428',
                      background: current ? '#1A1A1D' : '#141416',
                    }}
                  >
                    <div className="mono text-[9.5px] text-muted-2">
                      {p.order}
                    </div>
                    <div
                      className="mt-1 text-[13px] font-semibold"
                      style={{ color: current ? '#F2F2F4' : '#C6C6CD' }}
                    >
                      {p.name}
                    </div>
                    <div className="mt-1 text-[11.5px] text-muted">{p.out}</div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4">
              <div className="mb-2 text-[13px] font-semibold">Handoff rules</div>
              <div className="overflow-hidden rounded-lg border border-line">
                {HANDOFFS.map((h) => (
                  <div
                    key={h.on}
                    className="grid grid-cols-1 gap-1 border-b border-line-faint px-3.5 py-2.5 last:border-b-0 lg:grid-cols-[220px_1fr] lg:gap-3"
                  >
                    <div
                      className="mono text-[11px]"
                      style={{ color: h.keyColor }}
                    >
                      {h.on}
                    </div>
                    <div className="text-[12px] text-muted">{h.then}</div>
                  </div>
                ))}
              </div>
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
            <FieldRows prefix={`${agent.key}.limits`} rows={agent.limits} />
            <div className="mt-4 rounded-lg border border-line bg-raised p-3.5">
              <div className="label mb-2">WHEN A LIMIT IS HIT</div>
              <div className="flex flex-col gap-1.5">
                {LIMIT_BEHAVIOUR.map((t) => (
                  <div key={t} className="text-[12px] text-muted">
                    {t}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'runs' ? (
          <div className="overflow-x-auto">
            <div className="grid min-w-[820px] grid-cols-[120px_minmax(200px,1fr)_80px_70px_80px_90px] gap-3 border-b border-line bg-raised px-4 py-[9px]">
              <ColLabel>TASK</ColLabel>
              <ColLabel>OUTPUT</ColLabel>
              <ColLabel>TOKENS</ColLabel>
              <ColLabel>COST</ColLabel>
              <ColLabel>TIME</ColLabel>
              <ColLabel right>RESULT</ColLabel>
            </div>
            {agent.runs.map((r) => (
              <div
                key={r.ref + r.out}
                className="grid min-w-[820px] grid-cols-[120px_minmax(200px,1fr)_80px_70px_80px_90px] items-center gap-3 border-b border-line-faint px-4 py-2.5"
              >
                <span className="mono text-[11px] text-accent">{r.ref}</span>
                <span className="text-[12px] text-ink-3">{r.out}</span>
                <span className="mono text-[10.5px] text-muted">
                  {r.tokens}
                </span>
                <span className="mono text-[10.5px] text-muted">{r.cost}</span>
                <span className="mono text-[10.5px] text-muted">{r.time}</span>
                <div className="text-right">
                  <Pill c={r.c}>{r.result}</Pill>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
