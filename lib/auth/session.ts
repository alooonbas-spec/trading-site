import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthenticationError } from "@/lib/errors";
import { WORKSPACE_COOKIE } from "@/lib/supabase/proxy";
import type { Profile } from "@/types/workspace";

export async function getOptionalUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    return null;
  }

  return data.claims.sub;
}

export async function requireUserId(): Promise<string> {
  const userId = await getOptionalUserId();
  if (!userId) {
    redirect("/auth/login");
  }

  return userId;
}

export async function requireProfile(): Promise<Profile> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/auth/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, display_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    throw new AuthenticationError("Profile is missing for this account");
  }

  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
  };
}

export async function getLastWorkspaceId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(WORKSPACE_COOKIE)?.value ?? null;
}
