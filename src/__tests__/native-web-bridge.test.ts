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
});
