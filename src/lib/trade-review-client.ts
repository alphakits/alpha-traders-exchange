import type { SellerReviewRecord, TradeReview } from "@/types/alpha-exchange";

export const TRADE_REVIEW_TIMEOUT_MS = 15_000;

export type TradeReviewResponse = {
  error?: string;
  message?: string;
  review?: SellerReviewRecord;
  sellerBuyerReview?: TradeReview;
  sellerProgress?: {
    promoted?: boolean;
    previousRank?: string;
    newRank?: string;
    nextRank?: string;
    remainingVolumeToNextRank?: number;
    progressPercent?: number;
  };
};

export class TradeReviewTimeoutError extends Error {
  constructor() {
    super("Review submission could not be confirmed.");
    this.name = "TradeReviewTimeoutError";
  }
}

/** Bound both response headers and body; a lost response must release the form. */
export async function postTradeReview(input: {
  requestId: string;
  rating: number;
  comment: string;
  diagnosticId: string;
  mode?: "buyer_review" | "seller_buyer_review";
}) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new TradeReviewTimeoutError());
      controller.abort();
    }, TRADE_REVIEW_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(`/api/alpha-exchange/purchase-requests/${encodeURIComponent(input.requestId)}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Review-Diagnostic-Id": input.diagnosticId },
          body: JSON.stringify({ mode: input.mode ?? "buyer_review", rating: input.rating, comment: input.comment }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({})) as TradeReviewResponse;
        return { response, payload };
      })(),
      deadline,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
