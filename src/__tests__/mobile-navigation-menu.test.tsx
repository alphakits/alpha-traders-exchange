import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Link from "next/link";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileNavigationMenu } from "@/components/layout/mobile-navigation-menu";

afterEach(cleanup);

describe("MobileNavigationMenu", () => {
  it("reveals a clipped active link inside the menu on open without moving focus", () => {
    render(<MobileNavigationMenu label="Open menu"><Link href="/en/usdt-exchange/requests" aria-current="page">Buy Requests</Link></MobileNavigationMenu>);
    const link = screen.getByText("Buy Requests");
    const panel = link.parentElement!;
    const details = link.closest("details")!;
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 58, 288, 128));
    vi.spyOn(link, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 168, 260, 44));
    const trigger = screen.getByLabelText("Open menu");
    trigger.focus();
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(panel.scrollTop).toBe(68);
    expect(document.activeElement).toBe(trigger);
    details.open = false;
    fireEvent(details, new Event("toggle"));
    expect(panel.scrollTop).toBe(68);
  });

  it("closes immediately after a navigation item is selected", () => {
    render(
      <MobileNavigationMenu label="Open menu">
        {/* jsdom cannot navigate documents; this fixture tests menu dismissal. */}
        <a href="https://example.com/academy" onClick={(event) => event.preventDefault()}>Academy</a>
      </MobileNavigationMenu>,
    );

    const details = screen.getByText("Academy").closest("details");
    expect(details).not.toBeNull();
    details!.open = true;

    fireEvent.click(screen.getByRole("link", { name: "Academy" }));

    expect(details!.open).toBe(false);
  });

  it("closes on Escape and returns focus to the menu trigger", () => {
    render(
      <MobileNavigationMenu label="Open menu">
        <a href="https://example.com/academy">Academy</a>
      </MobileNavigationMenu>,
    );

    const details = screen.getByText("Academy").closest("details");
    const trigger = screen.getByLabelText("Open menu");
    expect(details).not.toBeNull();
    expect(trigger).not.toBeNull();
    details!.open = true;

    fireEvent.keyDown(document, { key: "Escape" });

    expect(details!.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps the menu open while moving within it, then closes when keyboard focus leaves", () => {
    render(<><MobileNavigationMenu label="Open menu"><a href="https://example.com/requests">Buy Requests</a></MobileNavigationMenu><button>Outside</button></>);
    const link = screen.getByRole("link", { name: "Buy Requests" });
    const details = link.closest("details")!;
    details.open = true;
    fireEvent.blur(screen.getByLabelText("Open menu"), { relatedTarget: link });
    expect(details.open).toBe(true);
    fireEvent.blur(link, { relatedTarget: screen.getByRole("button", { name: "Outside" }) });
    expect(details.open).toBe(false);
  });

  it("allows touches inside the menu and dismisses it on an outside touch", () => {
    render(<><MobileNavigationMenu label="Open menu"><a href="https://example.com/requests">Buy Requests</a></MobileNavigationMenu><button>Outside</button></>);
    const link = screen.getByRole("link", { name: "Buy Requests" });
    const details = link.closest("details")!;
    details.open = true;
    fireEvent.pointerDown(link, { pointerType: "touch" });
    expect(details.open).toBe(true);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }), { pointerType: "touch" });
    expect(details.open).toBe(false);
  });
});
