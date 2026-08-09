import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import LoginForm from './LoginForm';

export const metadata: Metadata = {
  title: 'Sign in · AgentSync',
  description: 'Sign in to the AgentSync control plane.',
};

export default async function LoginPage() {
  // Already signed in? Nothing to do here.
  if (await currentUser()) redirect('/portal');
  return <LoginForm />;
}
