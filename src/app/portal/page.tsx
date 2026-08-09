import type { Metadata } from 'next';
import Portal from '@/components/portal/Portal';

export const metadata: Metadata = {
  title: 'AgentSync · Control plane',
  description:
    'Tasks, approvals, deployments, agents, tenants and the append-only audit log.',
};

export default function PortalPage() {
  return <Portal />;
}
