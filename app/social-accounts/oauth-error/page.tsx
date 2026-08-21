import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function OAuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Account connection failed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {params.message ?? "The platform did not complete OAuth."}
          </p>
          <Link href="/" className="text-sm underline-offset-4 hover:underline">
            Back to Social Hub
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
