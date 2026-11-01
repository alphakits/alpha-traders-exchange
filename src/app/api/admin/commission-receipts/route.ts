import { NextRequest, NextResponse } from "next/server";
import { requireApiOwner } from "@/lib/api-auth";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { readOwnerCommissionReceipts } from "@/lib/commission-receipt-review";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" };
export async function GET(request: NextRequest) {
  const { user, unauthorized } = await requireApiOwner();
  if (!user) return unauthorized;
  const rate = await checkSharedRateLimit({ headers: request.headers, key: `exchange:receipt-read:${user.id}`,
    maxRequests: 6, windowMs: 60_000 });
  if (!rate.allowed) return NextResponse.json({ error: "Please wait before checking receipts again." }, {
    status: 429, headers: { ...headers, "Retry-After": String(rate.retryAfterSeconds) },
  });
  try { return NextResponse.json(await readOwnerCommissionReceipts(), { headers }); }
  catch { return NextResponse.json({ error: "Receipt history is temporarily unavailable. No payment was changed." }, { status: 503, headers }); }
}
