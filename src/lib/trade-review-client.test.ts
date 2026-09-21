import { afterEach, describe, expect, it, vi } from "vitest";
import { postTradeReview, TRADE_REVIEW_TIMEOUT_MS, TradeReviewTimeoutError } from "./trade-review-client";

const input = { requestId: "trade-1", rating: 5, comment: "Done", diagnosticId: "attempt-1" };

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("review request recovery", () => {
  it.each(["headers", "body"])("releases a submission stalled on response %s and allows the same feedback to be retried", async (stage) => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const stalled = new Promise<never>(() => {});
    const fetchMock = vi.fn((_url, init) => {
      signal = init.signal;
      return stage === "headers" ? stalled : Promise.resolve({ ok: true, json: () => stalled });
    });
    vi.stubGlobal("fetch", fetchMock);
    const attempt = postTradeReview(input);
    const rejection = expect(attempt).rejects.toBeInstanceOf(TradeReviewTimeoutError);
    await vi.advanceTimersByTimeAsync(TRADE_REVIEW_TIMEOUT_MS);
    await rejection;
    expect(signal?.aborted).toBe(true);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ review: { id: "review-trade-1" } })) as never);
    const retry = await postTradeReview(input);
    expect(retry.payload.review?.id).toBe("review-trade-1");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ rating: 5, comment: "Done" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves a failed service response so the UI cannot treat it as a saved rating", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 })));
    const result = await postTradeReview(input);
    expect(result.response.ok).toBe(false);
    expect(result.payload.review).toBeUndefined();
  });
});
