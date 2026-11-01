import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({user:{id:"user"} as {id:string}|null, device:"off", enable:vi.fn()}));
vi.mock("@/components/auth/canonical-session-provider",()=>({useCanonicalSession:()=>({user:state.user,isResolving:false})}));
vi.mock("@/lib/browser-push-client",()=>({checkBrowserPush:async()=>state.device,enableBrowserPush:state.enable}));
import { BrowserPushPrompt } from "./browser-push-prompt";
const base={preferences:{inApp:true,email:false,browserPush:false},emailVerified:true,browserPush:{available:true,publicKey:"public"}};
let value:typeof base;let show:boolean;let fetcher:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 vi.useFakeTimers();state.user={id:"user"};state.device="off";state.enable.mockReset();state.enable.mockResolvedValue("on");show=true;value=structuredClone(base);
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
describe("smart notification reminder",()=>{
 it("does nothing for guests",async()=>{state.user=null;render(<BrowserPushPrompt locale="en"/>);await settle();expect(fetcher).not.toHaveBeenCalled();});
 it("checks channels without asking for permission, and only enables email on a click",async()=>{
  render(<BrowserPushPrompt locale="en"/>);await settle();expect(screen.getByText("Stay close to new USDT deals")).toBeTruthy();expect(state.enable).not.toHaveBeenCalled();
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
