import { NextRequest, NextResponse } from "next/server";
import { createPurchaseRequest, getMyPurchaseRequests } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";
import { hasRole } from "@/lib/roles";
import { checkRateLimit } from "@/lib/rate-limit";

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const requests = await getMyPurchaseRequests(user.id, user.role);
  return NextResponse.json({ requests });
}

export async function POST(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  if (!hasRole(user, "buyer") && !hasRole(user, "approved_seller") && !hasRole(user, "admin")) {
    return NextResponse.json({ error: "Buyer verification required." }, { status: 403 });
  }
  const rate = checkRateLimit({
    headers: request.headers,
    key: "exchange:purchase-request-create",
    maxRequests: 20,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }
  try {
    const body = await request.json();
    const listingId = String(body.listingId ?? "").trim();
    if (!listingId) {
      return NextResponse.json({ error: "Listing ID is required." }, { status: 400 });
    }

    const buyerName = String(body.buyerName ?? user.fullName).trim();
    const buyerWhatsapp = String(body.buyerWhatsapp ?? user.whatsappNumber).trim();
    if (!buyerName) {
      return NextResponse.json({ error: "Buyer name is required." }, { status: 400 });
    }
    if (!buyerWhatsapp) {
      return NextResponse.json({ error: "Buyer WhatsApp is required." }, { status: 400 });
    }

    const buyerNotes = String(body.buyerNotes ?? "").slice(0, 2000);
    const usdtAmount = String(body.usdtAmount ?? "").trim();
    if (!usdtAmount) {
      return NextResponse.json({ error: "Trade amount is required." }, { status: 400 });
    }

    const purchase = await createPurchaseRequest({
      buyerId: user.id,
      listingId,
      usdtAmount,
      buyerName,
      buyerWhatsapp,
      buyerNotes,
      actorUserId: user.id,
    });

    return NextResponse.json({ purchase }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to submit purchase request." }, { status: 400 });
  }
}
