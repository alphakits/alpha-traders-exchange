import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const gateway = {
    subscribe: vi.fn(() => vi.fn()),
    subscribeGuildMemberJoin: vi.fn(() => vi.fn()),
    subscribeInteraction: vi.fn(() => vi.fn()),
    login: vi.fn(),
    isReady: vi.fn(() => false),
    getIdentity: vi.fn(() => null),
    fetchGuild: vi.fn(),
    getLatencyMs: vi.fn(() => null),
    destroy: vi.fn(),
  };
  return {
    gateway,
    constructor: vi.fn(function DiscordJsGatewayClientMock() {
      return gateway;
    }),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/discord/gateway-client", () => ({
  DiscordJsGatewayClient: mocks.constructor,
}));

describe("Discord process singleton", () => {
  afterEach(() => {
    delete (globalThis as typeof globalThis & {
      __alphaDiscordService?: unknown;
      __alphaDiscordGateway?: unknown;
    }).__alphaDiscordService;
    delete (globalThis as typeof globalThis & {
      __alphaDiscordGateway?: unknown;
    }).__alphaDiscordGateway;
    vi.resetModules();
  });

  it("reuses one client and service across a simulated hot reload", async () => {
    const firstModule = await import("@/lib/discord");
    const first = firstModule.getDiscordService();

    vi.resetModules();
    const reloadedModule = await import("@/lib/discord");
    const second = reloadedModule.getDiscordService();

    expect(first).toBe(second);
    expect(mocks.constructor).toHaveBeenCalledTimes(1);
    expect(mocks.gateway.subscribe).toHaveBeenCalledTimes(1);
  });
});
