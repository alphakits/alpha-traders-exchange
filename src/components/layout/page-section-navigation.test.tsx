import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageSectionNavigation } from "./page-section-navigation";
import { CreateListingQuickLink } from "./create-listing-quick-link";
import { cancelPageSectionNavigation, navigateToPageSection, revealPageSection } from "@/lib/page-section-navigation";

const push = vi.fn();
let pathname = "/en/usdt-exchange";
let resized: () => void;
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => pathname.replace(/^\/(en|ar)/, ""),
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  push.mockReset();
  pathname = "/en/usdt-exchange";
  window.history.replaceState({}, "", pathname);
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resized = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => {
  cleanup();
  cancelPageSectionNavigation();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(32); }); };
const section = (id: string) => {
  const element = document.createElement("section");
  element.id = id;
  document.body.append(element);
  return element;
};

describe("first-click section navigation", () => {
  it.each(["en", "ar"])("reaches a delayed form on the first header click without leaving the seller workspace (%s)", async (locale) => {
    pathname = `/${locale}/dashboard/seller`;
    window.history.replaceState({ retained: true }, "", `${pathname}?sort=newest`);
    render(<CreateListingQuickLink label="Create Listing" className="" />);
    fireEvent.click(screen.getByRole("button", { name: /Create Listing/ }));
    expect(push).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?sort=newest");
    expect(window.history.state).toEqual({ retained: true });
    const form = section("create-listing");
    await settle();
    expect(document.activeElement).toBe(form);
    expect(form.scrollIntoView).toHaveBeenCalled();
  });

  it("navigates to the exact create destination from another page", () => {
    pathname = "/en/profile";
    render(<CreateListingQuickLink label="Create Listing" className="" />);
    fireEvent.click(screen.getByRole("button", { name: /Create Listing/ }));
    expect(push).toHaveBeenCalledExactlyOnceWith("/usdt-exchange#create-listing");
  });

  it("restores an incoming section after streamed content mounts", async () => {
    window.history.replaceState({}, "", "/en/usdt-exchange#create-listing");
    render(<PageSectionNavigation />);
    await settle();
    const form = section("create-listing");
    await settle();
    expect(document.activeElement).toBe(form);
  });

  it("keeps the selected form visible when content above it changes height", async () => {
    const form = section("create-listing");
    let top = 300;
    vi.spyOn(form, "getBoundingClientRect").mockImplementation(() => ({ top } as DOMRect));
    revealPageSection(form.id);
    vi.mocked(form.scrollIntoView).mockClear();
    top = 1300;
    resized();
    await settle();
    expect(form.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ behavior: "instant", block: "start" });
  });

  it("opens enclosing disclosures and the selected tool with one navigation", () => {
    document.body.innerHTML = '<details id="tools"><summary>Tools</summary><details id="price-alert"><summary>Price alert</summary><input /></details></details>';
    revealPageSection("price-alert");
    expect((document.getElementById("tools") as HTMLDetailsElement).open).toBe(true);
    expect((document.getElementById("price-alert") as HTMLDetailsElement).open).toBe(true);
    expect(document.activeElement?.id).toBe("price-alert");
  });

  it("honors same-page Next links even when history updates emit no hashchange", async () => {
    render(<><PageSectionNavigation /><a href="#price-alert" onClick={(event) => {
      event.preventDefault();
      window.history.pushState({}, "", "#price-alert");
    }}>Price alert</a></>);
    await settle();
    fireEvent.click(screen.getByRole("link"));
    const tool = section("price-alert");
    await settle();
    expect(document.activeElement).toBe(tool);
  });

  it("does not let an older pending action steal a newer destination", async () => {
    revealPageSection("create-listing");
    const next = section("purchase-requests-section");
    revealPageSection(next.id);
    const old = section("create-listing");
    const oldScroll = vi.fn();
    Object.defineProperty(old, "scrollIntoView", { value: oldScroll });
    await settle();
    expect(document.activeElement).toBe(next);
    expect(oldScroll).not.toHaveBeenCalled();
  });

  it("reveals a same-page notification destination after an imperative router push", async () => {
    navigateToPageSection({ push }, "/usdt-exchange#seller-listing-123");
    const listing = section("seller-listing-123");
    await settle();
    expect(push).toHaveBeenCalledExactlyOnceWith("/usdt-exchange#seller-listing-123");
    expect(document.activeElement).toBe(listing);
  });

  it.each(["/profile#create-listing", "/ar/usdt-exchange#create-listing", "/usdt-exchange?mode=sell#create-listing"])("leaves cross-page, locale, or query navigation to the router: %s", async (destination) => {
    const old = section("create-listing");
    navigateToPageSection({ push }, destination);
    await settle();
    expect(push).toHaveBeenCalledExactlyOnceWith(destination);
    expect(document.activeElement).not.toBe(old);
    expect(old.scrollIntoView).not.toHaveBeenCalled();
  });

  it.each(["pointerdown", "keydown", "wheel", "touchmove"])("stops restoring a destination after the user takes control with %s", async (event) => {
    revealPageSection("create-listing");
    document.dispatchEvent(new Event(event, { bubbles: true }));
    const form = section("create-listing");
    await settle();
    expect(document.activeElement).not.toBe(form);
    expect(form.scrollIntoView).not.toHaveBeenCalled();
  });

  it("discards pending focus when the user leaves the page", async () => {
    revealPageSection("create-listing");
    window.history.pushState({}, "", "/en/profile");
    const form = section("create-listing");
    await settle();
    expect(document.activeElement).not.toBe(form);
    expect(form.scrollIntoView).not.toHaveBeenCalled();
  });

  it("restores a replacement section without interrupting someone typing", async () => {
    const form = section("create-listing");
    revealPageSection(form.id);
    form.remove();
    const replacement = section("create-listing");
    await settle();
    expect(document.activeElement).toBe(replacement);
    const input = document.createElement("input");
    replacement.append(input);
    fireEvent.pointerDown(input);
    input.focus();
    resized();
    await settle();
    expect(document.activeElement).toBe(input);
  });
});
