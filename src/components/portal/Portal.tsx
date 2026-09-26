"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Overview } from "@/lib/portal-data";
import type { FilterKey } from "@/lib/portal-ui";
import Icon from "@/components/site/Icon";
import Sidebar from "./Sidebar";
import { FieldProvider } from "./ui";
import Agents, { type AgentTab } from "./screens/Agents";
import Connections, { type ConnTab } from "./screens/Connections";
import { Project, Sources, Usage } from "./screens/Config";
import Detail, { type DetailTab } from "./screens/Detail";
import { Approvals, Audit, Deployments } from "./screens/Ops";
import Tasks from "./screens/Tasks";
import Tenants from "./screens/Tenants";

export type Screen =
  | "tasks"
  | "detail"
  | "approvals"
  | "deployments"
  | "audit"
  | "project"
  | "sources"
  | "usage"
  | "connections"
  | "agents"
  | "tenants";

const TITLES: Record<Screen, string> = {
  tasks: "Tasks",
  detail: "Task",
  approvals: "Approvals queue",
  deployments: "Deployments",
  audit: "Audit log",
  project: "Project configuration",
  sources: "Source systems",
  usage: "Usage & cost",
  connections: "Connections",
  agents: "Agents",
  tenants: "Tenants",
};

const CRUMBS: Record<Screen, string> = {
  tasks: "agent_tasks",
  detail: "agent_tasks · task_plans · task_file_changes · task_events",
  approvals: "task_approvals",
  deployments: "deployments",
  audit: "task_events",
  project:
    "projects · project_repositories · project_runtime_configs · project_ai_configs",
  sources: "source_systems",
  usage: "task_ai_usage",
  connections:
    "github_app_installations · deployment_providers · ai_provider_credentials · secret_references",
  agents: "agent_definitions · agent_ai_configs · agent_tools",
  tenants: "tenants · tenant_users",
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
  const [screen, setScreen] = useState<Screen>("tasks");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>("plan");
  const [connTab, setConnTab] = useState<ConnTab>("overview");
  const [agentKey, setAgentKey] = useState<string | null>(null);
  const [agentTab, setAgentTab] = useState<AgentTab>("setup");
  const [setupGroup, setSetupGroup] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectGroup, setProjectGroup] = useState(0);
  const [tenantGroup, setTenantGroup] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  // Coming back from GitHub's App flow lands on /portal?screen=connections&…
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    // Links from a source system (a ticket's note) open the task directly.
    const linked = q.get("task");
    if (linked && /^[0-9a-f-]{36}$/i.test(linked)) {
      setTaskId(linked);
      setScreen("detail");
      q.delete("task");
      const rest = q.toString();
      window.history.replaceState(null, "", `/portal${rest ? `?${rest}` : ""}`);
      return;
    }
    if (q.get("screen") !== "connections") return;
    setScreen("connections");
    setConnTab("github");
    if (q.get("github_connected")) {
      setNotice({
        ok: true,
        text:
          q.get("github_connected") === "updated"
            ? "GitHub installation updated."
            : `GitHub is connected. ${
                Number(q.get("projects")) > 0
                  ? `${q.get("projects")} project${q.get("projects") === "1" ? "" : "s"} created — one per repository you picked.`
                  : "Each repository you picked is a project."
              }`,
      });
    } else if (q.get("github_error")) {
      setNotice({
        ok: false,
        text: q.get("github_error") ?? "GitHub connection failed.",
      });
    }
    q.delete("screen");
    q.delete("github_connected");
    q.delete("github_error");
    q.delete("projects");
    q.delete("disabled");
    const rest = q.toString();
    window.history.replaceState(null, "", `/portal${rest ? `?${rest}` : ""}`);
  }, []);

  const pendingCount = data.approvals.length + data.metrics.needs_information;

  const openTask = (id: string, tab: DetailTab = "plan") => {
    setTaskId(id);
    setDetailTab(tab);
    setScreen("detail");
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
        {/* Below lg the sidebar is a drawer opened from the header. */}
        <div
          className={`${navOpen ? "fixed inset-0 z-40 flex" : "hidden"} lg:static lg:flex`}
        >
          <Sidebar
            screen={screen}
            onNavigate={(s) => {
              setScreen(s);
              setNavOpen(false);
            }}
            tenants={data.tenants}
            currentTenant={data.tenant}
            onTenant={switchTenant}
            pendingCount={pendingCount}
            agentCount={data.agents.length}
            isPlatformAdmin={data.platform_role === "SUPER_ADMIN"}
            user={user}
          />
          {navOpen ? (
            <button
              aria-label="Close menu"
              className="flex-1 cursor-pointer bg-ink/40 lg:hidden"
              onClick={() => setNavOpen(false)}
            />
          ) : null}
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-[64px] shrink-0 items-center gap-3 border-b border-line-soft bg-canvas px-4 sm:px-6 lg:px-8">
            <button
              onClick={() => setNavOpen(true)}
              aria-label="Open menu"
              className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line bg-card text-ink lg:hidden"
            >
              <Icon name="menu" size={18} />
            </button>
            <h1 className="display truncate text-[20px] font-bold tracking-[-0.03em] sm:text-[22px]">
              {TITLES[screen]}
            </h1>
            <div className="mono hidden truncate text-[12px] text-muted-3 xl:block">
              {CRUMBS[screen]}
            </div>
            <div className="flex-1" />
            {/* Blue means an agent is working — the same colour the
                homepage uses for it. */}
            <div className="flex shrink-0 items-center gap-2 rounded-full bg-agent-tint px-3 py-1.5 whitespace-nowrap">
              <span className="blink size-2 rounded-full bg-accent" />
              <span className="text-[13px] font-semibold text-agent-ink">
                {data.metrics.in_flight} in flight
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 pt-6 pb-12 sm:px-6 lg:px-8">
            {notice ? (
              <div
                role="status"
                className={`mb-5 flex items-start gap-3 rounded-[14px] border px-4 py-3 text-[14px] ${
                  notice.ok
                    ? "border-[#BFDFCB] bg-ok-tint text-ok-ink"
                    : "border-[#F0C9C4] bg-danger-tint text-danger-ink"
                }`}
              >
                <span className="flex-1">{notice.text}</span>
                <button
                  className="cursor-pointer text-[13px] font-medium underline"
                  onClick={() => setNotice(null)}
                >
                  Dismiss
                </button>
              </div>
            ) : null}
            {screen === "tasks" ? (
              <Tasks
                tasks={data.tasks}
                approvals={data.approvals}
                metrics={data.metrics}
                filter={filter}
                onFilter={setFilter}
                onOpen={openTask}
              />
            ) : null}
            {screen === "detail" && taskId ? (
              <Detail
                taskId={taskId}
                tab={detailTab}
                onTab={setDetailTab}
                onBack={() => setScreen("tasks")}
              />
            ) : null}
            {screen === "approvals" ? (
              <Approvals
                approvals={data.approvals}
                onOpen={(id) => openTask(id, "plan")}
              />
            ) : null}
            {screen === "deployments" ? (
              <Deployments deployments={data.deployments} />
            ) : null}
            {screen === "audit" ? <Audit audit={data.audit} /> : null}
            {screen === "project" ? (
              <Project
                projects={data.projects}
                tenantSlug={data.tenant?.slug ?? null}
                github={data.connections.github}
                canSubmit={
                  data.platform_role === "SUPER_ADMIN" ||
                  (!!data.role && data.role !== "VIEWER")
                }
                onSubmitted={(id) => {
                  openTask(id);
                  router.refresh();
                }}
                onOpenTask={(id) => openTask(id)}
                onConnect={() => {
                  setScreen("connections");
                  setConnTab("github");
                }}
                selected={projectId}
                onSelect={setProjectId}
                group={projectGroup}
                onGroup={setProjectGroup}
              />
            ) : null}
            {screen === "sources" ? <Sources sources={data.sources} tenantSlug={data.tenant?.slug ?? null} /> : null}
            {screen === "usage" ? (
              <Usage usage={data.usage} projects={data.projects} />
            ) : null}
            {screen === "connections" ? (
              <Connections
                connections={data.connections}
                tenantSlug={data.tenant?.slug ?? null}
                tab={connTab}
                onTab={setConnTab}
              />
            ) : null}
            {screen === "agents" ? (
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
                tenantSlug={data.tenant?.slug ?? null}
              />
            ) : null}
            {screen === "tenants" ? (
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
