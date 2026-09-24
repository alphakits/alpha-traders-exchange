/** Read an API body once: gateways can return HTML, plain text or an empty body. */
export async function readPurchaseResponse(response: Response): Promise<Record<string, unknown>> {
  const body = await response.text();
  try {
    const payload: unknown = JSON.parse(body);
    return payload !== null && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function purchaseBlockDestination(code: string, details: Record<string, unknown>): string | null {
  const id = details.purchaseRequestId;
  if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,191}$/.test(id)) return null;
  if (code === "PENDING_BUYER_FEEDBACK") return `/trade-room/${id}?action=review-trade#status-banner`;
  if (["ACTIVE_TRADE_EXISTS", "PURCHASE_REQUEST_ALREADY_SUBMITTED", "AWAITING_BUYER_CONFIRMATION"].includes(code)) {
    return `/trade-room/${id}`;
  }
  return null;
}
