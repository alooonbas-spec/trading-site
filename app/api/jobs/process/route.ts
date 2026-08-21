import { NextResponse } from "next/server";
import { AuthenticationError, errorMessage, isAppError } from "@/lib/errors";
import { authorizeWorkerRequest } from "@/lib/jobs/worker-auth";
import { processDueJobs } from "@/services/jobs/worker-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request): Promise<NextResponse> {
  try {
    authorizeWorkerRequest(request);
    const url = new URL(request.url);
    const rawLimit = url.searchParams.get("limit");
    const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : 20;
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 20;
    const result = await processDueJobs({ limit });
    return NextResponse.json({
      claimed: result.claimed,
      processed: result.processed,
    });
  } catch (caught) {
    const status = isAppError(caught) ? caught.status : 500;
    return NextResponse.json(
      { error: errorMessage(caught, "Unable to process jobs") },
      { status: caught instanceof AuthenticationError ? 401 : status },
    );
  }
}

export function GET(request: Request) {
  return handle(request);
}

export function POST(request: Request) {
  return handle(request);
}
