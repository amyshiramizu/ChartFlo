import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Backend selector for the AWS migration. When VITE_BACKEND=aws, the same
// supabase-js client talks to the AWS stack instead of Supabase:
//   /auth/v1/*  -> Cognito via the chartflo-auth Lambda (GoTrue-compatible)
//   /rest/v1/*  -> PostgREST on App Runner against Aurora
// Everything else in the app is unchanged — same queries, same sessions.
const USE_AWS = import.meta.env.VITE_BACKEND === 'aws';

const URL = USE_AWS
  ? (import.meta.env.VITE_AWS_API_URL || 'https://z7e0ilsrfa.execute-api.us-east-2.amazonaws.com')
  : import.meta.env.VITE_SUPABASE_URL;

// PostgREST/the auth shim don't require an apikey; supabase-js does. Any
// non-empty string satisfies the client on the AWS path.
const KEY = USE_AWS ? 'aws' : import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient<Database>(URL, KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
