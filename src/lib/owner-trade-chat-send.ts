import { requestOwnerCommandOnce } from "./owner-account-command";

/** Retrying the same explicit draft uses the same server-deduplicated reference. */
export async function sendOwnerTradeChat(input: { tradeId: string; message: string; clientMessageId: string }, fetcher = globalThis.fetch, timeoutMs = 20_000): Promise<"sent" | "unknown" | "rejected"> {
  try {
    const result = await requestOwnerCommandOnce(`/api/alpha-exchange/purchase-requests/${encodeURIComponent(input.tradeId)}/messages`, "POST", {
      message: input.message, clientMessageId: input.clientMessageId,
    }, fetcher, timeoutMs);
    if ([401, 403, 429].includes(result.status)) return "rejected";
    const payload = result.payload as { message?: { id?: unknown; purchaseRequestId?: unknown; clientMessageId?: unknown; senderRole?: unknown; message?: unknown }; error?: unknown } | null;
    const receipt = payload?.message;
    return result.ok && !payload?.error && typeof receipt?.id === "string" && receipt.id.length > 0
      && receipt.purchaseRequestId === input.tradeId && receipt.clientMessageId === input.clientMessageId
      && ["owner", "buyer", "approved_seller"].includes(String(receipt.senderRole)) && receipt.message === input.message ? "sent" : "unknown";
  } catch { return "unknown"; }
}
