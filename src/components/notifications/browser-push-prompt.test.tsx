import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
const state=vi.hoisted(()=>({user:{id:"user"} as {id:string}|null, device:"off", enable:vi.fn(), check:vi.fn()}));
vi.mock("@/components/auth/canonical-session-provider",()=>({useCanonicalSession:()=>({user:state.user,isResolving:false})}));
vi.mock("@/lib/browser-push-client",async (original)=>({
 ...await original<typeof import("@/lib/browser-push-client")>(), checkBrowserPush:state.check,enableBrowserPush:state.enable,
}));
import { BrowserPushSessionExpired } from "@/lib/browser-push-client";
import { BrowserPushPrompt } from "./browser-push-prompt";
const base={preferences:{inApp:true,email:false,browserPush:false},emailVerified:true,browserPush:{available:true,publicKey:"public"}};
let value:typeof base;let show:boolean;let fetcher:Mock<(url:string, options?:RequestInit)=>Promise<Response>>;
beforeEach(()=>{
 vi.useFakeTimers();state.user={id:"user"};state.device="off";state.enable.mockReset();state.enable.mockResolvedValue("on");show=true;value=structuredClone(base);
 state.check.mockReset().mockImplementation(async () => state.device);
 fetcher=vi.fn(async(url:string,options?:RequestInit)=>{
  if(options?.method==="PATCH") return new Response("{}",{status:200});
  if(options?.method==="POST") return new Response(JSON.stringify({show}),{status:200});
  return new Response(JSON.stringify(value),{status:200});
 });vi.stubGlobal("fetch",fetcher);
});

it("cancels a pending enable immediately on logout before canonical state rerenders", async () => {
  let resolve!: (value: string) => void;
  state.enable.mockImplementation(() => new Promise(r => { resolve = r; }));
  render(<BrowserPushPrompt locale="en" />); await settle();
  await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Enable" })[1]); });
  const scope = state.enable.mock.calls[0]?.[2] as { userId: string; signal: AbortSignal };
  expect(scope.userId).toBe("user");
  await act(async () => {
    window.dispatchEvent(new Event("alpha-auth-signed-out"));
    resolve("on");
  });
  expect(scope.signal.aborted).toBe(true);
  expect(screen.queryByRole("region")).toBeNull();
});

it("ignores another account's native state and uses only scoped device status", async () => {
  window.ReactNativeWebView = { postMessage: vi.fn() };
  render(<BrowserPushPrompt locale="en" />); await settle();
  await act(async () => { window.dispatchEvent(new CustomEvent("alpha-notification-push-state", { detail: { userId: "other", state: "on" } })); });
  expect(screen.getByText("Unavailable")).toBeTruthy();
  await act(async () => { window.dispatchEvent(new CustomEvent("alpha-notification-push-state", { detail: { userId: "user", state: "blocked" } })); });
  expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
});

it("does not describe an unavailable device channel as switched on", async () => {
  value.preferences.email = true; value.preferences.browserPush = true; value.browserPush.available = false;
  render(<BrowserPushPrompt locale="en" />); await settle();
  await act(async () => { window.dispatchEvent(new Event("alpha-notification-settings")); });
  expect(screen.getByText("Unavailable")).toBeTruthy();
  expect(screen.queryByText("Your alerts are switched on")).toBeNull();
});

it("does not refresh a push subscription using a response for a different account", async () => {
  const mismatch = { ...value, userId: "other" };
  fetcher.mockImplementation(async () => new Response(JSON.stringify(mismatch), { status: 200 }));
  render(<BrowserPushPrompt locale="en" />); await settle();
  expect(screen.queryByRole("region")).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();delete window.ReactNativeWebView;});
async function settle(){await act(async()=>{await vi.advanceTimersByTimeAsync(4100);});}

describe("Home Screen enrollment recovery", () => {
 it.each(["en", "ar"] as const)("guides a blocked iPhone through system settings and explicit Enable in %s", async locale => {
  const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)");
  try {
   state.device = "blocked"; value.preferences.email = true;
   render(<BrowserPushPrompt locale={locale} />); await settle();
   const isAr = locale === "ar";
   fireEvent.click(screen.getByRole("button", { name: isAr ? "الإعدادات" : "Settings" }));
   const instructions = screen.getByRole("status").textContent;
   expect(instructions).toContain(isAr ? "الشاشة الرئيسية" : "Home Screen");
   expect(instructions).toContain(isAr ? "السماح بالإشعارات" : "Allow Notifications");
   expect(instructions).toContain(isAr ? "إعادة الفحص" : "Check again");
   expect(instructions).toContain(isAr ? "تفعيل" : "Enable");
   expect(instructions).not.toMatch(/address bar|بجانب العنوان/);
   state.device = "off";
   await act(async () => { fireEvent.click(screen.getByRole("button", { name: isAr ? "إعادة الفحص" : "Check again" })); });
   expect(state.enable).not.toHaveBeenCalled();
   await act(async () => { fireEvent.click(screen.getByRole("button", { name: isAr ? "تفعيل" : "Enable" })); });
   expect(state.enable).toHaveBeenCalledOnce();
  } finally { ua.mockRestore(); }
 });
});

describe("expired device setup session", () => {
 function expectRecovery(locale: "en" | "ar") {
  const isAr = locale === "ar";
  const href = screen.getByRole("link", { name: isAr ? "تسجيل الدخول" : "Sign in" }).getAttribute("href")!;
  const url = new URL(href, "https://www.alphatraders.co.il");
  expect(url.pathname).toBe("/" + locale + "/login");
  expect(url.searchParams.get("redirectTo")).toBe("/" + locale + "/profile#notification-preferences");
  expect(screen.queryByRole("button", { name: isAr ? "إرسال تنبيه تجريبي" : "Send test alert" })).toBeNull();
 }
 it.each(["en", "ar"] as const)("replaces cached readiness on a 401 recheck and returns to localized Alerts in %s", async locale => {
  state.device = "on";
  render(<BrowserPushPrompt locale={locale} />); await settle();
  const isAr = locale === "ar";
  expect(screen.getByRole("button", { name: isAr ? "إرسال تنبيه تجريبي" : "Send test alert" })).toBeTruthy();
  fetcher.mockResolvedValueOnce(new Response(null, { status: 401 }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: isAr ? "إعادة الفحص" : "Check again" })); });
  expectRecovery(locale);
 });
 it("shows sign-in for a manual open queued during an automatic lookup that expires", async () => {
  let resolve!: (response: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  render(<BrowserPushPrompt locale="en" />); await settle();
  await act(async () => { window.dispatchEvent(new Event("alpha-notification-settings")); });
  expect(screen.queryByRole("link")).toBeNull();
  await act(async () => { resolve(new Response(null, { status: 401 })); });
  expectRecovery("en");
 });
 it("keeps an unsolicited 401 quiet until the user opens device settings", async () => {
  fetcher.mockResolvedValueOnce(new Response(null, { status: 401 }));
  render(<BrowserPushPrompt locale="en" />); await settle();
  expect(screen.queryByRole("region")).toBeNull();
  await act(async () => { window.dispatchEvent(new Event("alpha-notification-settings")); });
  expectRecovery("en");
 });
 it.each(["refresh", "enable", "test"])("recovers if the session expires during %s after a successful settings read", async stage => {
  state.device = stage === "enable" ? "off" : "on";
  value.preferences.email = stage === "enable";
  render(<BrowserPushPrompt locale="en" />); await settle();
  if (stage === "refresh") state.check.mockRejectedValueOnce(new BrowserPushSessionExpired());
  if (stage === "enable") state.enable.mockRejectedValueOnce(new BrowserPushSessionExpired());
  if (stage === "test") fetcher.mockResolvedValueOnce(new Response(null, { status: 401 }));
  const name = stage === "refresh" ? "Check again" : stage === "enable" ? "Enable" : "Send test alert";
  await act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
  expectRecovery("en");
 });
});
describe("smart notification reminder",()=>{
 it("does nothing for guests",async()=>{state.user=null;render(<BrowserPushPrompt locale="en"/>);await settle();expect(fetcher).not.toHaveBeenCalled();});
 it("checks channels without asking for permission, and only enables email on a click",async()=>{
  render(<BrowserPushPrompt locale="en"/>);await settle();expect(screen.getByRole("heading", { name: "Stay close to new USDT deals" })).toBeTruthy();expect(state.enable).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.some(([,o])=>o?.method==="PATCH")).toBe(false);
  await act(async()=>{fireEvent.click(screen.getAllByRole("button",{name:"Enable"})[0]);});
  expect(fetcher.mock.calls.some(([,o])=>o?.body==='{"email":true}')).toBe(true);
 });
 it("keeps quiet when the account-wide cooldown denies the claim",async()=>{show=false;render(<BrowserPushPrompt locale="en"/>);await settle();expect(screen.queryByRole("region")).toBeNull();});
 it("does not remind when enabled channels are healthy",async()=>{value.preferences.email=true;value.preferences.browserPush=true;state.device="on";render(<BrowserPushPrompt locale="en"/>);await settle();expect(screen.queryByRole("region")).toBeNull();expect(fetcher.mock.calls.some(([,o])=>o?.method==="POST")).toBe(false);});
 it("offers blocked-permission instructions without requesting permission",async()=>{state.device="blocked";render(<BrowserPushPrompt locale="en"/>);await settle();fireEvent.click(screen.getByRole("button",{name:"Settings"}));expect(screen.getByRole("status").textContent).toContain("site settings");expect(state.enable).not.toHaveBeenCalled();});
 it("persists seven-day snooze",async()=>{render(<BrowserPushPrompt locale="en"/>);await settle();await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Remind me in 7 days"}));});expect(fetcher.mock.calls.some(([,o])=>o?.body==='{"action":"snooze","expectedUserId":"user"}')).toBe(true);expect(screen.queryByRole("region")).toBeNull();});
 it("clears the reminder on logout and renders Arabic in RTL",async()=>{const view=render(<BrowserPushPrompt locale="ar"/>);await settle();expect(screen.getByRole("region").getAttribute("dir")).toBe("rtl");state.user=null;view.rerender(<BrowserPushPrompt locale="ar"/>);expect(screen.queryByRole("region")).toBeNull();});
 it("does not claim success after failed push registration",async()=>{state.enable.mockRejectedValue(new Error("failed"));render(<BrowserPushPrompt locale="en"/>);await settle();await act(async()=>{fireEvent.click(screen.getAllByRole("button",{name:"Enable"})[1]);});expect(screen.getByRole("status").textContent).toContain("not connected");});
});

describe("explicit device test alert", () => {
 const testCalls = () => fetcher.mock.calls.filter(([url]) => url === "/api/alpha-exchange/notification-push-test");

 function mockTestResponse(body: unknown, status = 202) {
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url: string, options?: RequestInit) => url === "/api/alpha-exchange/notification-push-test"
   ? new Response(JSON.stringify(body), { status }) : original(url, options));
 }

 it("never sends automatically and requires one explicit click with the current account", async () => {
  state.device = "on"; value.preferences.email = true; value.preferences.browserPush = true;
  mockTestResponse({ status: "accepted", accepted: { browser: 1, native: 0 } });
  render(<BrowserPushPrompt locale="en" />); await settle();
  expect(testCalls()).toHaveLength(0);
  await act(async () => { window.dispatchEvent(new Event("alpha-notification-settings")); });
  expect(testCalls()).toHaveLength(0);
  const button = screen.getByRole("button", { name: "Send test alert" });
  await act(async () => { fireEvent.click(button); fireEvent.click(button); });
  expect(testCalls()).toHaveLength(1);
  expect(testCalls()[0][1]).toMatchObject({ method: "POST", body: JSON.stringify({ expectedUserId: "user", locale: "en" }), signal: expect.any(AbortSignal) });
  expect(screen.getByRole("status").textContent).toBe("The push service accepted the test alert. Check your device and tap it to confirm.");
  expect(state.enable).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.some(([, options]) => options?.method === "PATCH")).toBe(false);
 });

 it("uses the same self-only action for a connected native device without opening settings or requesting a review", async () => {
  const bridge = vi.fn(); window.ReactNativeWebView = { postMessage: bridge };
  mockTestResponse({ status: "accepted", accepted: { browser: 0, native: 1 } });
  render(<BrowserPushPrompt locale="en" />); await settle();
  expect(screen.queryByRole("button", { name: "Send test alert" })).toBeNull();
  await act(async () => { window.dispatchEvent(new CustomEvent("alpha-notification-push-state", { detail: { userId: "user", state: "on" } })); });
  expect(testCalls()).toHaveLength(0);
  bridge.mockClear();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send test alert" })); });
  expect(testCalls()).toHaveLength(1);
  expect(bridge).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toContain("Check your device");
 });

 it.each(["blocked", "off", "unsupported", "unavailable"])("does not offer a test before device setup: %s", async device => {
  state.device = device;
  render(<BrowserPushPrompt locale="en" />); await settle();
  expect(screen.queryByRole("button", { name: "Send test alert" })).toBeNull();
  expect(testCalls()).toHaveLength(0);
 });

 it("requires enabled website alerts without changing consent", async () => {
  state.device = "on"; value.preferences.inApp = false;
  render(<BrowserPushPrompt locale="en" />); await settle();
  expect(screen.queryByRole("button", { name: "Send test alert" })).toBeNull();
  expect(testCalls()).toHaveLength(0);
  expect(fetcher.mock.calls.some(([, options]) => options?.method === "PATCH")).toBe(false);
 });

 it("reports a saved-only notice without claiming provider acceptance or device display", async () => {
  state.device = "on"; mockTestResponse({ status: "saved", accepted: { browser: 0, native: 0 } });
  render(<BrowserPushPrompt locale="en" />); await settle();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send test alert" })); });
  expect(screen.getByRole("status").textContent).toBe("Test alert saved. Push service acceptance is not confirmed yet. Check device settings and try again.");
 });

 it("explains the rate limit in Arabic and sends the Arabic locale", async () => {
  state.device = "on"; mockTestResponse({ error: "Too many requests." }, 429);
  render(<BrowserPushPrompt locale="ar" />); await settle();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "إرسال تنبيه تجريبي" })); });
  expect(screen.getByRole("status").textContent).toBe("انتظر خمس دقائق قبل إرسال تنبيه تجريبي آخر.");
  expect(testCalls()[0][1]?.body).toBe(JSON.stringify({ expectedUserId: "user", locale: "ar" }));
 });

 it.each(["logout", "switch"])("aborts an in-flight test and discards its result on %s", async change => {
  state.device = "on";
  let resolve!: (response: Response) => void;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, options?: RequestInit) => url === "/api/alpha-exchange/notification-push-test"
   ? new Promise<Response>(done => { resolve = done; }) : original(url, options));
  const view = render(<BrowserPushPrompt locale="en" />); await settle();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send test alert" })); });
  const signal = testCalls()[0][1]?.signal;
  await act(async () => {
   if (change === "logout") window.dispatchEvent(new Event("alpha-auth-signed-out"));
   else { state.user = { id: "next-user" }; view.rerender(<BrowserPushPrompt locale="en" />); }
  });
  expect(signal?.aborted).toBe(true);
  await act(async () => { resolve(new Response(JSON.stringify({ status: "accepted" }), { status: 202 })); });
  expect(screen.queryByRole("status")).toBeNull();
  expect(testCalls()).toHaveLength(1);
 });

 it("does not claim success for a failed or malformed response", async () => {
  state.device = "on"; mockTestResponse({ status: "delivered" });
  render(<BrowserPushPrompt locale="en" />); await settle();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send test alert" })); });
  expect(screen.getByRole("status").textContent).toBe("Could not confirm the test alert. Check notification settings and try again.");
 });
});
