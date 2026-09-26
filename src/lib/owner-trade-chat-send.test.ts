import { afterEach, describe, expect, it, vi } from "vitest";
import { sendOwnerTradeChat } from "./owner-trade-chat-send";
const input = { tradeId: "trade-1", message: "Delivery check", clientMessageId: "attempt-1" };
const receipt = { id: "server-message", purchaseRequestId: input.tradeId, clientMessageId: input.clientMessageId, senderRole: "owner", message: input.message };
afterEach(() => vi.useRealTimers());
describe("owner message acknowledgement", () => {
  it.each([200, 201])("accepts a matching stored or deduplicated message with HTTP %s", async status => {
    await expect(sendOwnerTradeChat(input, vi.fn().mockResolvedValue(Response.json({ message: receipt }, { status })))).resolves.toBe("sent");
  });
  it.each([{ purchaseRequestId: "other" }, { clientMessageId: "other" }, { senderRole: "buyer" }, { message: "other" }, { id: "" }])("retains uncertainty for mismatched receipt %j", async override => {
    await expect(sendOwnerTradeChat(input, vi.fn().mockResolvedValue(Response.json({ message: { ...receipt, ...override } })))).resolves.toBe("unknown");
  });
  it.each([{}, { success: true }, { message: receipt, error: "Failed" }])("does not erase a draft for malformed success %j", async body => {
    await expect(sendOwnerTradeChat(input, vi.fn().mockResolvedValue(Response.json(body)))).resolves.toBe("unknown");
  });
  it.each(["fetch", "body"])("bounds a stalled %s without sending again", async stage => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => {});
    const fetcher = vi.fn().mockImplementation(() => stage === "fetch" ? never : Promise.resolve({ ok: true, status: 200, json: () => never }));
    const send = sendOwnerTradeChat(input, fetcher, 100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(send).resolves.toBe("unknown");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
