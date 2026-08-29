export function ErrorState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-6 py-8 text-center">
      <h2 className="text-base font-medium text-destructive">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
