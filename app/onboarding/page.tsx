import { requireProfile } from "@/lib/auth/session";
import { listMemberships } from "@/lib/auth/workspace-context";
import { CreateWorkspaceForm } from "@/components/workspaces/create-workspace-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const profile = await requireProfile();
  const memberships = await listMemberships(profile.id);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>
            {memberships.length === 0 ? "Create your first workspace" : "Create a workspace"}
          </CardTitle>
          <CardDescription>
            A workspace isolates social accounts, leads, campaigns, and posts. You can belong to
            more than one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateWorkspaceForm />
        </CardContent>
      </Card>
    </div>
  );
}
