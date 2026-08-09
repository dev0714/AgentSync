import { createClient } from '@supabase/supabase-js';

/**
 * Supabase access for the control plane.
 *
 * The `agentsync` schema is deliberately NOT exposed to the Data API, so
 * PostgREST cannot reach it directly. Everything the app needs goes through the
 * `public.agentsync_*` wrapper functions, which are granted to the service role
 * only. That keeps the REST surface to a handful of named functions instead of
 * every table in the schema.
 *
 * serviceClient() uses the service-role key, which bypasses row-level security.
 * It is for server-side code only and throws if it is ever reached from a
 * browser bundle.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export function serviceClient() {
  if (typeof window !== 'undefined') {
    throw new Error('serviceClient() must never run in the browser');
  }
  return createClient(
    required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
