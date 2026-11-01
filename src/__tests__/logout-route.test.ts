import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALE_CHOICE_COOKIE } from "@/i18n/locale-preference";

const mocks = vi.hoisted(() => ({ revoke: vi.fn(), expire: vi.fn(), set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "test-session" }), set: mocks.set }) }));
vi.mock("@/lib/auth", () => ({ clearUserSession: mocks.revoke, expireAuthCookies: mocks.expire }));

import { POST } from "@/app/api/auth/logout/route";

describe("logout language reset", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("expires the session language after revocation succeeds", async () => {
    let finish: () => void = () => undefined;
    mocks.revoke.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const result = POST(new NextRequest("https://www.alphatraders.co.il/api/auth/logout", { method: "POST" }));
    await vi.waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith("test-session"));
    expect(mocks.set).not.toHaveBeenCalled();
    finish();
    expect((await result).status).toBe(200);
    expect(mocks.expire).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledWith(LOCALE_CHOICE_COOKIE, "", expect.objectContaining({ path: "/", maxAge: 0 }));
  });

  it("keeps the preference and authentication cookies if revocation fails", async () => {
    mocks.revoke.mockRejectedValue(new Error("Temporarily unavailable"));
    await expect(POST(new NextRequest("https://www.alphatraders.co.il/api/auth/logout", { method: "POST" })))
      .rejects.toThrow("Temporarily unavailable");
    expect(mocks.expire).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
