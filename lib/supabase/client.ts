import { createBrowserClient } from "@supabase/ssr";
import { readPublicEnv } from "@/lib/validation/env";
import type { Database } from "@/types/database";

export function createClient() {
  const env = readPublicEnv();

  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
