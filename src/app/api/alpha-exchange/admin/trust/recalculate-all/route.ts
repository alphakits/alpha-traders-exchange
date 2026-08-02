import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/lib/api-auth";

export async function POST() {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;

  return NextResponse.json({ success: true, message: "Trust score recalculation is not yet implemented." });
}
