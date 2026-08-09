'use client';

import { useState } from 'react';
import type { AgentTab } from '@/data/agents';
import {
  TASKS,
  type ConnTab,
  type DetailTab,
  type FilterKey,
} from '@/data/portal';
import Sidebar from './Sidebar';
import { FieldProvider } from './ui';
import Agents from './screens/Agents';
import Connections from './screens/Connections';
import { Project, Sources, Usage } from './screens/Config';
import Detail from './screens/Detail';
import { Approvals, Audit, Deployments } from './screens/Ops';
import Tasks from './screens/Tasks';
import Tenants from './screens/Tenants';

export type Screen =
  | 'tasks'
  | 'detail'
  | 'approvals'
  | 'deployments'
  | 'audit'
  | 'project'
  | 'sources'
  | 'usage'
  | 'connections'
  | 'agents'
  | 'tenants';

const TITLES: Record<Screen, string> = {
  tasks: 'Tasks',
  detail: 'TICKET-1045',
  approvals: 'Approvals queue',
  deployments: 'Deployments',
  audit: 'Audit log',
  project: 'Project configuration',
  sources: 'Source systems',
  usage: 'Usage & cost',
  connections: 'Connections',
  agents: 'Agents',
  tenants: 'Tenants',
};

const CRUMBS: Record<Screen, string> = {
  tasks: 'northwind · all projects',
  detail: 'northwind / customer-portal',
  approvals: '4 gates open',
  deployments: 'vercel · git integration',
  audit: 'task_events',
  project:
    'projects · project_repositories · project_runtime_configs · project_ai_configs',
  sources: 'source_systems',
  usage: 'august 2026',
  connections: 'github · vercel · supabase · anthropic · openai · secrets',
  agents: 'agent_definitions · agent_ai_configs · agent_templates',
  tenants: 'tenants · tenant_users · rls policies',
};

export default function Portal() {
  const [screen, setScreen] = useState<Screen>('tasks');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [detailTab, setDetailTab] = useState<DetailTab>('plan');
  const [tenant, setTenant] = useState('Northwind Group');
  const [connTab, setConnTab] = useState<ConnTab>('overview');
  const [agentKey, setAgentKey] = useState('engineer');
  const [agentTab, setAgentTab] = useState<AgentTab>('setup');
  const [setupGroup, setSetupGroup] = useState(0);
  const [projectGroup, setProjectGroup] = useState(0);
  const [tenantSel, setTenantSel] = useState('northwind');
  const [tenantGroup, setTenantGroup] = useState(0);

  const pendingCount = TASKS.filter((t) =>
    t.status.startsWith('awaiting'),
  ).length;

  const openDetail = (tab: DetailTab) => {
    setDetailTab(tab);
    setScreen('detail');
  };

  return (
    <FieldProvider>
      <div className="flex h-screen min-h-[720px] overflow-hidden bg-canvas text-ink">
        <Sidebar
          screen={screen}
          onNavigate={setScreen}
          tenant={tenant}
          onTenant={setTenant}
          pendingCount={pendingCount}
        />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-[54px] shrink-0 items-center gap-3.5 border-b border-line bg-card px-6">
            <div className="text-sm font-semibold tracking-[-0.01em]">
              {TITLES[screen]}
            </div>
            <div className="mono hidden truncate text-[11px] text-muted-2 lg:block">
              {CRUMBS[screen]}
            </div>
            <div className="flex-1" />
            <div className="hidden w-[230px] items-center gap-[7px] rounded-[7px] border border-line bg-card px-2.5 py-[5px] lg:flex">
              <span className="text-xs text-muted-4">⌕</span>
              <span className="text-xs text-muted-4">
                Search tasks, refs, branches
              </span>
            </div>
            <div
              className="flex items-center gap-1.5 rounded-[7px] border px-[11px] py-[5px]"
              style={{ background: '#101E22', borderColor: '#1B3438' }}
            >
              <span className="ags-pulse size-1.5 rounded-full bg-ok-bright" />
              <span
                className="mono font-medium text-accent"
                style={{ fontSize: 10.5 }}
              >
                4 WORKERS LIVE
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pt-6 pb-10">
            {screen === 'tasks' ? (
              <Tasks
                filter={filter}
                onFilter={setFilter}
                onOpen={() => openDetail('plan')}
              />
            ) : null}
            {screen === 'detail' ? (
              <Detail
                tab={detailTab}
                onTab={setDetailTab}
                onBack={() => setScreen('tasks')}
              />
            ) : null}
            {screen === 'approvals' ? <Approvals onOpen={openDetail} /> : null}
            {screen === 'deployments' ? <Deployments /> : null}
            {screen === 'audit' ? <Audit /> : null}
            {screen === 'project' ? (
              <Project group={projectGroup} onGroup={setProjectGroup} />
            ) : null}
            {screen === 'sources' ? <Sources /> : null}
            {screen === 'usage' ? <Usage /> : null}
            {screen === 'connections' ? (
              <Connections tab={connTab} onTab={setConnTab} />
            ) : null}
            {screen === 'agents' ? (
              <Agents
                agentKey={agentKey}
                onAgent={(k) => {
                  setAgentKey(k);
                  setSetupGroup(0);
                }}
                tab={agentTab}
                onTab={setAgentTab}
                setupGroup={setupGroup}
                onSetupGroup={setSetupGroup}
              />
            ) : null}
            {screen === 'tenants' ? (
              <Tenants
                selected={tenantSel}
                onSelect={setTenantSel}
                group={tenantGroup}
                onGroup={setTenantGroup}
              />
            ) : null}
          </div>
        </div>
      </div>
    </FieldProvider>
  );
}
