'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Overview } from '@/lib/portal-data';
import type { FilterKey } from '@/lib/portal-ui';
import Sidebar from './Sidebar';
import { FieldProvider } from './ui';
import Agents, { type AgentTab } from './screens/Agents';
import Connections, { type ConnTab } from './screens/Connections';
import { Project, Sources, Usage } from './screens/Config';
import Detail, { type DetailTab } from './screens/Detail';
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
  detail: 'Task',
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
  tasks: 'agent_tasks',
  detail: 'agent_tasks · task_plans · task_file_changes · task_events',
  approvals: 'task_approvals',
  deployments: 'deployments',
  audit: 'task_events',
  project:
    'projects · project_repositories · project_runtime_configs · project_ai_configs',
  sources: 'source_systems',
  usage: 'task_ai_usage',
  connections:
    'github_app_installations · deployment_providers · ai_provider_credentials · secret_references',
  agents: 'agent_definitions · agent_ai_configs · agent_tools',
  tenants: 'tenants · tenant_users',
};

export type PortalUser = {
  name: string;
  role: string;
  email: string | null;
};

export default function Portal({
  user,
  data,
}: {
  user: PortalUser;
  data: Overview;
}) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>('tasks');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('plan');
  const [connTab, setConnTab] = useState<ConnTab>('overview');
  const [agentKey, setAgentKey] = useState<string | null>(null);
  const [agentTab, setAgentTab] = useState<AgentTab>('setup');
  const [setupGroup, setSetupGroup] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectGroup, setProjectGroup] = useState(0);
  const [tenantGroup, setTenantGroup] = useState(0);

  const pendingCount = data.approvals.length + data.metrics.needs_information;

  const openTask = (id: string, tab: DetailTab = 'plan') => {
    setTaskId(id);
    setDetailTab(tab);
    setScreen('detail');
  };

  // The overview is fetched per tenant on the server, so switching tenants is a
  // navigation rather than client state — that keeps one source of truth for
  // which tenant's rows are on screen.
  const switchTenant = (slug: string) => {
    router.push(`/portal?tenant=${encodeURIComponent(slug)}`);
  };

  return (
    <FieldProvider>
      <div className="flex h-screen min-h-[720px] overflow-hidden bg-canvas text-ink">
        <Sidebar
          screen={screen}
          onNavigate={setScreen}
          tenants={data.tenants}
          currentTenant={data.tenant}
          onTenant={switchTenant}
          pendingCount={pendingCount}
          agentCount={data.agents.length}
          isPlatformAdmin={data.platform_role === 'SUPER_ADMIN'}
          user={user}
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
            <div
              className="flex items-center gap-1.5 rounded-[7px] border px-[11px] py-[5px]"
              style={{ background: '#101E22', borderColor: '#1B3438' }}
            >
              <span className="ags-pulse size-1.5 rounded-full bg-ok-bright" />
              <span
                className="mono font-medium text-accent"
                style={{ fontSize: 10.5 }}
              >
                {data.metrics.in_flight} IN FLIGHT
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pt-6 pb-10">
            {screen === 'tasks' ? (
              <Tasks
                tasks={data.tasks}
                metrics={data.metrics}
                filter={filter}
                onFilter={setFilter}
                onOpen={openTask}
              />
            ) : null}
            {screen === 'detail' && taskId ? (
              <Detail
                taskId={taskId}
                tab={detailTab}
                onTab={setDetailTab}
                onBack={() => setScreen('tasks')}
              />
            ) : null}
            {screen === 'approvals' ? (
              <Approvals
                approvals={data.approvals}
                onOpen={(id) => openTask(id, 'plan')}
              />
            ) : null}
            {screen === 'deployments' ? (
              <Deployments deployments={data.deployments} />
            ) : null}
            {screen === 'audit' ? <Audit audit={data.audit} /> : null}
            {screen === 'project' ? (
              <Project
                projects={data.projects}
                selected={projectId}
                onSelect={setProjectId}
                group={projectGroup}
                onGroup={setProjectGroup}
              />
            ) : null}
            {screen === 'sources' ? <Sources sources={data.sources} /> : null}
            {screen === 'usage' ? (
              <Usage usage={data.usage} projects={data.projects} />
            ) : null}
            {screen === 'connections' ? (
              <Connections
                connections={data.connections}
                tenantSlug={data.tenant?.slug ?? null}
                tab={connTab}
                onTab={setConnTab}
              />
            ) : null}
            {screen === 'agents' ? (
              <Agents
                agents={data.agents}
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
                tenants={data.tenants}
                tenant={data.tenant}
                members={data.members}
                onSelect={switchTenant}
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
