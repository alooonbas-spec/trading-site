import { EmptyState } from "@/components/dashboard/empty-state";

export function ModulePage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <EmptyState title={`No ${title.toLowerCase()} yet`} description={description} />
    </div>
  );
}
