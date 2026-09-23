import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/components/auth/canonical-session-provider", () => ({
  useCanonicalSession: () => ({ user: { id: "signed-in-user" }, isResolving: false }),
}));
vi.mock("@/lib/native-app-bridge", () => ({ postToNativeApp: mocks.post }));

import { NativeAppBridge } from "./native-app-bridge";

describe("native session reset before logout navigation", () => {
  beforeEach(() => { mocks.post.mockReset(); });
  afterEach(cleanup);

  it("sends English logout synchronously without waiting for a React render", () => {
    render(<NativeAppBridge locale="ar" />);
    expect(mocks.post).toHaveBeenLastCalledWith(expect.objectContaining({ authenticated: true, locale: "ar" }));
    mocks.post.mockClear();
    window.dispatchEvent(new Event("alpha-auth-signed-out"));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith({
      type: "alpha.web.session", version: 1, authenticated: false, locale: "en",
    });
  });

  it("removes the logout listener when the document bridge unmounts", () => {
    const page = render(<NativeAppBridge locale="ar" />);
    page.unmount();
    mocks.post.mockClear();
    window.dispatchEvent(new Event("alpha-auth-signed-out"));
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
