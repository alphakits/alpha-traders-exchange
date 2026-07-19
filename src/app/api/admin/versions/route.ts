import { NextRequest, NextResponse } from "next/server";
import { resolveAdminIdentity } from "@/lib/admin-auth";
import { readVersions } from "@/lib/admin-store";

export async function GET(request: NextRequest) {
  try {
    await resolveAdminIdentity(request);
    const versions = await readVersions();
    return NextResponse.json({ versions });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load versions." }, { status: 401 });
  }
}
