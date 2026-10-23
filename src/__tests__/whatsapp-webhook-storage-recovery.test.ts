// @vitest-environment node
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as unknown, log: vi.fn() }));
vi.mock("@/lib/postgres-runtime", () => ({ getRuntimePostgresPool: () => state.pool }));
vi.mock("@/lib/structured-logging", () => ({ logEvent: state.log }));

import { POST as metaWebhook } from "@/app/api/meta/whatsapp/webhook/route";
import { POST as twilioWebhook } from "@/app/api/twilio/whatsapp/webhook/route";

const origin = "https://www.alphatraders.co.il";
const metaSecret = "local-callback-fixture-secret-32-characters";
const twilioToken = "local-callback-fixture-token";
const account = `AC${"a".repeat(32)}`;
const message = `SM${"b".repeat(32)}`;
type Callback = "status" | "stop" | "ordinary";

function metaRequest(kind: Callback) {
  const value = kind === "status"
    ? { statuses: [{ id: "wamid.fixture", status: "delivered", timestamp: "1792735200" }] }
    : { messages: [{ id: "wamid.fixture", from: "972501234567", type: "text", text: { body: kind === "stop" ? "STOP" : "Hello" }, timestamp: "1792735200" }] };
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "fixture-waba", changes: [{ field: "messages", value: { ...value, metadata: { phone_number_id: "fixture-phone" } } }] }] });
  return new NextRequest(`${origin}/api/meta/whatsapp/webhook`, {
    method: "POST", body,
    headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", metaSecret).update(body).digest("hex")}` },
  });
}

function twilioRequest(kind: Callback) {
  const params: Record<string, string> = { AccountSid: account, MessageSid: message };
  if (kind === "status") params.MessageStatus = "delivered";
  else Object.assign(params, { From: "whatsapp:+972501234567", To: "whatsapp:+15551234567", Body: kind === "stop" ? "STOP" : "Hello" });
  const url = `${origin}/api/twilio/whatsapp/webhook`;
  const signature = createHmac("sha1", twilioToken).update(url + Object.keys(params).sort().map(key => key + params[key]).join("")).digest("base64");
  return new NextRequest(url, { method: "POST", body: new URLSearchParams(params), headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature } });
}

beforeEach(() => {
  state.pool = null;
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", origin);
  vi.stubEnv("META_WHATSAPP_APP_SECRET", metaSecret);
  vi.stubEnv("META_WHATSAPP_WABA_ID", "fixture-waba");
  vi.stubEnv("META_WHATSAPP_PHONE_NUMBER_ID", "fixture-phone");
  vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_PHONE_FINGERPRINT_SECRET", "local-fingerprint-fixture-secret-32-characters");
  vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_PROVIDER", "twilio");
  vi.stubEnv("TWILIO_ACCOUNT_SID", account);
  vi.stubEnv("TWILIO_AUTH_TOKEN", twilioToken);
  vi.stubEnv("TWILIO_WHATSAPP_FROM", "+15551234567");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No provider calls are allowed in callback tests"); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

for (const provider of [
  { name: "Meta", request: metaRequest, handle: metaWebhook },
  { name: "Twilio", request: twilioRequest, handle: twilioWebhook },
]) describe(`${provider.name} callback durability`, () => {
  it.each(["status", "stop"] as const)("does not acknowledge a signed %s callback when storage is unavailable", async kind => {
    const response = await provider.handle(provider.request(kind));
    expect(response.status).toBe(500);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not acknowledge STOP when its privacy fingerprint cannot be computed", async () => {
    vi.stubEnv("ALPHA_EXCHANGE_WHATSAPP_PHONE_FINGERPRINT_SECRET", "");
    const query = vi.fn(), connect = vi.fn();
    state.pool = { query, connect };
    expect((await provider.handle(provider.request("stop"))).status).toBe(500);
    expect(query).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still ignores ordinary signed inbound text without requiring storage", async () => {
    expect((await provider.handle(provider.request("ordinary"))).status).toBe(204);
    expect(fetch).not.toHaveBeenCalled();
  });
});
