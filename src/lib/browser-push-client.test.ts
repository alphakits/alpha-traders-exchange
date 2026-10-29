import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkBrowserPush, enableBrowserPush } from "./browser-push-client";
const registration={pushManager:{getSubscription:vi.fn(),subscribe:vi.fn()}};
const subscription={toJSON:()=>({endpoint:"https://fcm.googleapis.com/fcm/send/test",keys:{p256dh:"key",auth:"auth"}}),options:{applicationServerKey: new Uint8Array([0]).buffer},unsubscribe:vi.fn()};
beforeEach(()=>{
 vi.stubGlobal("isSecureContext",true);vi.stubGlobal("PushManager",{});vi.stubGlobal("Notification",{permission:"granted",requestPermission:vi.fn().mockResolvedValue("granted")});
 Object.defineProperty(navigator,"serviceWorker",{configurable:true,value:{getRegistration:vi.fn().mockResolvedValue(registration),register:vi.fn().mockResolvedValue(registration),ready:Promise.resolve(registration)}});
 registration.pushManager.getSubscription.mockReset().mockResolvedValue(subscription);registration.pushManager.subscribe.mockReset().mockResolvedValue(subscription);
 subscription.options.applicationServerKey = new Uint8Array([0]).buffer;
 subscription.unsubscribe.mockReset().mockResolvedValue(true);
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{status:200})));
});

it("requires explicit re-enabling after the server application key rotates", async () => {
  expect(await checkBrowserPush("en", true, { publicKey: "AQ" })).toBe("off");
  expect(fetch).not.toHaveBeenCalled();
  expect(subscription.unsubscribe).not.toHaveBeenCalled();
  expect(await enableBrowserPush("en", "AQ", { userId: "buyer" })).toBe("on");
  expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  expect(registration.pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ applicationServerKey: new Uint8Array([1]) }));
});

it("refreshes only a subscription using the current application key", async () => {
  expect(await checkBrowserPush("en", true, { publicKey: "AA" })).toBe("on");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("reports provider-retired subscriptions off without automatically replacing them", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "subscription_inactive" }), { status: 409 })));
  expect(await checkBrowserPush("en", true, { userId: "buyer", publicKey: "AA" })).toBe("off");
  expect(subscription.unsubscribe).not.toHaveBeenCalled();
  expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
  expect(Notification.requestPermission).not.toHaveBeenCalled();
});
it("replaces a provider-retired subscription only after explicit Enable", async () => {
  const replacement = { ...subscription, toJSON: () => ({ ...subscription.toJSON(), endpoint: "https://fcm.googleapis.com/fcm/send/replacement" }) };
  registration.pushManager.subscribe.mockResolvedValue(replacement);
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: "subscription_inactive" }), { status: 409 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ registered: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  expect(await enableBrowserPush("en", "AA", { userId: "buyer" })).toBe("on");
  expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  expect(registration.pushManager.subscribe).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ action: "subscribe", expectedUserId: "buyer", subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/replacement" } });
  expect(Notification.requestPermission).not.toHaveBeenCalled();
});
it("does not report on when replacement registration is still retired", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ code: "subscription_inactive" }), { status: 409 })));
  await expect(enableBrowserPush("en", "AA", { userId: "buyer" })).rejects.toThrow("still inactive");
  expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  expect(registration.pushManager.subscribe).toHaveBeenCalledTimes(1);
});
it("does not replace a retired subscription after logout during unsubscribe", async () => {
  const controller = new AbortController();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "subscription_inactive" }), { status: 409 })));
  subscription.unsubscribe.mockImplementation(async () => { controller.abort(); return true; });
  await expect(enableBrowserPush("en", "AA", { userId: "buyer", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
});
afterEach(()=>{vi.unstubAllGlobals();delete (navigator as unknown as Record<string,unknown>).serviceWorker;});
describe("browser permission and registration",()=>{
 it("refreshes a healthy subscription without a permission popup",async()=>{expect(await checkBrowserPush("en",true)).toBe("on");expect(Notification.requestPermission).not.toHaveBeenCalled();});
 it("does not call a stale unregistered subscription healthy",async()=>{registration.pushManager.getSubscription.mockResolvedValue(null);expect(await checkBrowserPush("en",true)).toBe("off");});
 it("does not report on if backend persistence failed",async()=>{vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{status:503})));await expect(checkBrowserPush("en",true)).rejects.toThrow();});
 it("does not prompt blocked permissions again",async()=>{vi.stubGlobal("Notification",{permission:"denied",requestPermission:vi.fn()});expect(await enableBrowserPush("en","AA")).toBe("blocked");expect(Notification.requestPermission).not.toHaveBeenCalled();});
 it("asks permission synchronously during the click and waits for persistence",async()=>{vi.stubGlobal("Notification",{permission:"default",requestPermission:vi.fn().mockResolvedValue("granted")});const promise=enableBrowserPush("en","AA");expect(Notification.requestPermission).toHaveBeenCalledTimes(1);expect(await promise).toBe("on");expect(fetch).toHaveBeenCalledWith("/api/alpha-exchange/browser-push",expect.objectContaining({body:expect.stringContaining('"action":"subscribe"')}));});
 it("does not repeat permission requests for an already granted browser", async () => {
   expect(await enableBrowserPush("en", "AA", { userId: "buyer" })).toBe("on");
   expect(Notification.requestPermission).not.toHaveBeenCalled();
   expect(fetch).toHaveBeenCalledWith("/api/alpha-exchange/browser-push", expect.objectContaining({ body: expect.stringContaining('"expectedUserId":"buyer"') }));
 });
 it("does not register after logout while the permission dialog is open", async () => {
   let resolve!: (permission: string) => void;
   vi.stubGlobal("Notification", { permission: "default", requestPermission: vi.fn(() => new Promise(r => { resolve = r; })) });
   const controller = new AbortController();
   const result = enableBrowserPush("en", "AA", { userId: "buyer", signal: controller.signal });
   const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
   controller.abort(); resolve("granted"); await rejected;
   expect(navigator.serviceWorker.register).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
 });
 it("does not persist a background renewal after its account changes", async () => {
   let resolve!: (value: typeof subscription) => void;
   registration.pushManager.getSubscription.mockImplementation(() => new Promise(r => { resolve = r; }));
   const controller = new AbortController();
   const result = checkBrowserPush("en", true, { userId: "buyer", signal: controller.signal });
   const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
   await Promise.resolve(); controller.abort(); resolve(subscription); await rejected;
   expect(fetch).not.toHaveBeenCalled();
 });
 it("handles browsers without notification support without throwing", async () => {
   vi.stubGlobal("Notification", undefined); delete (window as unknown as Record<string, unknown>).Notification;
   expect(await enableBrowserPush("en", "AA")).toBe("unsupported"); expect(fetch).not.toHaveBeenCalled();
 });
});
