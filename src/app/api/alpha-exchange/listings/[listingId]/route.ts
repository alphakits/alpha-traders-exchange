import { NextRequest, NextResponse } from "next/server";
import { canPublishListings, deleteMarketplaceListingForSeller, getMarketplaceListingById, renewMarketplaceListing, updateMarketplaceListingForSeller } from "@/lib/alpha-exchange-store";
import { requireApiUser } from "@/lib/api-auth";
import { MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS, parseIsraeliBankSelection, serializeIsraeliBankSelection } from "@/lib/israeli-banks";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { fetchUsdIlsMarketRate, getListingPriceValidationError } from "@/lib/listing-price-validation";
import { MAX_LISTING_PAYMENT_METHODS, requiresIsraeliBankSelection, resolveListingPaymentMethods } from "@/lib/marketplace-payment-methods";
import { listingEditRequiresReason, validateListingChangeReason } from "@/lib/listing-change-reasons";
import type { SupportedNetwork } from "@/types/alpha-exchange";
import { sellerListingWorkspaceDestination } from "@/lib/action-destinations";

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
  const routeStartedAt = Date.now();
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  if (!canPublishListings(user)) {
    return NextResponse.json({ error: "You must be approved by Alpha Traders before publishing listings." }, { status: 403 });
  }
  const rate = await checkSharedRateLimit({ headers: request.headers, key: "exchange:update-listing", maxRequests: 30, windowMs: 60_000 });
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many update requests. Please try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }

  try {
    const { listingId } = await context.params;
    const validationStartedAt = Date.now();
    const existingListing = await getMarketplaceListingById(listingId);
    const body = await request.json();
    const action = body.action !== undefined ? String(body.action).trim() : "";
    if (action === "renew") {
      // Validate the existing listing's price against market rate before renewing.
      // A listing that was valid when created may violate the cap if market rate dropped.
      const marketRateForRenew = await fetchUsdIlsMarketRate();
      if (existingListing) {
        const renewPriceError = getListingPriceValidationError({
          price: existingListing.price,
          currency: existingListing.currency ?? "ILS",
          marketRate: marketRateForRenew,
        });
        if (renewPriceError) {
          return NextResponse.json(
            { error: `Cannot renew: ${renewPriceError}` },
            { status: 400 },
          );
        }
      }
      const validationMs = Date.now() - validationStartedAt;
      const logicStartedAt = Date.now();
      const listing = await renewMarketplaceListing({
        listingId,
        actorUserId: user.id,
        sellerId: user.id,
        expirationHours: body.expirationHours,
      });
      const logicMs = Date.now() - logicStartedAt;
      const routeMs = Date.now() - routeStartedAt;
      return NextResponse.json({ listing }, {
        headers: {
          "X-Trade-Route-Ms": String(routeMs),
          "X-Trade-Validation-Ms": String(validationMs),
          "X-Trade-Logic-Ms": String(logicMs),
          "Server-Timing": `route;dur=${routeMs}, validate;dur=${validationMs}, logic;dur=${logicMs}`,
        },
      });
    }
    const availableAmount = body.availableAmount !== undefined ? String(body.availableAmount).trim() : undefined;
    const price = body.price !== undefined ? String(body.price).trim() : undefined;
    const responseTime = body.responseTime !== undefined ? String(body.responseTime).trim() : undefined;
    const currency = body.currency !== undefined ? String(body.currency).trim() : undefined;
    const resolvedPaymentMethods = body.paymentMethods !== undefined || body.paymentMethod !== undefined
      ? resolveListingPaymentMethods(body.paymentMethods, body.paymentMethod)
      : undefined;
    const paymentMethods = resolvedPaymentMethods?.slice(0, MAX_LISTING_PAYMENT_METHODS);
    const paymentMethod = paymentMethods?.[0];
    const bankAccountId = body.bankAccountId !== undefined ? String(body.bankAccountId).trim() : undefined;
    const bankSelection = body.bankName !== undefined ? parseIsraeliBankSelection(String(body.bankName ?? "")) : undefined;
    const minimumTrade = body.minimumTrade !== undefined ? String(body.minimumTrade).trim() : undefined;
    const maximumTrade = body.maximumTrade !== undefined ? String(body.maximumTrade).trim() : undefined;
    const expiresAt = body.expiresAt !== undefined ? String(body.expiresAt).trim() : undefined;
    const expirationHours = body.expirationHours !== undefined ? Number(body.expirationHours) : undefined;
    const notes = body.notes !== undefined ? String(body.notes).trim() : undefined;
    const sellerDescription = body.sellerDescription !== undefined ? String(body.sellerDescription).trim() : undefined;
    const photos = Array.isArray(body.photos) ? body.photos.map((photo: unknown) => String(photo).trim()).filter(Boolean).slice(0, 6) : undefined;
    const network = body.network;
    const status = body.status;
    const effectiveAvailableAmount = availableAmount ?? existingListing?.availableAmount;
    const effectiveMinimumTrade = minimumTrade ?? existingListing?.minimumTrade ?? "0";
    const effectiveMaximumTrade = maximumTrade ?? existingListing?.maximumTrade ?? effectiveAvailableAmount;

    if (availableAmount !== undefined && (!availableAmount || toNumber(availableAmount) <= 0)) {
      return NextResponse.json({ error: "Available amount must be greater than zero." }, { status: 400 });
    }
    if (price !== undefined && (!price || toNumber(price) <= 0)) {
      return NextResponse.json({ error: "Price must be greater than zero." }, { status: 400 });
    }
    const marketRate = await fetchUsdIlsMarketRate();
    const effectiveCurrency = (currency ?? existingListing?.currency ?? "ILS").trim().toUpperCase();
    const shouldValidateStoredPrice = status === "active" || currency !== undefined;
    const effectivePrice = price ?? (shouldValidateStoredPrice ? existingListing?.price : undefined) ?? "";
    const priceValidationError = getListingPriceValidationError({ price: effectivePrice, currency: effectiveCurrency, marketRate });
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
      return NextResponse.json({ error: "A valid payment method is required (Bank Transfer, Face-to-Face, or Cardless ATM Withdrawal)." }, { status: 400 });
    }
    if (resolvedPaymentMethods && resolvedPaymentMethods.length > MAX_LISTING_PAYMENT_METHODS) {
      return NextResponse.json({ error: `Select no more than ${MAX_LISTING_PAYMENT_METHODS} payment methods per listing.` }, { status: 400 });
    }
    const effectivePaymentMethod = paymentMethod ?? existingListing?.paymentMethod;
    const effectivePaymentMethods = paymentMethods?.length
      ? paymentMethods
      : resolveListingPaymentMethods(existingListing?.paymentMethods, effectivePaymentMethod);
    if (requiresIsraeliBankSelection(effectivePaymentMethods, effectivePaymentMethod)) {
      const effectiveBanks = bankSelection ?? parseIsraeliBankSelection(existingListing?.bankName);
      if (!effectiveBanks.length) {
        return NextResponse.json({ error: "Please choose one or two supported banks before saving the listing." }, { status: 400 });
      }
      if (effectiveBanks.length > MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS) {
        return NextResponse.json({ error: `Select no more than ${MAX_SUPPORTED_ISRAELI_BANK_SELECTIONS} supported banks per listing.` }, { status: 400 });
      }
    }
    if (minimumTrade !== undefined && toNumber(minimumTrade) < 0) {
      return NextResponse.json({ error: "Minimum trade cannot be negative." }, { status: 400 });
    }
    if (effectiveMaximumTrade !== undefined && toNumber(effectiveMaximumTrade) <= 0) {
      return NextResponse.json({ error: "Maximum trade must be greater than zero." }, { status: 400 });
    }
    if (effectiveMaximumTrade !== undefined && toNumber(effectiveMaximumTrade) < toNumber(effectiveMinimumTrade)) {
      return NextResponse.json({ error: "Maximum trade must be greater than or equal to minimum trade." }, { status: 400 });
    }
    if (effectiveMaximumTrade !== undefined && effectiveAvailableAmount !== undefined && toNumber(effectiveMaximumTrade) > toNumber(effectiveAvailableAmount)) {
      return NextResponse.json({ error: "Maximum trade must be less than or equal to available amount." }, { status: 400 });
    }
    if (expiresAt !== undefined && expiresAt) {
      const expiresMs = new Date(expiresAt).getTime();
      if (!expiresMs || Number.isNaN(expiresMs)) {
        return NextResponse.json({ error: "Invalid expiry date." }, { status: 400 });
      }
    }

    // Accountable listing changes: any post-creation edit to amount / price /
    // availability requires a structured reason + explanation for the audit log.
    const isStatusOnlyChange = status !== undefined
      && availableAmount === undefined && price === undefined
      && minimumTrade === undefined && maximumTrade === undefined;
    const reasonRequired = !isStatusOnlyChange && existingListing
      ? listingEditRequiresReason(existingListing, { availableAmount, price, minimumTrade, maximumTrade })
      : false;
    let changeReason: string | undefined;
    let changeExplanation: string | undefined;
    if (reasonRequired) {
      const reasonResult = validateListingChangeReason({ reason: body.changeReason, explanation: body.changeExplanation });
      if (!reasonResult.ok) {
        return NextResponse.json({ error: reasonResult.error }, { status: 400 });
      }
      changeReason = reasonResult.reason;
      changeExplanation = reasonResult.explanation;
    }
    const validationMs = Date.now() - validationStartedAt;

    const logicStartedAt = Date.now();
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
      bankAccountId,
      bankName: requiresIsraeliBankSelection(effectivePaymentMethods, effectivePaymentMethod)
        ? serializeIsraeliBankSelection(bankSelection ?? parseIsraeliBankSelection(existingListing?.bankName)) || undefined
        : undefined,
      minimumTrade,
      maximumTrade,
      expiresAt,
      expirationHours,
      notes,
      sellerDescription,
      responseTime,
      status,
      changeReason,
      changeExplanation,
    });
    const logicMs = Date.now() - logicStartedAt;
    const routeMs = Date.now() - routeStartedAt;
    return NextResponse.json({ listing, destination: sellerListingWorkspaceDestination(listing) }, {
      headers: {
        "X-Trade-Route-Ms": String(routeMs),
        "X-Trade-Validation-Ms": String(validationMs),
        "X-Trade-Logic-Ms": String(logicMs),
        "Server-Timing": `route;dur=${routeMs}, validate;dur=${validationMs}, logic;dur=${logicMs}`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to update listing." }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const routeStartedAt = Date.now();
  const { user, unauthorized } = await requireApiUser();
  if (!user) return unauthorized;
  if (!canPublishListings(user)) {
    return NextResponse.json({ error: "You must be approved by Alpha Traders before publishing listings." }, { status: 403 });
  }

  try {
    const { listingId } = await context.params;
    let changeReason: string | undefined;
    let changeExplanation: string | undefined;
    try {
      const body = await request.json();
      const reasonResult = validateListingChangeReason({ reason: body?.changeReason, explanation: body?.changeExplanation });
      if (!reasonResult.ok) {
        return NextResponse.json({ error: reasonResult.error }, { status: 400 });
      }
      changeReason = reasonResult.reason;
      changeExplanation = reasonResult.explanation;
    } catch {
      return NextResponse.json({ error: "Please choose a reason for removing this listing." }, { status: 400 });
    }
    const logicStartedAt = Date.now();
    await deleteMarketplaceListingForSeller({
      listingId,
      sellerId: user.id,
      actorUserId: user.id,
      changeReason,
      changeExplanation,
    });
    const logicMs = Date.now() - logicStartedAt;
    const routeMs = Date.now() - routeStartedAt;
    return NextResponse.json({ success: true }, {
      headers: {
        "X-Trade-Route-Ms": String(routeMs),
        "X-Trade-Logic-Ms": String(logicMs),
        "Server-Timing": `route;dur=${routeMs}, logic;dur=${logicMs}`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to delete listing." }, { status: 400 });
  }
}
