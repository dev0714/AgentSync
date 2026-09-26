import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import LoginForm from './LoginForm';

export const metadata: Metadata = {
  title: 'Sign in · AgentSync',
  description: 'Sign in to the AgentSync control plane.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // Already signed in? Go where sign-in was asked for — a path on this site only.
  if (await currentUser()) {
    const { next } = await searchParams;
    redirect(next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/portal');
  }
  return <LoginForm />;
}
