import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { ValidationError } from "@/lib/errors";
import { readPublicEnv } from "@/lib/validation/env";
import type { Database } from "@/types/database";

export function createServiceRoleClient() {
  const env = readPublicEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) {
    throw new ValidationError(
      "SUPABASE_SERVICE_ROLE_KEY is not configured. The background worker cannot bypass RLS without it.",
    );
  }

  return createSupabaseClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
