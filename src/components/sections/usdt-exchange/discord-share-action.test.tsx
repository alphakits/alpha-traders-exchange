import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DiscordShareAction,
  formatDiscordShareCountdown,
} from "@/components/sections/usdt-exchange/discord-share-action";
import type { MarketplaceListing } from "@/types/alpha-exchange";

const listing: MarketplaceListing = {
  id: "listing-1",
  sellerId: "seller-1",
  sellerDisplayName: "Seller",
  photos: [],
  originalAmount: "500",
  availableAmount: "500",
  price: "3.45",
  currency: "ILS",
  network: "TRC20",
  paymentMethod: "Bank Transfer",
  paymentMethods: ["Bank Transfer"],
  minimumTrade: "50",
  maximumTrade: "500",
  sellerDescription: "",
  responseTime: "5 min",
  status: "active",
  approvalStatus: "approved",
  expiresAt: "2026-08-09T00:00:00.000Z",
  createdAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:00.000Z",
};

function sharing(overrides: Record<string, unknown> = {}) {
  return {
    serverTime: "2026-08-08T00:00:00.000Z",
    nextEligibleAt: null,
    cooldownSecondsRemaining: 0,
    linked: true,
    available: true,
    listings: [],
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-08T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Discord Share action", () => {
  it("formats compact exact-boundary countdowns", () => {
    expect(formatDiscordShareCountdown(43_200)).toBe("12h 0m");
    expect(formatDiscordShareCountdown(43_020)).toBe("11h 57m");
    expect(formatDiscordShareCountdown(60)).toBe("1m");
    expect(formatDiscordShareCountdown(1)).toBe("<1m");
    expect(formatDiscordShareCountdown(0)).toBe("now");
  });

  it.each([320, 390, 430, 1280])(
    "keeps a 44px full-width mobile target without overflow at %ipx",
    (width) => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
      const onShare = vi.fn();
      const { container } = render(
        <DiscordShareAction
          listing={listing}
          sharing={sharing()}
          busy={false}
          onShare={onShare}
        />,
      );

      const button = screen.getByRole("button", { name: /Share to Discord/i });
      expect(button.className).toContain("min-h-11");
      expect(button.className).toContain("w-full");
      expect(container.firstElementChild?.className).toContain("w-full");
      fireEvent.click(button);
      expect(onShare).toHaveBeenCalledWith(listing);
    },
  );

  it("shows Shared with an accessible server-time Next Share countdown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T00:00:00.000Z"));
    render(
      <DiscordShareAction
        listing={listing}
        sharing={sharing({
          nextEligibleAt: "2026-08-08T12:00:00.000Z",
          cooldownSecondsRemaining: 43_200,
          listings: [{
            listingId: listing.id,
            state: "active",
            publishedAt: "2026-08-08T00:00:00.000Z",
            updatedAt: "2026-08-08T00:00:00.000Z",
            errorCode: null,
          }],
        })}
        busy={false}
        onShare={vi.fn()}
      />,
    );

    expect((screen.getByRole("button", { name: "Shared" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("timer").textContent).toBe("Next Share 12h 0m");
    act(() => vi.advanceTimersByTime(181_000));
    expect(screen.getByRole("timer").textContent).toBe("Next Share 11h 56m");
  });

  it("uses one shared clock for multiple listing countdowns", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T00:00:00.000Z"));
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const cooldown = sharing({
      nextEligibleAt: "2026-08-08T12:00:00.000Z",
      cooldownSecondsRemaining: 43_200,
    });
    const { unmount } = render(
      <>
        <DiscordShareAction listing={listing} sharing={cooldown} busy={false} onShare={vi.fn()} />
        <DiscordShareAction
          listing={{ ...listing, id: "listing-2" }}
          sharing={cooldown}
          busy={false}
          onShare={vi.fn()}
        />
      </>,
    );

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button", { name: "Next Share 12h 0m" })).toHaveLength(2);
    unmount();
    setIntervalSpy.mockRestore();
  });

  it("does not freeze disabled after an expiry-adjacent rerender", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T00:00:00.000Z"));
    const expiring = sharing({
      nextEligibleAt: "2026-08-08T00:00:01.500Z",
      cooldownSecondsRemaining: 2,
    });
    const { rerender } = render(
      <DiscordShareAction
        listing={listing}
        sharing={expiring}
        busy={false}
        onShare={vi.fn()}
      />,
    );

    act(() => vi.advanceTimersByTime(1_600));
    rerender(
      <DiscordShareAction
        listing={listing}
        sharing={expiring}
        busy={false}
        onShare={vi.fn()}
      />,
    );

    expect((screen.getByRole("button", { name: "Share to Discord" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("distinguishes accepted processing, published, update pending, failure, and ineligible states", () => {
    const { rerender } = render(
      <DiscordShareAction
        listing={listing}
        sharing={sharing({
          listings: [{
            listingId: listing.id,
            state: "queued",
            publishedAt: null,
            updatedAt: "2026-08-08T00:00:00.000Z",
            errorCode: null,
          }],
        })}
        busy={false}
        onShare={vi.fn()}
      />,
    );
    expect((screen.getByRole("button", { name: "Publishing to Discord..." }) as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <DiscordShareAction
        listing={listing}
        sharing={sharing({
          listings: [{
            listingId: listing.id,
            state: "update_pending",
            publishedAt: "2026-08-08T00:00:00.000Z",
            updatedAt: "2026-08-08T00:01:00.000Z",
            errorCode: null,
          }],
        })}
        busy={false}
        onShare={vi.fn()}
      />,
    );
    expect((screen.getByRole("button", { name: "Discord update pending" }) as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <DiscordShareAction
        listing={listing}
        sharing={sharing({
          listings: [{
            listingId: listing.id,
            state: "failed",
            publishedAt: null,
            updatedAt: "2026-08-08T00:01:00.000Z",
            errorCode: "discord_api_failure",
          }],
        })}
        busy={false}
        onShare={vi.fn()}
      />,
    );
    expect((screen.getByRole("button", { name: "Discord delivery needs support" }) as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <DiscordShareAction
        listing={{ ...listing, status: "paused" }}
        sharing={sharing()}
        busy={false}
        onShare={vi.fn()}
      />,
    );
    expect((screen.getByRole("button", { name: "Listing ineligible" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
