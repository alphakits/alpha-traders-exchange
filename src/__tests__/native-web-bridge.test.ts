import { describe, expect, it } from "vitest";
import {
  NATIVE_WEB_BRIDGE_VERSION,
  parseNativeToWebBridgeMessage,
  parseWebToNativeBridgeMessage,
} from "@alpha-traders/contracts";

describe("native website bridge protocol", () => {
  it("accepts the bounded authenticated-session message", () => {
    expect(parseWebToNativeBridgeMessage(JSON.stringify({
      type: "alpha.web.session",
      version: NATIVE_WEB_BRIDGE_VERSION,
      authenticated: true,
      userId: "user-1",
      locale: "en",
    }))).toEqual({
      type: "alpha.web.session",
      version: NATIVE_WEB_BRIDGE_VERSION,
      authenticated: true,
      userId: "user-1",
      locale: "en",
    });
  });

  it("rejects malformed, unknown, and oversized messages", () => {
    expect(parseWebToNativeBridgeMessage("not-json")).toBeNull();
    expect(parseWebToNativeBridgeMessage(JSON.stringify({
      type: "alpha.web.session",
      version: 999,
      authenticated: false,
      locale: "en",
    }))).toBeNull();
    expect(parseNativeToWebBridgeMessage(JSON.stringify({
      type: "alpha.native.push-registration",
      version: NATIVE_WEB_BRIDGE_VERSION,
      status: "registered",
      expoPushToken: "x".repeat(300),
      installationId: "installation-1",
      platform: "ios",
      appVersion: "1.0.0",
      locale: "en",
    }))).toBeNull();
  });

  it("parses a successful physical-device registration", () => {
    const message = {
      type: "alpha.native.push-registration",
      version: NATIVE_WEB_BRIDGE_VERSION,
      status: "registered",
      expoPushToken: "ExponentPushToken[abcdefghijklmnop]",
      installationId: "550e8400-e29b-41d4-a716-446655440000",
      platform: "ios",
      appVersion: "1.0.0",
      locale: "ar",
    } as const;
    expect(parseNativeToWebBridgeMessage(message)).toEqual(message);
  });

  it("accepts only bounded whole-number notification badge counts", () => {
    const valid = {
      type: "alpha.web.notification-count",
      version: NATIVE_WEB_BRIDGE_VERSION,
      userId: "user-1",
      unreadCount: 42,
      locale: "en",
    } as const;
    expect(parseWebToNativeBridgeMessage(valid)).toEqual(valid);
    expect(parseWebToNativeBridgeMessage({ ...valid, unreadCount: -1 })).toBeNull();
    expect(parseWebToNativeBridgeMessage({ ...valid, unreadCount: 1.5 })).toBeNull();
    expect(parseWebToNativeBridgeMessage({ ...valid, unreadCount: 10_000 })).toBeNull();
  });

  it("accepts only account-scoped push persistence acknowledgements", () => {
    const registered = {
      type: "alpha.web.push-registration",
      version: NATIVE_WEB_BRIDGE_VERSION,
      userId: "user-1",
      status: "registered",
      locale: "en",
    } as const;
    expect(parseWebToNativeBridgeMessage(registered)).toEqual(registered);
    expect(parseWebToNativeBridgeMessage({ ...registered, status: "failed" })).toEqual({
      ...registered,
      status: "failed",
    });
    expect(parseWebToNativeBridgeMessage({ ...registered, status: "pending" })).toBeNull();
    expect(parseWebToNativeBridgeMessage({ ...registered, userId: "" })).toBeNull();
  });
});
