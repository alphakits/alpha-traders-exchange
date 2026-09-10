import { NextRequest, NextResponse } from "next/server";
import { requireApiSellerWorkspaceActor } from "@/lib/api-auth";
import { submitSellerCommissionWalletPayment } from "@/lib/alpha-exchange-store";
import { checkSharedRateLimit } from "@/lib/rate-limit";

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const TRON_TX_ID_PATTERN = /^(?:0x)?[A-Fa-f0-9]{64}$/;

export async function POST(request: NextRequest) {
  const routeStartedAt = Date.now();
  const { user, unauthorized } = await requireApiSellerWorkspaceActor();
  if (!user) return unauthorized;

  const rate = await checkSharedRateLimit({
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
    const network = String(body.network ?? "").trim().toUpperCase();
    // payerWalletAddress is optional — auto-extracted from tx hash during verification
    const payerWalletAddress = String(body.payerWalletAddress ?? "").trim();
    if (!RESOURCE_ID_PATTERN.test(commissionId)) {
      return NextResponse.json({ error: "A valid commission ID is required." }, { status: 400 });
    }
    if (!network) {
      return NextResponse.json({ error: "Commission payment network is required." }, { status: 400 });
    }
    if (network !== "TRC20") {
      return NextResponse.json({ error: "Commission payments must use USDT on TRON (TRC20)." }, { status: 400 });
    }
    if (!TRON_TX_ID_PATTERN.test(paymentSignature)) {
      return NextResponse.json({ error: "Paste the full 64-character TRON TxID from the USDT withdrawal." }, { status: 400 });
    }
    if (payerWalletAddress.length > 128) {
      return NextResponse.json({ error: "Payer wallet address is too long." }, { status: 400 });
    }

    const result = await submitSellerCommissionWalletPayment({
      sellerUserId: user.id,
      commissionId,
      network,
      payerWalletAddress,
      paymentSignature,
    });
    const routeMs = Date.now() - routeStartedAt;
    const queueMs = Math.max(0, routeMs - result.metrics.totalMs);
    return NextResponse.json(result, {
      headers: {
        "X-Trade-Route-Ms": String(routeMs),
        "X-Trade-Queue-Ms": String(queueMs),
        "X-Trade-Db-Ms": String(result.metrics.totalMs),
        "X-Trade-Read-Ms": String(result.metrics.readDbMs),
        "X-Trade-Validation-Ms": String(result.metrics.validationMs),
        "X-Trade-Verify-Ms": String(result.metrics.verificationMs),
        "X-Trade-Logic-Ms": String(result.metrics.businessMs),
        "X-Trade-Write-Ms": String(result.metrics.writeDbMs),
        "Server-Timing": `route;dur=${routeMs}, queue;dur=${queueMs}, db;dur=${result.metrics.totalMs}, read;dur=${result.metrics.readDbMs}, validate;dur=${result.metrics.validationMs}, verify;dur=${result.metrics.verificationMs}, logic;dur=${result.metrics.businessMs}, write;dur=${result.metrics.writeDbMs}`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to submit commission payment." }, { status: 400 });
  }
}
