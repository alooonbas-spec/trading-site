import { LoginForm } from "@/components/auth/login-form";
import { isSupabaseConfigured } from "@/lib/validation/env";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const redirectTo =
    params.next && params.next.startsWith("/") && !params.next.startsWith("//")
      ? params.next
      : "/";

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in to Social Hub</CardTitle>
          <CardDescription>One workspace for every connected social account.</CardDescription>
        </CardHeader>
        <CardContent>
          {isSupabaseConfigured() ? (
            <LoginForm redirectTo={redirectTo} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and
              NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
