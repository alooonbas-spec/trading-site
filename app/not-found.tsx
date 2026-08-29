import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">This route does not exist or you cannot access it.</p>
      <Link href="/" className="text-sm underline-offset-4 hover:underline">
        Go home
      </Link>
    </div>
  );
}
