import { NextRequest, NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { updateMarketplacePriceAlert } from "@/lib/alpha-exchange-store";
import { priceAlertSchema, readMarketplacePriceAlert } from "@/lib/marketplace-price-alert";
import { hasTrustedSameOrigin } from "@/lib/request-origin";
import { checkSharedRateLimit, createRateLimitResponse } from "@/lib/rate-limit";

const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
function privateResponse(response: NextResponse) {
  for (const [name, value] of Object.entries(privateHeaders)) response.headers.set(name, value);
  return response;
}

export async function GET() {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return privateResponse(unauthorized);
  return NextResponse.json({ ownerId: user.id, preference: readMarketplacePriceAlert(user.marketplacePriceAlert) }, { headers: privateHeaders });
}

export async function PATCH(request: NextRequest) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return privateResponse(unauthorized);
  if (!hasTrustedSameOrigin(request)) return NextResponse.json({ error: "Untrusted request origin." }, { status: 403, headers: privateHeaders });
  const rate = await checkSharedRateLimit({ headers: request.headers, key: "exchange:price-alerts", identifier: user.id, maxRequests: 12, windowMs: 60_000 });
  if (!rate.allowed) return privateResponse(createRateLimitResponse(rate.retryAfterSeconds));
  let parsed;
  try { parsed = priceAlertSchema.safeParse(await request.json()); } catch { return NextResponse.json({ error: "Invalid price alert." }, { status: 400, headers: privateHeaders }); }
  if (!parsed.success) return NextResponse.json({ error: "Invalid price alert. Choose a positive maximum price and a valid amount." }, { status: 400, headers: privateHeaders });
  try {
    const preference = await updateMarketplacePriceAlert(user.id, parsed.data);
    return NextResponse.json({ ownerId: user.id, preference }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ error: "Could not confirm saved preferences. Refresh before trying again." }, { status: 503, headers: privateHeaders });
  }
}
