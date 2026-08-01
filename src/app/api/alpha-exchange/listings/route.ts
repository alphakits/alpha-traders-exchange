import { NextRequest, NextResponse } from "next/server";
import { canPublishListings, createMarketplaceListing, getMarketplaceListings } from "@/lib/alpha-exchange-store";
import { requireApiUser, requirePhoneVerificationForTrading } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { fetchUsdIlsMarketRate, getListingPriceValidationError } from "@/lib/listing-price-validation";
import { isBankTransferPaymentMethod, resolveListingPaymentMethods } from "@/lib/marketplace-payment-methods";
import type { SupportedNetwork } from "@/types/alpha-exchange";

function toNumber(value: unknown) {
  return Number(String(value ?? "").replace(/[^\d.]/g, ""));
}

function isValidNetwork(value: unknown): value is SupportedNetwork {
  return value === "TRC20" || value === "ERC20" || value === "BEP20" || value === "SOL";
}

export async function GET() {
  const listings = await getMarketplaceListings();
  return NextResponse.json({ listings });
}

function isListingCreateProfilingEnabled() {
  return process.env.ALPHA_EXCHANGE_PROFILE_LISTING_CREATE === "1";
}
function createProfileLogger() {
  const startedAt = Date.now();
  return (stage: string) => {
    if (!isListingCreateProfilingEnabled()) return;
    console.log(`[alpha-exchange-profile] listings.route ${stage} +${Date.now() - startedAt}ms`);
  };
}
export async function POST(request: NextRequest) {
  const routeStartedAt = Date.now();
  const logProfile = createProfileLogger();
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  const phoneVerificationRequired = requirePhoneVerificationForTrading(user);
  if (phoneVerificationRequired) return phoneVerificationRequired;
  logProfile("requireApiUser");
  if (!canPublishListings(user)) {
    return NextResponse.json({ error: "You must be approved by Alpha Traders before publishing listings." }, { status: 403 });
  }
  const rate = checkRateLimit({ headers: request.headers, key: "exchange:create-listing", maxRequests: 10, windowMs: 60_000 });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many listing requests. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }

  try {
    const validationStartedAt = Date.now();
    const body = await request.json();
    logProfile("request.json");
    const availableAmount = String(body.availableAmount ?? "").trim();
    const price = String(body.price ?? "").trim();
    const responseTime = String(body.responseTime ?? "").trim().slice(0, 100) || "5 min";
    const currency = String(body.currency ?? "ILS").trim().slice(0, 10) || "ILS";
    const paymentMethods = resolveListingPaymentMethods(body.paymentMethods, body.paymentMethod).slice(0, 1);
    const bankName = String(body.bankName ?? "").trim();
    const minimumTrade = String(body.minimumTrade ?? "0").trim();
    const maximumTrade = String(body.maximumTrade ?? availableAmount).trim();
    const expiresAt = String(body.expiresAt ?? "").trim();
    const expirationHours = body.expirationHours !== undefined ? Number(body.expirationHours) : undefined;
    const notes = String(body.notes ?? "").trim().slice(0, 2000);
    const sellerDescription = String(body.sellerDescription ?? "").trim().slice(0, 2000);
    const photos = Array.isArray(body.photos) ? body.photos.map((photo: unknown) => String(photo).trim()).filter(Boolean).slice(0, 6) : [];
    const acceptedCommissionPolicy = body.acceptedCommissionPolicy === true;
    const network = body.network;

    if (!availableAmount || toNumber(availableAmount) <= 0) {
      return NextResponse.json({ error: "Available amount must be greater than zero." }, { status: 400 });
    }
    if (!price || toNumber(price) <= 0) {
      return NextResponse.json({ error: "Price must be greater than zero." }, { status: 400 });
    }
    const marketRate = await fetchUsdIlsMarketRate();
    logProfile("fetchUsdIlsMarketRate");
    const priceValidationError = getListingPriceValidationError({ price, currency, marketRate });
    if (priceValidationError) {
      return NextResponse.json({ error: priceValidationError }, { status: 400 });
    }
    if (!isValidNetwork(network)) {
      return NextResponse.json({ error: "Invalid network." }, { status: 400 });
    }
    if (!paymentMethods.length) {
      return NextResponse.json({ error: "A valid payment method is required (Bank Transfer, Face-to-Face, or Cardless ATM Withdrawal)." }, { status: 400 });
    }
    if (isBankTransferPaymentMethod(paymentMethods[0]) && !bankName) {
      return NextResponse.json({ error: "Please choose a receiving bank before publishing the listing." }, { status: 400 });
    }
    if (!acceptedCommissionPolicy) {
      return NextResponse.json({ error: "You must confirm Alpha Traders 1% commission policy before publishing this listing." }, { status: 400 });
    }
    if (toNumber(minimumTrade) < 0) {
      return NextResponse.json({ error: "Minimum trade cannot be negative." }, { status: 400 });
    }
    if (toNumber(maximumTrade) <= 0 || toNumber(maximumTrade) > toNumber(availableAmount)) {
      return NextResponse.json({ error: "Maximum trade must be greater than zero and less than or equal to available amount." }, { status: 400 });
    }
    if (toNumber(maximumTrade) < toNumber(minimumTrade)) {
      return NextResponse.json({ error: "Maximum trade must be greater than or equal to minimum trade." }, { status: 400 });
    }
    if (expiresAt) {
      const expiresMs = new Date(expiresAt).getTime();
      if (!expiresMs || Number.isNaN(expiresMs)) {
        return NextResponse.json({ error: "Invalid expiry date." }, { status: 400 });
      }
    }
    const validationMs = Date.now() - validationStartedAt;

    const businessStartedAt = Date.now();
    const listing = await createMarketplaceListing({
      sellerId: user.id,
      sellerDisplayName: user.fullName,
      photos,
      availableAmount,
      price,
      currency,
      network,
      paymentMethods,
      bankName: isBankTransferPaymentMethod(paymentMethods[0]) ? (bankName || undefined) : undefined,
      minimumTrade,
      maximumTrade,
      expiresAt: expiresAt || undefined,
      expirationHours,
      notes,
      sellerDescription,
      responseTime,
      acceptedCommissionPolicy,
      actorUserId: user.id,
    });
    const businessMs = Date.now() - businessStartedAt;
    logProfile("createMarketplaceListing");
    const routeMs = Date.now() - routeStartedAt;
    return NextResponse.json(
      { listing },
      {
        status: 201,
        headers: {
          "X-Trade-Route-Ms": String(routeMs),
          "X-Trade-Validation-Ms": String(validationMs),
          "X-Trade-Logic-Ms": String(businessMs),
          "Server-Timing": `route;dur=${routeMs}, validate;dur=${validationMs}, logic;dur=${businessMs}`,
        },
      },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create listing." }, { status: 400 });
  }
}
