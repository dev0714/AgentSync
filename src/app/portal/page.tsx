import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Portal from '@/components/portal/Portal';
import { currentUser } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'AgentSync · Control plane',
  description:
    'Tasks, approvals, deployments, agents, tenants and the append-only audit log.',
};

export default async function PortalPage() {
  // Middleware has already checked the signature; this checks the account is
  // still active and loads the roles the screens gate on.
  const user = await currentUser();
  if (!user) redirect('/login');

  return (
    <Portal
      user={{
        name: user.display_name,
        role: user.role,
        email: user.email,
        tenants: user.memberships.map((m) => ({
          name: m.name,
          slug: m.slug,
        })),
      }}
    />
  );
}
