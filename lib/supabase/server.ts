import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readPublicEnv } from "@/lib/validation/env";
import { isWorkerRuntime } from "@/lib/supabase/runtime";
import { createServiceRoleClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

export async function createClient() {
  if (isWorkerRuntime()) {
    return createServiceRoleClient();
  }

  const env = readPublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component. Proxy refreshes the session.
          }
        },
      },
    },
  );
}
