import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), confirm: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiUser: mocks.auth }));
vi.mock("@/lib/alpha-exchange-store", () => ({ confirmAdultEligibility: mocks.confirm }));
vi.mock("@/lib/client-session-user", () => ({ toClientSessionUser: (user: unknown) => user }));
import { POST } from "@/app/api/auth/age-eligibility/route";
const request = (body: unknown) => new NextRequest("http://localhost/api/auth/age-eligibility", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  mocks.auth.mockReset().mockResolvedValue({ user: { id: "signed-in-user" }, unauthorized: null });
  mocks.confirm.mockReset().mockResolvedValue({ id: "signed-in-user", adultConfirmed: true });
});
it("binds the change to the session and ignores forged user IDs", async () => {
  const response = await POST(request({ confirmed: true, userId: "other-user" }));
  expect(response.status).toBe(200);
  expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith("signed-in-user", true);
  expect(response.headers.get("cache-control")).toContain("no-store");
});
it.each([false, null, "true", 1, undefined])("denies malformed adult confirmation %j", async confirmed => {
  expect((await POST(request({ confirmed }))).status).toBe(400);
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("requires an authenticated account", async () => {
  mocks.auth.mockResolvedValue({ user: null, unauthorized: new Response(null, { status: 401 }) });
  expect((await POST(request({ confirmed: true })))?.status).toBe(401);
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("does not report confirmation on a failed commit", async () => {
  mocks.confirm.mockRejectedValue(new Error("private database detail"));
  const response = await POST(request({ confirmed: true }));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private database detail");
});
