import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MobileNavigationMenu } from "@/components/layout/mobile-navigation-menu";

describe("MobileNavigationMenu", () => {
  it("closes immediately after a navigation item is selected", () => {
    render(
      <MobileNavigationMenu label="Open menu">
        <a href="https://example.com/academy">Academy</a>
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
    const trigger = screen.getByText("Open menu").closest("summary");
    expect(details).not.toBeNull();
    expect(trigger).not.toBeNull();
    details!.open = true;

    fireEvent.keyDown(document, { key: "Escape" });

    expect(details!.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
});
