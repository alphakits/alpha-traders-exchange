// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_PROVIDER_TIMEOUT_MS, withAuthProviderDeadline } from "@/lib/auth-request-deadline";
import { createSupabaseAuthClient } from "@/lib/supabase-auth-provider";

vi.mock("@/lib/rate-limit", () => ({ resolveClientIp: () => "unknown" }));

const credentials = { email: "deadline@example.test", password: "test-only-password" };
const providerUser = { id: "deadline-user", aud: "authenticated", email: credentials.email };
const successPayload = { access_token: "test-access", refresh_token: "test-refresh", token_type: "bearer", expires_in: 3600, user: providerUser };

function signIn(signal: AbortSignal) {
  return withAuthProviderDeadline(signal, (providerSignal) =>
    createSupabaseAuthClient({ signal: providerSignal }).auth.signInWithPassword(credentials));
}

beforeEach(() => {
  vi.useFakeTimers();
  // The shared component-test setup removes WebSocket. The SDK checks for a
  // constructor even for auth-only clients; opening one is never allowed here.
  vi.stubGlobal("WebSocket", class {
    constructor() { throw new Error("Auth deadline tests must not open a WebSocket."); }
  });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.example.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("login provider deadline with the real Supabase SDK", () => {
  it("aborts a hanging transport at the whole-operation deadline without retrying credentials", async () => {
    let transportSignal: AbortSignal | undefined;
    const transport = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      transportSignal = init?.signal as AbortSignal;
      transportSignal.addEventListener("abort", () => reject(transportSignal!.reason), { once: true });
    }));
    vi.stubGlobal("fetch", transport);
    const outcome = signIn(new AbortController().signal).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(AUTH_PROVIDER_TIMEOUT_MS - 1);
    expect(transportSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({ name: "TimeoutError" });
    expect(transportSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 400])("bounds a stalled %i response body even when the body ignores abort", async (status) => {
    let transportSignal: AbortSignal | undefined;
    let finishBody!: () => void;
    const transport = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      transportSignal = init?.signal as AbortSignal;
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          finishBody = () => {
            controller.enqueue(new TextEncoder().encode(JSON.stringify(status === 200 ? successPayload : { error_code: "invalid_credentials", msg: "Invalid login credentials" })));
            controller.close();
          };
        },
      }), { status, headers: { "content-type": "application/json" } }));
    });
    vi.stubGlobal("fetch", transport);
    const outcome = signIn(new AbortController().signal).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(AUTH_PROVIDER_TIMEOUT_MS);
    expect(await outcome).toMatchObject({ name: "TimeoutError" });
    expect(transportSignal?.aborted).toBe(true);
    // Let the SDK finish later. Its mapped 401 or valid session cannot replace
    // the timeout already returned to the route.
    finishBody();
    await vi.advanceTimersByTimeAsync(0);
    expect(await outcome).toMatchObject({ name: "TimeoutError" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates caller cancellation to transport and preserves its reason", async () => {
    let transportSignal: AbortSignal | undefined;
    const transport = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      transportSignal = init?.signal as AbortSignal;
      transportSignal.addEventListener("abort", () => reject(transportSignal!.reason), { once: true });
    }));
    vi.stubGlobal("fetch", transport);
    const caller = new AbortController();
    const reason = new DOMException("Request cancelled", "AbortError");
    const outcome = signIn(caller.signal).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    caller.abort(reason);
    expect(await outcome).toBe(reason);
    expect(transportSignal?.reason).toBe(reason);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never starts the SDK operation for an already cancelled caller", async () => {
    const caller = new AbortController();
    const operation = vi.fn();
    caller.abort();
    await expect(withAuthProviderDeadline(caller.signal, operation)).rejects.toMatchObject({ name: "AbortError" });
    expect(operation).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 400])("preserves a normal %i result and removes deadline/caller listeners", async (status) => {
    let transportSignal: AbortSignal | undefined;
    const transport = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      transportSignal = init?.signal as AbortSignal;
      return Promise.resolve(Response.json(status === 200 ? successPayload : { error_code: "invalid_credentials", msg: "Invalid login credentials" }, { status }));
    });
    vi.stubGlobal("fetch", transport);
    const caller = new AbortController();
    const result = await signIn(caller.signal);
    if (status === 200) {
      expect(result.error).toBeNull();
      expect(result.data.user?.id).toBe(providerUser.id);
    } else {
      expect(result.error?.status).toBe(400);
      expect(result.data.user).toBeNull();
    }
    expect(vi.getTimerCount()).toBe(0);
    caller.abort();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transportSignal?.aborted).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects cancellation in the same turn as an already fulfilled SDK result", async () => {
    const caller = new AbortController();
    const operation = vi.fn(() => Promise.resolve("late-success"));
    const outcome = withAuthProviderDeadline(caller.signal, operation).catch((error: unknown) => error);
    caller.abort();
    expect(await outcome).toBe(caller.signal.reason);
    expect(vi.getTimerCount()).toBe(0);
  });
});
