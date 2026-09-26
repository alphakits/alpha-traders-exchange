import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), role: vi.fn(), disable: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireApiOwner: mocks.auth }));
vi.mock("@/lib/alpha-exchange-store", () => ({ changeUserRoleByAdmin: mocks.role, disableUserAccountByAdmin: mocks.disable }));
import { POST as role } from "@/app/api/alpha-exchange/admin/users/[userId]/role/route";
import { POST as disable } from "@/app/api/alpha-exchange/admin/users/[userId]/disable/route";
const context = { params: Promise.resolve({ userId: "target" }) };
const request = (body: unknown) => new NextRequest("http://localhost/api/owner", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner" }, unauthorized: null });
});
describe.each([
  { name: "role", route: role, mutation: mocks.role, valid: { role: "buyer", reason: "Test" }, invalid: { role: "owner", reason: "Test" } },
  { name: "disable", route: disable, mutation: mocks.disable, valid: { disabled: false, reason: "Test" }, invalid: { disabled: "false", reason: "Test" } },
])("$name command boundary", ({ route, mutation, valid, invalid }) => {
  it("marks rejected input only before store mutation", async () => {
    const response = await route(request(invalid), context);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "owner_command_validation", commandOutcome: "rejected", mutationAttempted: false });
    expect(mutation).not.toHaveBeenCalled();
  });
  it("does not claim rollback when the store throws after entry", async () => {
    mutation.mockRejectedValue(new Error("Response lost after persistence"));
    const response = await route(request(valid), context);
    expect(await response.json()).toMatchObject({ commandOutcome: "unknown", mutationAttempted: true });
    expect(mutation).toHaveBeenCalledOnce();
  });
  it("authorizes before parsing or mutation", async () => {
    mocks.auth.mockResolvedValue({ user: null, unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    expect((await route(request(valid), context)).status).toBe(401);
    expect(mutation).not.toHaveBeenCalled();
  });
  it("sends validated values with the server owner identity exactly once", async () => {
    expect((await route(request(valid), context)).status).toBe(200);
    expect(mutation).toHaveBeenCalledExactlyOnceWith({ ...valid, userId: "target", actorUserId: "owner" });
  });
});
