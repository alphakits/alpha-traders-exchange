import { NextRequest, NextResponse } from "next/server";
import { sendSellerApprovalEmailByAdmin } from "@/lib/alpha-exchange-store";
import { requireApiAdmin } from "@/lib/api-auth";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";

export async function POST(request: NextRequest, context: { params: Promise<{ applicationId: string }> }) {
  const { user, unauthorized } = await requireApiAdmin();
  if (!user) return unauthorized;
  const { applicationId } = await context.params;
  const limit = await checkSharedRateLimit({
    headers: request.headers,
    key: "admin:seller-approval-email",
    identifier: `${user.id}:${applicationId}`,
    maxRequests: 3,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterSeconds);

  try {
    const result = await sendSellerApprovalEmailByAdmin(applicationId, user.id);
    if (!result.ok) {
      return NextResponse.json({ error: "The approval email could not be sent. The seller is still approved. Please try again later." }, { status: 502 });
    }
    return NextResponse.json({ status: "accepted_for_delivery" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to send approval email." }, { status: 400 });
  }
}
