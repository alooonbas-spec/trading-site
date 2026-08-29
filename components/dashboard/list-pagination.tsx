import Link from "next/link";

export function ListPagination({
  newestHref,
  olderHref,
}: {
  newestHref: string | null;
  olderHref: string | null;
}) {
  if (!newestHref && !olderHref) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {newestHref ? (
        <Link
          href={newestHref}
          className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm hover:bg-muted"
        >
          Newest
        </Link>
      ) : null}
      {olderHref ? (
        <Link
          href={olderHref}
          className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm hover:bg-muted"
        >
          Older
        </Link>
      ) : null}
    </div>
  );
}
