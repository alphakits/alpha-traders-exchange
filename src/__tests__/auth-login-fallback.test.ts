import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUserByEmail: vi.fn(),
}));

vi.mock("@/lib/alpha-exchange-store", () => ({
  createAuthSession: vi.fn(),
  deleteSessionByToken: vi.fn(),
  findUserByEmail: mocks.findUserByEmail,
  getAuthenticatedUserBySessionToken: vi.fn(),
}));

import { authenticateLocalUser, hashPassword } from "@/lib/auth";

describe("authenticateLocalUser", () => {
  beforeEach(() => {
    mocks.findUserByEmail.mockReset();
  });

  it("authenticates an isolated fictional account without repository credentials", async () => {
    const password = "SyntheticTestOnly!2026";
    const user = {
      id: "synthetic-auth-user",
      email: "synthetic-auth-user@example.test",
      passwordHash: await hashPassword(password),
      disabled: false,
    };
    mocks.findUserByEmail.mockResolvedValue(user);

    await expect(authenticateLocalUser(user.email, password)).resolves.toEqual(user);
    await expect(authenticateLocalUser(user.email, "IncorrectTestPassword")).resolves.toBeNull();
  });

  it("blocks disabled accounts unless authorization needs to revoke their session", async () => {
    const password = "SyntheticDisabledOnly!2026";
    const user = {
      id: "synthetic-disabled-user",
      email: "synthetic-disabled-user@example.test",
      passwordHash: await hashPassword(password),
      disabled: true,
    };
    mocks.findUserByEmail.mockResolvedValue(user);

    await expect(authenticateLocalUser(user.email, password)).resolves.toBeNull();
    await expect(authenticateLocalUser(user.email, password, { includeDisabled: true })).resolves.toEqual(user);
  });
});
