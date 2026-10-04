import { describe, expect, it } from "vitest";
import { accountSessionId, presentAccountSession, sessionDeviceLabel } from "@/lib/account-session-presentation";
const session = { userId: "buyer-a", token: "hashed-private-token", createdAt: "2026-10-04T10:00:00Z", expiresAt: "2026-10-18T10:00:00Z", deviceLabel: "iOS · Safari" };
describe("session presentation privacy", () => {
  it("exposes a non-secret handle and omits token hashes and account ids", () => { const publicSession = presentAccountSession(session, session.token); expect(publicSession.isCurrent).toBe(true); expect(Object.keys(publicSession).sort()).toEqual(["createdAt", "deviceLabel", "expiresAt", "id", "isCurrent"]); expect(JSON.stringify(publicSession)).not.toContain(session.token); expect(JSON.stringify(publicSession)).not.toContain(session.userId); });
  it("distinguishes two logins created in the same millisecond", () => expect(accountSessionId({ ...session, token: "another-token" })).not.toBe(accountSessionId(session)));
  it("only identifies the matching current session", () => expect(presentAccountSession(session, "other-hash").isCurrent).toBe(false));
  it.each([["Mozilla Android Chrome/140.0 private-suffix", "Android · Chrome"], ["Mozilla iPhone Safari/605.1 private-suffix", "iOS · Safari"], ["Windows Chrome/140.0 Edg/140.0", "Windows · Edge"], [null, "Unknown device"]])("keeps the coarse device label for %s", (ua, expected) => expect(sessionDeviceLabel(ua)).toBe(expected));
});
