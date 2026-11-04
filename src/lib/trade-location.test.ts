import { describe, expect, it } from "vitest";
import { parseTradeChatLocation, readTradeChatLocation, tradeLocationMapLinks } from "@alpha-traders/contracts";
import { canShareTradeLocation } from "./trade-location-policy";
import { mapCoordinates, mapWorldPoint } from "./trade-location-map";
import { buildSecurityHeaders, buildTradeRoomLocationHeaders } from "./security-headers";

const point = { version: 1, latitude: 32.1234567, longitude: 35.9876543, source: "meeting_point" } as const;
describe("Face-to-Face location contract", () => {
  it("canonicalizes a bounded structured point", () => {
    expect(parseTradeChatLocation(point)).toEqual({ ...point, latitude: 32.123457, longitude: 35.987654 });
    expect(parseTradeChatLocation({ ...point, accuracyMeters: 4.2 }).accuracyMeters).toBe(5);
  });
  it.each([null, [], "32,35", {}, { ...point, latitude: NaN }, { ...point, longitude: Infinity },
    { ...point, latitude: 91 }, { ...point, longitude: -181 }, { ...point, latitude: "32" },
    { ...point, source: "live" }, { ...point, version: 2 }, { ...point, accuracyMeters: -1 },
    { ...point, accuracyMeters: 100001 }, { ...point, url: "https://wa.me/1234567" },
    { ...point, label: "0501234567" }, { ...point, phone: "0501234567" },
  ])("rejects untrusted location shape %j", value => {
    expect(() => parseTradeChatLocation(value)).toThrow(); expect(readTradeChatLocation(value)).toBeUndefined();
  });
  it("generates only two fixed HTTPS destinations from validated coordinates", () => {
    const links = tradeLocationMapLinks(parseTradeChatLocation(point));
    const waze = new URL(links.waze), google = new URL(links.google);
    expect(waze.origin).toBe("https://www.waze.com"); expect(waze.searchParams.get("ll")).toBe("32.123457,35.987654");
    expect(waze.searchParams.get("navigate")).toBe("yes"); expect(google.origin).toBe("https://www.google.com");
    expect(google.searchParams.get("api")).toBe("1"); expect(google.searchParams.get("destination")).toBe("32.123457,35.987654");
    expect(links.waze + links.google).not.toMatch(/purchase-|trade-|user-|tel:|whatsapp/);
  });
  it.each(["accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"])("allows an unfinished accepted face-to-face stage %s", status => {
    expect(canShareTradeLocation({ paymentMethod: "Face-to-Face (Meet in Person)", status })).toBe(true);
  });
  it.each(["Bank Transfer", "Cardless ATM Withdrawal", "bank transfer israel", "سحب بلا بطاقة", "Cash", "", undefined])("denies every non-face-to-face method %s", paymentMethod => {
    expect(canShareTradeLocation({ paymentMethod, status: "accepted" })).toBe(false);
  });
  it.each(["pending", "completed", "review_open", "locked", "cancelled", "declined", "unknown"])("denies stage %s", status => {
    expect(canShareTradeLocation({ paymentMethod: "Face-to-Face", status })).toBe(false);
  });
  it("denies separately closed/completed records even if their stage remains accepted", () => {
    expect(canShareTradeLocation({ paymentMethod: "Face-to-Face", status: "accepted", completedAt: new Date().toISOString() })).toBe(false);
    expect(canShareTradeLocation({ paymentMethod: "Face-to-Face", status: "accepted", closedAt: new Date().toISOString() })).toBe(false);
  });
  it.each([3, 7, 12, 16, 18])("round-trips Mercator coordinates at zoom %s", zoom => {
    const world = mapWorldPoint(point.latitude, point.longitude, zoom); const result = mapCoordinates(world.x, world.y, zoom);
    expect(result.latitude).toBeCloseTo(point.latitude, 6); expect(result.longitude).toBeCloseTo(point.longitude, 6);
  });
  it("does not open microphone/camera or geolocation outside the Trade Room override", () => {
    expect(buildSecurityHeaders({ isProduction: true }).find(header => header.key === "Permissions-Policy")?.value).toBe("camera=(), microphone=(), geolocation=(), payment=()");
    expect(buildTradeRoomLocationHeaders()).toEqual([{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" }]);
  });
});
