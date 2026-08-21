"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/dashboard/error-state";
import { Button } from "@/components/ui/button";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="space-y-4">
      <ErrorState title="Something went wrong" description={error.message} />
      <Button variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
