import { NextRequest, NextResponse } from "next/server";
import { canPublishListings, deleteMarketplaceListingForSeller, renewMarketplaceListing, updateMarketplaceListingForSeller } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { fetchUsdIlsMarketRate, getListingPriceValidationError } from "@/lib/listing-price-validation";
import type { SupportedNetwork } from "@/types/alpha-exchange";

function toNumber(value: unknown) {
  return Number(String(value ?? "").replace(/[^\d.]/g, ""));
}

function isValidNetwork(value: unknown): value is SupportedNetwork {
  return value === "TRC20" || value === "ERC20" || value === "BEP20" || value === "SOL";
}

function isValidListingStatus(value: unknown): value is "active" | "paused" {
  return value === "active" || value === "paused";
}

type RouteContext = {
  params: Promise<{ listingId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  if (!canPublishListings(user)) {
    return NextResponse.json({ error: "You must be approved by Alpha Traders before publishing listings." }, { status: 403 });
  }
  const rate = checkRateLimit({ headers: request.headers, key: "exchange:update-listing", maxRequests: 30, windowMs: 60_000 });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many update requests. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }

  try {
    const { listingId } = await context.params;
    const body = await request.json();
    const action = body.action !== undefined ? String(body.action).trim() : "";
    if (action === "renew") {
      // Validate the existing listing's price against market rate before renewing.
      // A listing that was valid when created may violate the cap if market rate dropped.
      const marketRateForRenew = await fetchUsdIlsMarketRate();
      const { getMarketplaceListings } = await import("@/lib/alpha-exchange-store");
      const allListings = await getMarketplaceListings();
      const targetListing = allListings.find((l) => l.id === listingId);
      if (targetListing) {
        const renewPriceError = getListingPriceValidationError({
          price: targetListing.price,
          currency: targetListing.currency ?? "ILS",
          marketRate: marketRateForRenew,
        });
        if (renewPriceError) {
          return NextResponse.json(
            { error: `Cannot renew: ${renewPriceError}` },
            { status: 400 },
          );
        }
      }
      const listing = await renewMarketplaceListing({
        listingId,
        actorUserId: user.id,
        sellerId: user.id,
        expirationHours: body.expirationHours,
      });
      return NextResponse.json({ listing });
    }
    const availableAmount = body.availableAmount !== undefined ? String(body.availableAmount).trim() : undefined;
    const price = body.price !== undefined ? String(body.price).trim() : undefined;
    const responseTime = body.responseTime !== undefined ? String(body.responseTime).trim() : undefined;
    const currency = body.currency !== undefined ? String(body.currency).trim() : undefined;
    const paymentMethod = body.paymentMethod !== undefined ? String(body.paymentMethod).trim() : undefined;
    const paymentMethods = Array.isArray(body.paymentMethods)
      ? body.paymentMethods.map((method: unknown) => String(method).trim()).filter(Boolean).slice(0, 8)
      : undefined;
    const bankName = body.bankName !== undefined ? String(body.bankName).trim() : undefined;
    const minimumTrade = body.minimumTrade !== undefined ? String(body.minimumTrade).trim() : undefined;
    const maximumTrade = body.maximumTrade !== undefined ? String(body.maximumTrade).trim() : undefined;
    const expiresAt = body.expiresAt !== undefined ? String(body.expiresAt).trim() : undefined;
    const expirationHours = body.expirationHours !== undefined ? Number(body.expirationHours) : undefined;
    const notes = body.notes !== undefined ? String(body.notes).trim() : undefined;
    const sellerDescription = body.sellerDescription !== undefined ? String(body.sellerDescription).trim() : undefined;
    const photos = Array.isArray(body.photos) ? body.photos.map((photo: unknown) => String(photo).trim()).filter(Boolean).slice(0, 6) : undefined;
    const network = body.network;
    const status = body.status;

    if (availableAmount !== undefined && (!availableAmount || toNumber(availableAmount) <= 0)) {
      return NextResponse.json({ error: "Available amount must be greater than zero." }, { status: 400 });
    }
    if (price !== undefined && (!price || toNumber(price) <= 0)) {
      return NextResponse.json({ error: "Price must be greater than zero." }, { status: 400 });
    }
    const marketRate = await fetchUsdIlsMarketRate();
    // Validate the price being set, OR the existing price if being re-activated.
    let effectivePrice = price;
    if (!effectivePrice && status === "active") {
      // Seller is reactivating without changing price — validate the stored price.
      const { getMarketplaceListings } = await import("@/lib/alpha-exchange-store");
      const allListings = await getMarketplaceListings();
      const stored = allListings.find((l) => l.id === listingId);
      if (stored) effectivePrice = stored.price;
    }
    const priceValidationError = getListingPriceValidationError({ price: effectivePrice ?? "", currency: currency ?? "ILS", marketRate });
    if (priceValidationError) {
      return NextResponse.json({ error: priceValidationError }, { status: 400 });
    }
    if (network !== undefined && !isValidNetwork(network)) {
      return NextResponse.json({ error: "Invalid network." }, { status: 400 });
    }
    if (status !== undefined && !isValidListingStatus(status)) {
      return NextResponse.json({ error: "Invalid listing status." }, { status: 400 });
    }
    if (paymentMethods && !paymentMethods.length) {
      return NextResponse.json({ error: "At least one payment method is required." }, { status: 400 });
    }
    if (bankName !== undefined && !bankName) {
      return NextResponse.json({ error: "Please choose a receiving bank before saving the listing." }, { status: 400 });
    }
    if (minimumTrade !== undefined && toNumber(minimumTrade) < 0) {
      return NextResponse.json({ error: "Minimum trade cannot be negative." }, { status: 400 });
    }
    if (maximumTrade !== undefined && toNumber(maximumTrade) <= 0) {
      return NextResponse.json({ error: "Maximum trade must be greater than zero." }, { status: 400 });
    }
    if (minimumTrade !== undefined && maximumTrade !== undefined && toNumber(maximumTrade) < toNumber(minimumTrade)) {
      return NextResponse.json({ error: "Maximum trade must be greater than or equal to minimum trade." }, { status: 400 });
    }
    if (expiresAt !== undefined && expiresAt) {
      const expiresMs = new Date(expiresAt).getTime();
      if (!expiresMs || Number.isNaN(expiresMs)) {
        return NextResponse.json({ error: "Invalid expiry date." }, { status: 400 });
      }
    }

    const listing = await updateMarketplaceListingForSeller({
      listingId,
      sellerId: user.id,
      actorUserId: user.id,
      photos,
      availableAmount,
      price,
      currency,
      network,
      paymentMethod,
      paymentMethods,
      bankName,
      minimumTrade,
      maximumTrade,
      expiresAt,
      expirationHours,
      notes,
      sellerDescription,
      responseTime,
      status,
    });
    return NextResponse.json({ listing });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update listing." }, { status: 400 });
  }
}

export async function DELETE(_: NextRequest, context: RouteContext) {
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  if (!canPublishListings(user)) {
    return NextResponse.json({ error: "You must be approved by Alpha Traders before publishing listings." }, { status: 403 });
  }

  try {
    const { listingId } = await context.params;
    await deleteMarketplaceListingForSeller({
      listingId,
      sellerId: user.id,
      actorUserId: user.id,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete listing." }, { status: 400 });
  }
}
