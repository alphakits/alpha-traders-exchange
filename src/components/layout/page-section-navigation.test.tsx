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
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resized = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => {
  document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
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

  it.each(["en", "ar"])("honors the focused header action across a route transition and delayed form mount (%s)", async (locale) => {
    pathname = `/${locale}/trades`;
    window.history.replaceState({}, "", pathname);
    const ui = <><PageSectionNavigation /><CreateListingQuickLink label="Create Listing" className="" /></>;
    const view = render(ui);
    await settle();
    const button = screen.getByRole("button", { name: /Create Listing/ });
    button.focus();
    fireEvent.click(button);
    expect(push).toHaveBeenCalledExactlyOnceWith("/usdt-exchange#create-listing");
    pathname = `/${locale}/usdt-exchange`;
    window.history.pushState({}, "", `${pathname}#create-listing`);
    view.rerender(<><PageSectionNavigation /><CreateListingQuickLink label="Create Listing" className="" /></>);
    await settle();
    const form = section("create-listing");
    await settle();
    expect(document.activeElement).toBe(form);
    expect(form.scrollIntoView).toHaveBeenCalledWith({ behavior: "instant", block: "start" });
  });

  it.each(["pointerdown", "keydown", "wheel", "touchmove", "focusin"])("cancels a route request when a newer %s takes control", async (event) => {
    pathname = "/en/trades";
    window.history.replaceState({}, "", pathname);
    const ui = () => <><PageSectionNavigation /><CreateListingQuickLink label="Create Listing" className="" /><input aria-label="Newer input" /></>;
    const view = render(ui());
    await settle();
    const button = screen.getByRole("button", { name: /Create Listing/ });
    button.focus();
    fireEvent.click(button);
    if (event === "focusin") screen.getByRole("textbox", { name: "Newer input" }).focus();
    else document.dispatchEvent(new Event(event, { bubbles: true }));
    pathname = "/en/usdt-exchange";
    window.history.pushState({}, "", `${pathname}#create-listing`);
    view.rerender(ui());
    const form = section("create-listing");
    await settle();
    expect(document.activeElement).not.toBe(form);
    expect(form.scrollIntoView).not.toHaveBeenCalled();
  });

  it.each(["en", "ar"])("keeps an explicit request when the initiating header regains focus before restoration (%s)", async (locale) => {
    pathname = `/${locale}/trades`;
    window.history.replaceState({}, "", pathname);
    const ui = () => <><PageSectionNavigation /><CreateListingQuickLink label="Create Listing" className="" /></>;
    const view = render(ui());
    await settle();
    const button = screen.getByRole("button", { name: /Create Listing/ });
    button.focus();
    fireEvent.click(button);
    pathname = `/${locale}/usdt-exchange`;
    window.history.pushState({}, "", `${pathname}#create-listing`);
    view.rerender(ui());
    button.blur();
    button.focus();
    await settle();
    const form = section("create-listing");
    await settle();
    expect(document.activeElement).toBe(form);
  });

  it.each(["before effect", "before frame"])("keeps the requested section stable when router focus arrives %s", async (timing) => {
    pathname = "/en/trades";
    window.history.replaceState({}, "", pathname);
    const ui = () => <><PageSectionNavigation /><CreateListingQuickLink label="Create Listing" className="" /></>;
    const view = render(ui());
    await settle();
    const button = screen.getByRole("button", { name: /Create Listing/ });
    button.focus();
    fireEvent.click(button);
    pathname = "/en/usdt-exchange";
    window.history.pushState({}, "", `${pathname}#create-listing`);
    const initialForm = section("create-listing");
    initialForm.tabIndex = -1;
    if (timing === "before effect") initialForm.focus();
    view.rerender(ui());
    if (timing === "before frame") initialForm.focus();
    await settle();
    initialForm.remove();
    const hydratedForm = section("create-listing");
    await settle();
    expect(document.activeElement).toBe(hydratedForm);
  });

  it("yields to a focused input inside the destination instead of treating it as router section focus", async () => {
    pathname = "/en/trades";
    window.history.replaceState({}, "", pathname);
    const ui = () => <><PageSectionNavigation /><CreateListingQuickLink label="Create Listing" className="" /></>;
    const view = render(ui());
    await settle();
    const button = screen.getByRole("button", { name: /Create Listing/ });
    button.focus();
    fireEvent.click(button);
    pathname = "/en/usdt-exchange";
    window.history.pushState({}, "", `${pathname}#create-listing`);
    const form = section("create-listing");
    const input = document.createElement("input");
    form.append(input);
    view.rerender(ui());
    input.focus();
    await settle();
    expect(document.activeElement).toBe(input);
    expect(form.scrollIntoView).not.toHaveBeenCalled();
  });

  it.each(["/ar/usdt-exchange#create-listing", "/en/usdt-exchange?mode=sell#create-listing", "/en/usdt-exchange#my-listings-section"])("does not carry a header request to an unrequested destination: %s", async (destination) => {
    pathname = "/en/trades";
    window.history.replaceState({}, "", pathname);
    const ui = () => <><PageSectionNavigation /><CreateListingQuickLink label="Create Listing" className="" /></>;
    const view = render(ui());
    await settle();
    const button = screen.getByRole("button", { name: /Create Listing/ });
    button.focus();
    fireEvent.click(button);
    window.history.pushState({}, "", destination);
    pathname = window.location.pathname;
    view.rerender(ui());
    const form = section("create-listing");
    section("my-listings-section");
    await settle();
    expect(document.activeElement).toBe(button);
    expect(form.scrollIntoView).not.toHaveBeenCalled();
  });

  it.each(["popstate", "hashchange"])("cancels an uncommitted route request when browser history changes (%s)", async (event) => {
    pathname = "/en/trades";
    window.history.replaceState({}, "", pathname);
    const ui = () => <><PageSectionNavigation /><CreateListingQuickLink label="Create Listing" className="" /></>;
    const view = render(ui());
    await settle();
    const button = screen.getByRole("button", { name: /Create Listing/ });
    button.focus();
    fireEvent.click(button);
    window.dispatchEvent(new Event(event));
    pathname = "/en/usdt-exchange";
    window.history.pushState({}, "", `${pathname}#create-listing`);
    view.rerender(ui());
    const form = section("create-listing");
    await settle();
    expect(document.activeElement).toBe(button);
    expect(form.scrollIntoView).not.toHaveBeenCalled();
  });

  it("expires an uncommitted route request without stealing later focus", async () => {
    pathname = "/en/trades";
    window.history.replaceState({}, "", pathname);
    const ui = () => <><PageSectionNavigation /><CreateListingQuickLink label="Create Listing" className="" /></>;
    const view = render(ui());
    await settle();
    const button = screen.getByRole("button", { name: /Create Listing/ });
    button.focus();
    fireEvent.click(button);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_001); });
    pathname = "/en/usdt-exchange";
    window.history.pushState({}, "", `${pathname}#create-listing`);
    view.rerender(ui());
    const form = section("create-listing");
    await settle();
    expect(document.activeElement).toBe(button);
    expect(form.scrollIntoView).not.toHaveBeenCalled();
  });

  it("honors an explicit cross-page link while preserving its source focus", async () => {
    pathname = "/en/trades";
    window.history.replaceState({}, "", pathname);
    const view = render(<PageSectionNavigation />);
    await settle();
    const link = document.createElement("a");
    link.href = "/en/usdt-exchange#create-listing";
    link.textContent = "Create listing";
    link.addEventListener("click", event => event.preventDefault());
    document.body.append(link);
    link.focus();
    fireEvent.click(link);
    pathname = "/en/usdt-exchange";
    window.history.pushState({}, "", `${pathname}#create-listing`);
    view.rerender(<PageSectionNavigation />);
    const form = section("create-listing");
    await settle();
    expect(document.activeElement).toBe(form);
  });

  it("restores an incoming section after streamed content mounts", async () => {
    window.history.replaceState({}, "", "/en/usdt-exchange#create-listing");
    render(<PageSectionNavigation />);
    await settle();
    const form = section("create-listing");
    await settle();
    expect(document.activeElement).toBe(form);
  });

  it.each(["pointerdown", "keydown", "wheel", "touchmove", "focusin"])("keeps newer interaction in control before initial hash restoration runs (%s)", async (event) => {
    window.history.replaceState({}, "", "/en/profile#notification-preferences");
    const preferences = section("notification-preferences");
    render(<><PageSectionNavigation /><button role="tab">Alerts</button></>);
    const tab = screen.getByRole("tab", { name: "Alerts" });
    fireEvent(tab, new Event(event, { bubbles: true }));
    tab.focus();
    await settle();
    expect(document.activeElement).toBe(tab);
    expect(preferences.scrollIntoView).not.toHaveBeenCalled();
  });

  it("preserves focus chosen before the navigation restorer hydrates", async () => {
    window.history.replaceState({}, "", "/en/profile#notification-preferences");
    const preferences = section("notification-preferences");
    const tab = document.createElement("button");
    document.body.append(tab);
    tab.focus();
    render(<PageSectionNavigation />);
    await settle();
    expect(document.activeElement).toBe(tab);
    expect(preferences.scrollIntoView).not.toHaveBeenCalled();
  });

  it("still honors explicit history navigation after the user cancels initial restoration", async () => {
    window.history.replaceState({}, "", "/en/profile#notification-preferences");
    section("notification-preferences");
    const contact = section("contact-details");
    render(<><PageSectionNavigation /><button role="tab">Alerts</button></>);
    const tab = screen.getByRole("tab", { name: "Alerts" });
    tab.focus();
    await settle();
    expect(document.activeElement).toBe(tab);
    window.history.replaceState({}, "", "/en/profile#contact-details");
    fireEvent(window, new PopStateEvent("popstate"));
    expect(document.activeElement).toBe(contact);
  });

  it("keeps a first workspace action pending while the initial empty-hash restoration settles", async () => {
    render(<PageSectionNavigation />);
    revealPageSection("my-listings-section");
    await settle();
    const listings = section("my-listings-section");
    await settle();
    expect(document.activeElement).toBe(listings);
    expect(listings.scrollIntoView).toHaveBeenCalled();
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

  it.each(["pointerdown", "keydown", "wheel", "touchmove"])("settles the viewport before focus and yields to the next %s", async (event) => {
    const form = section("create-listing");
    vi.stubGlobal("scrollX", 20);
    vi.stubGlobal("scrollY", 350);
    revealPageSection(form.id);
    expect(form.scrollIntoView).toHaveBeenCalledWith({ behavior: "instant", block: "start" });
    expect(document.activeElement).toBe(form);
    const interaction = new Event(event, { bubbles: true, cancelable: true });
    document.dispatchEvent(interaction);
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(interaction.defaultPrevented).toBe(false);
    vi.mocked(form.scrollIntoView).mockClear();
    await settle();
    expect(form.scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not interrupt viewport scrolling when no smooth section scroll was started", () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const form = section("create-listing");
    revealPageSection(form.id);
    expect(form.scrollIntoView).toHaveBeenCalledWith({ behavior: "instant", block: "start" });
    document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(window.scrollTo).not.toHaveBeenCalled();
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
