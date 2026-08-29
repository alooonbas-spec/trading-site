import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { AppShell } from "@/components/dashboard/app-shell";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const context = await requireWorkspaceContext(workspaceId);

  return <AppShell context={context}>{children}</AppShell>;
}
