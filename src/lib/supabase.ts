import { createClient } from '@supabase/supabase-js';

/**
 * Supabase access for the control plane.
 *
 * Every query runs against the `agentsync` schema, so the schema must be listed
 * under Project Settings → API → Exposed schemas for the Data API to reach it.
 *
 * Two clients, deliberately:
 *   - browserClient uses the publishable (anon) key. Row-level security decides
 *     what the signed-in user can see; it can read nothing without a session.
 *   - serviceClient uses the service-role key, which bypasses RLS. It is for
 *     trusted server-side workers only and throws if it is ever imported into a
 *     client bundle.
 */

const SCHEMA = 'agentsync';

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export function browserClient() {
  return createClient(
    required(
      'NEXT_PUBLIC_SUPABASE_URL',
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    required(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
    { db: { schema: SCHEMA } },
  );
}

export function serviceClient() {
  if (typeof window !== 'undefined') {
    throw new Error('serviceClient() must never run in the browser');
  }
  return createClient(
    required(
      'NEXT_PUBLIC_SUPABASE_URL',
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    required(
      'SUPABASE_SERVICE_ROLE_KEY',
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
    {
      db: { schema: SCHEMA },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
