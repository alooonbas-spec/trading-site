import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { canManageAccounts } from "@/lib/auth/permissions";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { PermissionError, ValidationError } from "@/lib/errors";
import { getAppOrigin, oauthCallbackPath } from "@/lib/social/app-origin";
import { createOAuthState, createPkcePair } from "@/lib/social/pkce";
import { getSocialAdapter } from "@/social/core/registry";
import { connectSocialAccount, parsePlatform } from "@/services/social-accounts/account-service";
import type { SocialPlatform } from "@/types/social";

export async function startOAuthConnect(input: {
  workspaceId: string;
  platform: SocialPlatform;
}): Promise<string> {
  const context = await requireWorkspaceContext(input.workspaceId);
  if (!canManageAccounts(context.role)) {
    throw new PermissionError("Only owners and admins can connect social accounts");
  }

  const adapter = getSocialAdapter(input.platform);
  if (adapter.connectMode !== "oauth" || !adapter.beginOAuth) {
    throw new ValidationError("This platform does not use OAuth");
  }

  const origin = await getAppOrigin();
  const redirectUri = `${origin}${oauthCallbackPath(input.platform)}`;
  const state = createOAuthState();
  const pkce = createPkcePair();
  const profile = await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.from("oauth_states").insert({
    state,
    workspace_id: input.workspaceId,
    user_id: profile.id,
    platform: input.platform,
    code_verifier: pkce.verifier,
    redirect_uri: redirectUri,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });

  if (error) {
    throw new ValidationError(error.message);
  }

  return adapter.beginOAuth({
    redirectUri,
    state,
    codeChallenge: pkce.challenge,
  });
}

export async function completeOAuthConnect(input: {
  platform: string;
  code: string | null;
  state: string | null;
  deviceId: string | null;
}): Promise<{ workspaceId: string }> {
  const platform = parsePlatform(input.platform);
  if (!input.code || !input.state) {
    throw new ValidationError("OAuth callback is missing code or state");
  }

  const profile = await requireProfile();
  const supabase = await createClient();
  const { data: oauthState, error } = await supabase
    .from("oauth_states")
    .select("state, workspace_id, user_id, platform, code_verifier, redirect_uri, expires_at")
    .eq("state", input.state)
    .maybeSingle();

  if (error || !oauthState) {
    throw new ValidationError("OAuth state is invalid or expired");
  }

  await supabase.from("oauth_states").delete().eq("state", input.state);

  if (oauthState.user_id !== profile.id || oauthState.platform !== platform) {
    throw new ValidationError("OAuth state does not match this user or platform");
  }

  if (new Date(oauthState.expires_at).getTime() <= Date.now()) {
    throw new ValidationError("OAuth state expired. Start the connection again.");
  }

  await connectSocialAccount({
    workspaceId: oauthState.workspace_id,
    platform,
    connectInput: {
      authorizationCode: input.code,
      redirectUri: oauthState.redirect_uri,
      codeVerifier: oauthState.code_verifier,
      deviceId: input.deviceId ?? undefined,
      oauthState: input.state,
    },
    metadata: input.deviceId ? { deviceId: input.deviceId } : {},
  });

  return { workspaceId: oauthState.workspace_id };
}
