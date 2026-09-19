export const MAX_PRICE_OFFER_DISCOUNT_ILS = 0.35;

const MAX_PRICE_OFFER_DISCOUNT_CENTS = Math.round(MAX_PRICE_OFFER_DISCOUNT_ILS * 100);
const PRICE_INPUT_PATTERN = /^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/;

function parsePriceCents(value: string | number | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!PRICE_INPUT_PATTERN.test(normalized)) return null;
  const [wholePart, decimalPart = ""] = normalized.split(".");
  const cents = Number(wholePart) * 100 + Number(decimalPart.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

function parseListingPriceCents(value: string | number | null | undefined) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^\u20aa\s*/, "")
    .replace(/\s*ILS$/i, "")
    .trim();
  const match = normalized.match(/^(?:0|[1-9]\d{0,6})(?:\.(\d{1,6}))?$/);
  if (!match) return null;
  const [wholePart, decimalPart = ""] = normalized.split(".");
  let cents = Number(wholePart) * 100 + Number(decimalPart.slice(0, 2).padEnd(2, "0"));
  if ((decimalPart[2] ?? "0") >= "5") cents += 1;
  return Number.isSafeInteger(cents) ? cents : null;
}

function formatPriceCents(cents: number) {
  return (cents / 100).toFixed(2);
}

/**
 * Canonicalizes the trusted listing price to the same two-cent precision shown
 * to buyers. Legacy listings may contain extra decimal places even though the
 * marketplace and negotiated offers are displayed and settled to two.
 */
export function normalizeListingPrice(value: string | number | null | undefined) {
  const cents = parseListingPriceCents(value);
  return cents !== null && cents > 0 ? formatPriceCents(cents) : null;
}

export function getPriceOfferBounds(listingPrice: string | number) {
  // Marketplace responses can contain a display-formatted ILS price (for
  // example "₪3.26") and legacy persisted listings can contain extra decimal
  // places (for example "3.263"). Both must settle to the same two-decimal
  // price buyers see. Buyer-entered offers remain strict and never use this
  // trusted-listing parser.
  const listingPriceCents = parseListingPriceCents(listingPrice);
  if (listingPriceCents === null || listingPriceCents <= 0) return null;
  const minimumPriceCents = Math.max(1, listingPriceCents - MAX_PRICE_OFFER_DISCOUNT_CENTS);
  return {
    listingPrice: formatPriceCents(listingPriceCents),
    minimumPrice: formatPriceCents(minimumPriceCents),
    maximumDiscount: formatPriceCents(Math.min(MAX_PRICE_OFFER_DISCOUNT_CENTS, listingPriceCents - 1)),
  };
}

export type PriceOfferValidationResult =
  | {
      ok: true;
      listingPrice: string;
      offeredPrice: string;
      discount: string;
    }
  | {
      ok: false;
      code:
        | "PRICE_OFFER_INVALID_FORMAT"
        | "PRICE_OFFER_NOT_LOWER"
        | "PRICE_OFFER_BELOW_MINIMUM";
      message: string;
      minimumPrice?: string;
      listingPrice?: string;
    };

export function validatePriceOffer(
  listingPrice: string | number,
  offeredPrice: string | number | null | undefined,
): PriceOfferValidationResult {
  const bounds = getPriceOfferBounds(listingPrice);
  const offeredPriceCents = parsePriceCents(offeredPrice);
  if (!bounds || offeredPriceCents === null || offeredPriceCents <= 0) {
    return {
      ok: false,
      code: "PRICE_OFFER_INVALID_FORMAT",
      message: "Offer price must be a valid ILS amount with no more than two decimal places.",
    };
  }

  const listingPriceCents = parsePriceCents(bounds.listingPrice)!;
  const minimumPriceCents = parsePriceCents(bounds.minimumPrice)!;
  if (offeredPriceCents >= listingPriceCents) {
    return {
      ok: false,
      code: "PRICE_OFFER_NOT_LOWER",
      message: "Offer price must be lower than the current listing price.",
      minimumPrice: bounds.minimumPrice,
      listingPrice: bounds.listingPrice,
    };
  }
  if (offeredPriceCents < minimumPriceCents) {
    return {
      ok: false,
      code: "PRICE_OFFER_BELOW_MINIMUM",
      message: `Offer price cannot be more than ₪${MAX_PRICE_OFFER_DISCOUNT_ILS.toFixed(2)} below the current listing price.`,
      minimumPrice: bounds.minimumPrice,
      listingPrice: bounds.listingPrice,
    };
  }

  return {
    ok: true,
    listingPrice: bounds.listingPrice,
    offeredPrice: formatPriceCents(offeredPriceCents),
    discount: formatPriceCents(listingPriceCents - offeredPriceCents),
  };
}

export function normalizePriceOfferInput(value: string | number | null | undefined) {
  const raw = String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٫,]/g, ".")
    .replace(/[^\d.]/g, "");
  const firstDot = raw.indexOf(".");
  if (firstDot === -1) return raw.slice(0, 7);
  const wholePart = raw.slice(0, firstDot).slice(0, 7);
  const decimalPart = raw.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
  return `${wholePart}.${decimalPart}`;
}
