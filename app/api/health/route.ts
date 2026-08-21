import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/validation/env";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    supabaseConfigured: isSupabaseConfigured(),
  });
}
