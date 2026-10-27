// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { beforeEach, expect, it, vi } from "vitest";

type NotificationEvent = { notification?: { close: () => void; data?: { url?: unknown } }; data?: { json: () => unknown }; waitUntil: (promise: Promise<unknown>) => void };
const source = readFileSync(new URL("../../public/alpha-push-sw.js", import.meta.url), "utf8");
let handlers: Record<string, (event: NotificationEvent) => void>;
let show: ReturnType<typeof vi.fn>, match: ReturnType<typeof vi.fn>, open: ReturnType<typeof vi.fn>;
beforeEach(() => {
  handlers = {}; show = vi.fn().mockResolvedValue(undefined); match = vi.fn().mockResolvedValue([]); open = vi.fn().mockResolvedValue({});
  runInNewContext(source, { URL, self: {
    location: { origin: "https://www.alphatraders.co.il" },
    addEventListener: (type: string, callback: (event: NotificationEvent) => void) => { handlers[type] = callback; },
    registration: { showNotification: show }, clients: { matchAll: match, openWindow: open },
  } });
});
async function click(url?: unknown) {
  const promises: Promise<unknown>[] = [];
  const close = vi.fn();
  handlers.notificationclick({ notification: { close, data: { url } }, waitUntil: promise => promises.push(promise) });
  await Promise.all(promises); expect(close).toHaveBeenCalledOnce();
}
it.each([null, [], "text", 42])("shows a safe notification for malformed payload %j", async value => {
  const promises: Promise<unknown>[] = [];
  handlers.push({ data: { json: () => value }, waitUntil: promise => promises.push(promise) });
  await Promise.all(promises);
  expect(show).toHaveBeenCalledWith("Alpha Traders update", expect.objectContaining({ body: "Open Alpha Traders to see your update." }));
});
it.each(["https://evil.test/ar/trade-room/secret", "//evil.test/en/notifications", "javascript:alert(1)", "/api/account/delete"])("rejects unsafe click destination %s", async url => {
  await click(url); expect(open).toHaveBeenCalledWith("https://www.alphatraders.co.il/en/notifications");
});
it("opens the exact Arabic trade destination including query and fragment", async () => {
  await click("/ar/trade-room/request-1?view=payment#receipt");
  expect(open).toHaveBeenCalledWith("https://www.alphatraders.co.il/ar/trade-room/request-1?view=payment#receipt");
});
it("focuses an existing destination without reloading it", async () => {
  const focus = vi.fn().mockResolvedValue({}); const navigate = vi.fn();
  match.mockResolvedValue([{ url: "https://www.alphatraders.co.il/en/notifications", focus, navigate }]);
  await click("/en/notifications"); expect(focus).toHaveBeenCalledOnce(); expect(navigate).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
});
it.each(["reject", "null"])("opens a fresh window if tab navigation returns %s", async outcome => {
  const navigate = outcome === "reject" ? vi.fn().mockRejectedValue(new Error("closed")) : vi.fn().mockResolvedValue(null);
  match.mockResolvedValue([{ url: "https://www.alphatraders.co.il/en", navigate }]);
  await click("/en/notifications"); expect(open).toHaveBeenCalledWith("https://www.alphatraders.co.il/en/notifications");
});
it("does not install a fetch interceptor for authenticated pages", () => { expect(Object.keys(handlers).sort()).toEqual(["notificationclick", "push"]); });
