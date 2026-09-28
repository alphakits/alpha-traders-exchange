import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseRememberedLoginRequest } from "@alpha-traders/contracts";
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), clear: vi.fn() }));
import { handleRememberedLoginMessage, rememberedLoginReplyScript } from "./remembered-login-bridge";

const url = "https://www.alphatraders.co.il/en/login";
const request = { type: "alpha.web.remembered-login", version: 1, requestId: "00000000-1111-2222-3333-444444444444", action: "load" };
const credentials = { email: "buyer@example.test", password: " secret-\"password\"\n" };
beforeEach(() => { vi.resetAllMocks(); mocks.load.mockResolvedValue(credentials); });

describe("remembered login bridge security", () => {
  it.each(["https://attacker.example/en/login", "https://discord.com/en/login", "http://www.alphatraders.co.il/en/login", "https://www.alphatraders.co.il/en/usdt-exchange", "https://www.alphatraders.co.il/en/login/other"])("rejects credentials access from %s", async (source) => {
    expect(await handleRememberedLoginMessage(source, JSON.stringify(request), mocks)).toBeNull();
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("round-trips a private response only into the requesting login document", async () => {
    const response = await handleRememberedLoginMessage(url, JSON.stringify(request), mocks);
    expect(response?.credentials).toEqual(credentials);
    const script = rememberedLoginReplyScript(url, response!)!;
    const dispatchEvent = vi.fn();
    const target = { location: { href: url }, __alphaRememberedLoginRequestId: request.requestId, dispatchEvent, top: null as unknown };
    target.top = target;
    new Function("window", script)(target);
    expect(dispatchEvent.mock.calls[0]![0].detail.credentials).toEqual(credentials);
    dispatchEvent.mockClear();
    target.location.href = "https://discord.com/login";
    new Function("window", script)(target);
    expect(dispatchEvent).not.toHaveBeenCalled();
    target.location.href = url;
    target.__alphaRememberedLoginRequestId = "different-document-request";
    new Function("window", script)(target);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
  it("saves and clears through the secure store without returning passwords in acknowledgements", async () => {
    expect(await handleRememberedLoginMessage(url, { ...request, action: "save", credentials }, mocks)).toMatchObject({ status: "ok" });
    expect(mocks.save).toHaveBeenCalledWith(credentials);
    const response = await handleRememberedLoginMessage(url, { ...request, action: "clear" }, mocks);
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(response).not.toHaveProperty("credentials");
  });
  it("returns a safe failure without exposing storage errors", async () => {
    mocks.load.mockRejectedValue(new Error(`private data ${credentials.password}`));
    const response = await handleRememberedLoginMessage(url, request, mocks);
    expect(response?.status).toBe("failed");
    expect(JSON.stringify(response)).not.toContain("private data");
    expect(response).not.toHaveProperty("credentials");
  });
  it.each([{ ...request, version: 2 }, { ...request, requestId: "bad" }, { ...request, action: "save", credentials: { ...credentials, password: "x".repeat(257) } }, "x".repeat(5000)])("rejects malformed/oversized requests", value => {
    expect(parseRememberedLoginRequest(value)).toBeNull();
  });
});
