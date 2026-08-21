import { redirect } from "next/navigation";
import { getLastWorkspaceId, getOptionalUserId } from "@/lib/auth/session";
import { getDefaultWorkspaceId } from "@/lib/auth/workspace-context";
import { isSupabaseConfigured } from "@/lib/validation/env";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!isSupabaseConfigured()) {
    redirect("/auth/login");
  }

  const userId = await getOptionalUserId();
  if (!userId) {
    redirect("/auth/login");
  }

  const workspaceId = await getDefaultWorkspaceId(userId, await getLastWorkspaceId());
  if (!workspaceId) {
    redirect("/onboarding");
  }

  redirect(`/w/${workspaceId}`);
}
