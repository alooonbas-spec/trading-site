import { SignupForm } from "@/components/auth/signup-form";
import { isSupabaseConfigured } from "@/lib/validation/env";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>Start with a workspace, then connect social accounts.</CardDescription>
        </CardHeader>
        <CardContent>
          {isSupabaseConfigured() ? (
            <SignupForm />
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
