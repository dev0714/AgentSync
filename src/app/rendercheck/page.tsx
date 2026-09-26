// TEMPORARY — visual check fixture, removed before commit.
import Portal from '@/components/portal/Portal';
import type { Overview } from '@/lib/portal-data';
export default async function Page({ searchParams }: { searchParams: Promise<{ gh?: string }> }) {
  const { gh } = await searchParams;
  const projects = gh ? [
    { id: '11111111-1111-1111-1111-111111111111', name: 'shop', slug: 'shop', enabled: true, repository: { github_owner: 'dev0714', repository: 'shop', default_branch: 'main' } },
    { id: '22222222-2222-2222-2222-222222222222', name: 'api', slug: 'api', enabled: false, repository: { github_owner: 'dev0714', repository: 'api', default_branch: 'main' } },
  ] : [];
  const data = { platform_role: 'SUPER_ADMIN', role: 'OWNER', tenants: [], tenant: { slug: 'leadsync', name: 'Leadsync' }, members: [], projects, tasks: [],
    metrics: { total: 0, in_flight: 0, awaiting_approval: 0, needs_information: 0, completed_7d: 0, failed_7d: 0, median_minutes: null },
    approvals: [], deployments: [], audit: [], sources: [], agents: [],
    usage: { month_cost: 0, month_input_tokens: 0, month_output_tokens: 0, failover_calls: 0, budget: 0 },
    connections: { github: gh ? { app_slug: 'agentsync-leadsync-zbjd', installation_id: 1 } : null, deployment: null, ai: [], secrets: [], webhooks: [] } } as unknown as Overview;
  return <Portal user={{ name: 'Test User', role: 'OWNER', email: null }} data={data} />;
}
