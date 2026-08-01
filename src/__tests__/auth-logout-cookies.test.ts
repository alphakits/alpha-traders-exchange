import { describe, expect, it, vi } from "vitest";
import { AUTH_COOKIE_NAME, AUTH_PHONE_VERIFIED_COOKIE_NAME, AUTH_VERIFIED_COOKIE_NAME, expireAuthCookies } from "@/lib/auth";

describe("expireAuthCookies", () => {
  it("expires all authentication cookies with the auth cookie attributes", () => {
    const set = vi.fn();
    expireAuthCookies({ set }, true);

    expect(set).toHaveBeenCalledTimes(3);
    expect(set).toHaveBeenNthCalledWith(1, AUTH_COOKIE_NAME, "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: new Date(0),
    });
    expect(set).toHaveBeenNthCalledWith(2, AUTH_VERIFIED_COOKIE_NAME, "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: new Date(0),
    });
    expect(set).toHaveBeenNthCalledWith(3, AUTH_PHONE_VERIFIED_COOKIE_NAME, "", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: new Date(0),
    });
  });
});
