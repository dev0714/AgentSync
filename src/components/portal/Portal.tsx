"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Overview } from "@/lib/portal-data";
import type { FilterKey } from "@/lib/portal-ui";
import Icon from "@/components/site/Icon";
import Sidebar from "./Sidebar";
import ThemeToggle from "./ThemeToggle";
import { FieldProvider } from "./ui";
import Agents, { type AgentTab } from "./screens/Agents";
import Connections, { type ConnTab } from "./screens/Connections";
import { Project, Sources } from "./screens/Config";
import Usage from "./screens/Usage";
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
  approvals: "Approvals",
  deployments: "Deployments",
  audit: "Audit log",
  project: "Projects",
  sources: "Source systems",
  usage: "Usage and cost",
  connections: "Connections",
  agents: "Agents",
  tenants: "Tenants",
};

/** One plain line under each title: what the screen is for. */
const CRUMBS: Record<Screen, string> = {
  tasks: "Every request, where it is, and what it needs from you",
  detail: "The plan, the changes, the checks and every step on record",
  approvals: "Tasks wait here until a person decides",
  deployments: "Every preview and production release, with the task behind it",
  audit: "Everything that changed, who did it and when",
  project: "Repositories, their description, releases and code map",
  sources: "Systems that send work, and where their clients' requests go",
  usage: "What the agents cost, by project and by agent",
  connections: "The services AgentSync works through",
  agents: "The agents that work every task, and the models they use",
  tenants: "Every organisation on this AgentSync",
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

  // Live: re-read the overview (task list, counts, approvals) in the
  // background without losing where you are — every few seconds while work is
  // in flight, less often when idle, and at once on returning to the tab.
  const busy = data.metrics.in_flight > 0;
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, busy ? 5_000 : 30_000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [busy, router]);

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
      <div className="portal-ui flex h-screen min-h-[720px] overflow-hidden bg-canvas text-ink">
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
          <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-line-soft bg-card px-4 sm:px-6 lg:px-8">
            <button
              onClick={() => setNavOpen(true)}
              aria-label="Open menu"
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-line-soft bg-card text-ink lg:hidden"
            >
              <Icon name="menu" size={18} />
            </button>
            <div className="flex min-w-0 items-baseline gap-2.5">
              <h1 className="m-0 truncate text-[16px] font-semibold tracking-[-0.01em]">
                {TITLES[screen]}
              </h1>
              <span className="hidden truncate text-[13px] text-muted-3 xl:block">
                {CRUMBS[screen]}
              </span>
            </div>
            <div className="flex-1" />
            {/* Blue means an agent is working. */}
            {data.metrics.in_flight > 0 ? (
              <div className="hidden shrink-0 items-center gap-2 rounded-md bg-agent-tint px-2.5 py-1 whitespace-nowrap sm:flex">
                <span className="blink size-2 rounded-full bg-accent" />
                <span className="text-[12.5px] font-medium text-agent-ink">
                  {data.metrics.in_flight} in progress
                </span>
              </div>
            ) : null}
            <ThemeToggle />
          </header>

          <div className="flex-1 overflow-y-auto px-4 pt-6 pb-12 sm:px-6 lg:px-8">
            {notice ? (
              <div
                role="status"
                className={`mb-5 flex items-start gap-3 rounded-[10px] border px-4 py-3 text-[14px] ${
                  notice.ok
                    ? "border-ok-line bg-ok-tint text-ok-ink"
                    : "border-danger-line bg-danger-tint text-danger-ink"
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
                tenantSlug={data.tenant?.slug ?? null}
                onOpen={(id) => openTask(id, "plan")}
              />
            ) : null}
            {screen === "deployments" ? (
              <Deployments
                deployments={data.deployments}
                tenantSlug={data.tenant?.slug ?? null}
                onOpenTask={(id) => openTask(id)}
                onConnect={() => { setConnTab("deploy"); setScreen("connections"); }}
              />
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
              <Usage usage={data.usage} tenantSlug={data.tenant?.slug ?? null} onOpenTask={(id) => openTask(id)} />
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
