import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ secure: new Map<string, string>(), plain: new Map<string, string>(), setSecure: vi.fn(), setPlain: vi.fn() }));
vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only-unlocked",
  getItemAsync: async (key: string) => mocks.secure.get(key) ?? null,
  setItemAsync: mocks.setSecure,
  deleteItemAsync: async (key: string) => { mocks.secure.delete(key); },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: {
  getItem: async (key: string) => mocks.plain.get(key) ?? null,
  setItem: mocks.setPlain,
} }));
vi.mock("expo-crypto", () => ({ randomUUID: () => "test-device-id-0000001" }));

const key = "alpha.mobile.remembered-login.v1";
const credentials = { email: "buyer@example.test", password: "  secret-password  " };
beforeEach(() => {
  vi.resetModules();
  mocks.secure.clear(); mocks.plain.clear();
  mocks.plain.set("alpha.mobile.install.v1", "initialized");
  mocks.setSecure.mockReset().mockImplementation(async (key: string, value: string) => { mocks.secure.set(key, value); });
  mocks.setPlain.mockReset().mockImplementation(async (key: string, value: string) => { mocks.plain.set(key, value); });
});

describe("remembered app credentials", () => {
  it("survives five logout/reopen cycles using only device secure storage", async () => {
    let storage = await import("./session-storage");
    await storage.saveRememberedLogin({ ...credentials, email: " Buyer@Example.Test " });
    expect(mocks.setSecure).toHaveBeenCalledWith(key, JSON.stringify(credentials), { keychainAccessible: "device-only-unlocked" });
    for (let i = 0; i < 5; i++) {
      mocks.secure.set("alpha.mobile.session.v1", "session-token");
      await storage.clearStoredTokens();
      vi.resetModules();
      storage = await import("./session-storage");
      expect(await storage.loadRememberedLogin()).toEqual(credentials);
      expect(mocks.secure.has("alpha.mobile.session.v1")).toBe(false);
    }
    expect(mocks.setPlain).not.toHaveBeenCalled();
  });
  it("makes opting out win over an earlier in-flight save without revoking the session", async () => {
    const storage = await import("./session-storage");
    mocks.secure.set("alpha.mobile.session.v1", "current-session");
    await Promise.all([storage.saveRememberedLogin(credentials), storage.clearRememberedLogin()]);
    expect(await storage.loadRememberedLogin()).toBeNull();
    expect(mocks.secure.get("alpha.mobile.session.v1")).toBe("current-session");
  });
  it("replaces the remembered account only through an explicit save", async () => {
    const storage = await import("./session-storage");
    await storage.saveRememberedLogin(credentials);
    const changed = { email: "second@example.test", password: "changed-password" };
    await storage.saveRememberedLogin(changed);
    expect(await storage.loadRememberedLogin()).toEqual(changed);
  });
  it("clears old keychain credentials on a fresh installation", async () => {
    mocks.plain.clear(); mocks.secure.set(key, JSON.stringify(credentials));
    const storage = await import("./session-storage");
    expect(await storage.loadRememberedLogin()).toBeNull();
    expect(mocks.secure.has(key)).toBe(false);
  });
  it("removes corrupt saved records", async () => {
    mocks.secure.set(key, "invalid-json");
    const storage = await import("./session-storage");
    expect(await storage.loadRememberedLogin()).toBeNull();
    expect(mocks.secure.has(key)).toBe(false);
  });
  it("never falls back to plain storage when secure saving fails", async () => {
    const storage = await import("./session-storage");
    mocks.setSecure.mockRejectedValueOnce(new Error("locked"));
    await expect(storage.saveRememberedLogin(credentials)).rejects.toThrow("locked");
    expect(mocks.setPlain).not.toHaveBeenCalled();
    await storage.saveRememberedLogin(credentials);
    expect(await storage.loadRememberedLogin()).toEqual(credentials);
  });
});
