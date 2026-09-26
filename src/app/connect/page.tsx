import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { safeReturnUrl } from '@/lib/source-connect';
import { serviceClient } from '@/lib/supabase';
import ConnectConsent from './ConnectConsent';

export const metadata: Metadata = {
  title: 'Connect a source · AgentSync',
  description: 'Let a service desk send work to AgentSync.',
};
export const dynamic = 'force-dynamic';

type Params = { app?: string; account?: string; return_url?: string; state?: string; challenge?: string };

/**
 * /connect — the one-click connection a source system (LeadSync) sends its
 * admin to. Sign in if needed, pick the tenant, approve; the browser goes back
 * to the source with a one-time code.
 */
export default async function ConnectPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const user = await currentUser();
  if (!user) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => typeof v === 'string') as [string, string][]);
    redirect(`/login?next=${encodeURIComponent(`/connect?${qs.toString()}`)}`);
  }

  const returnUrl = safeReturnUrl(params.return_url);
  const valid = Boolean(
    params.app && returnUrl && params.state && /^[A-Za-z0-9_-]{43}$/.test(params.challenge ?? ''),
  );

  const { data } = await serviceClient().rpc('agentsync_configurable_tenants', { p_user_id: user.id });
  const tenants = (data as { slug: string; name: string }[] | null) ?? [];

  return (
    <ConnectConsent
      valid={valid}
      app={(params.app ?? '').slice(0, 40)}
      account={(params.account ?? '').slice(0, 70)}
      returnUrl={returnUrl?.toString() ?? ''}
      returnHost={returnUrl?.host ?? ''}
      state={params.state ?? ''}
      challenge={params.challenge ?? ''}
      tenants={tenants}
      userEmail={user.email ?? ""}
    />
  );
}
