import Link from "next/link";
import { EmptyState } from "@/components/dashboard/empty-state";

export default function WorkspaceNotFound() {
  return (
    <div className="space-y-4">
      <EmptyState
        title="Workspace not found"
        description="This workspace does not exist or you are not a member of it."
      />
      <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        Back to Social Hub
      </Link>
    </div>
  );
}
