import { NextRequest, NextResponse } from "next/server";
import { requireApiSellerWorkspaceActor } from "@/lib/api-auth";
import { submitSellerCommissionWalletPayment } from "@/lib/alpha-exchange-store";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiSellerWorkspaceActor();
  if (!user) return unauthorized;

  const rate = checkRateLimit({
    headers: request.headers,
    key: "exchange:commission-pay",
    maxRequests: 20,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many payment attempts. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }

  try {
    const body = await request.json();
    const commissionId = String(body.commissionId ?? "").trim();
    const paymentSignature = String(body.paymentSignature ?? "").trim();
    const network = String(body.network ?? "TRC20").trim();
    // payerWalletAddress is optional — auto-extracted from tx hash during verification
    const payerWalletAddress = String(body.payerWalletAddress ?? "").trim();
    if (!commissionId) {
      return NextResponse.json({ error: "Commission ID is required." }, { status: 400 });
    }
    if (!paymentSignature) {
      return NextResponse.json({ error: "Transaction hash is required." }, { status: 400 });
    }

    const result = await submitSellerCommissionWalletPayment({
      sellerUserId: user.id,
      commissionId,
      network,
      payerWalletAddress,
      paymentSignature,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to submit commission payment." }, { status: 400 });
  }
}
