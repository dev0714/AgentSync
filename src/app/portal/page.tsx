import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Portal from '@/components/portal/Portal';
import { currentUser } from '@/lib/auth';
import { loadOverview } from '@/lib/portal-data';

export const metadata: Metadata = {
  title: 'AgentSync · Control plane',
  description:
    'Tasks, approvals, deployments, agents, tenants and the append-only audit log.',
};

// Every screen reads live rows, so nothing here may be cached between requests.
export const dynamic = 'force-dynamic';

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string }>;
}) {
  // Middleware has already checked the signature; this checks the account is
  // still active and loads the roles the screens gate on.
  const user = await currentUser();
  if (!user) redirect('/login');

  const { tenant } = await searchParams;
  const data = await loadOverview(user.id, tenant ?? null);
  if (!data) redirect('/login');

  return (
    <Portal
      user={{
        name: user.display_name,
        role: user.role,
        email: user.email,
      }}
      data={data}
    />
  );
}
