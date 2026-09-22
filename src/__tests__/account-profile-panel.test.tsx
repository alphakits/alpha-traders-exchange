import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountProfilePanel } from "@/components/profile/account-profile-panel";
const state = vi.hoisted(() => ({ user: { id: "user-1" } as { id: string } | null, resolving: false, refresh: vi.fn(), onNotifications: () => {} }));
vi.mock("@/components/auth/canonical-session-provider", () => ({ useOptionalCanonicalSession: () => ({ user: state.user, isResolving: state.resolving, refresh: state.refresh }) }));
vi.mock("@/components/notifications/use-authenticated-notification-stream", () => ({ useAuthenticatedNotificationStream: ({ onNotifications }: { onNotifications: () => void }) => { state.onNotifications = onNotifications; } }));
vi.mock("next/image", () => ({ default: () => <span data-testid="next-image" /> }));
type TestRole = "guest" | "buyer" | "admin" | "owner";
function makePayload(role: TestRole) {
  return {
    profile: {
      id: "user-1",
      profilePhotoUrl: "",
      fullName: "Test User",
      username: "test-user",
      email: "test@example.com",
      role,
      roles: [role],
      memberSince: "2026-01-01T00:00:00.000Z",
      lastLogin: "2026-08-01T12:00:00.000Z",
      onlineStatus: "online" as const,
      bio: "",
      country: "",
      language: "English",
      whatsappNumber: "",
      showTradeStats: true,
      showLastActive: true,
      allowDirectMessages: true,
      allowProfileSearch: true,
      showPhonePublic: false,
      showEmailPublic: false,
    },
    stats: {
      kind: "buyer" as const,
      buyerLevel: "bronze" as const,
      nextLevel: "silver" as const,
      progressToNextLevelPercent: 13.33,
      amountToNextLevelUsdt: 13_000,
      requiredVolumeUsdt: 15_000,
      lifetimeCompletedVolumeUsdt: 2_000,
      activeTrades: 1,
      completedTrades: 2,
      reviewsGiven: 3,
    },
    roleBadge: role === "owner" ? "owner" : role === "admin" ? "administrator" : role,
    roleLabel: role === "owner" ? "Owner" : role === "admin" ? "Administrator" : role === "guest" ? "Guest" : "Buyer",
    accountStatuses: ["Active"],
  };
}


describe("AccountProfilePanel", () => {
  beforeEach(() => {
    state.user = { id: "user-1" }; state.resolving = false; state.refresh.mockReset();
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  function serve(payload = makePayload("buyer")) {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  it("shows only name, phone and bio with online status and one save action", async () => {
    serve(); render(<AccountProfilePanel locale="en" />);
    await screen.findByLabelText("Display name");
    expect(screen.getByLabelText("Phone number")).toBeTruthy();
    expect(screen.getByLabelText("Bio")).toBeTruthy();
    expect(screen.getByText("Online")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save info" })).toBeTruthy();
    expect(screen.queryByText(/Searchability|Public trading identity|Reputation board|Privacy controls/)).toBeNull();
    expect(screen.queryByLabelText("Country")).toBeNull();
    expect(screen.queryByRole("button", { name: "Upload photo" })).toBeNull();
  });
  it("selects an avatar through the picture picker and saves it with the form", async () => {
    const fetchMock = serve(); render(<AccountProfilePanel locale="en" />);
    fireEvent.click(await screen.findByRole("button", { name: "Choose profile picture" }));
    const picker = screen.getByRole("dialog", { name: "Choose your picture" });
    expect(within(picker).getByRole("button", { name: "Upload photo" })).toBeTruthy();
    fireEvent.click(within(picker).getByRole("button", { name: "nova" }));
    fireEvent.change(screen.getByLabelText("Bio"), { target: { value: "New bio" } });
    fireEvent.click(screen.getByRole("button", { name: "Save info" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/auth/profile", expect.objectContaining({ method: "PATCH", body: expect.stringContaining('"profilePhotoUrl":"/images/profile-presets/avatars/nova.svg"') })));
    const patch = fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH");
    expect(JSON.parse(patch?.[1].body)).toMatchObject({ bio: "New bio", showTradeStats: true, allowDirectMessages: true });
  });
  it("locks earned covers and allows the starter covers", async () => {
    serve(); render(<AccountProfilePanel locale="en" />);
    fireEvent.click(await screen.findByRole("button", { name: "Choose profile cover" }));
    const picker = screen.getByRole("dialog", { name: "Choose your cover" });
    expect((within(picker).getByRole("button", { name: /gold/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(picker).getByRole("button", { name: "network" }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(picker).queryByRole("button", { name: /Upload/ })).toBeNull();
  });
  it("refreshes rank unlocks without erasing an unsaved bio", async () => {
    const fetchMock = serve(); render(<AccountProfilePanel locale="en" />);
    fireEvent.change(await screen.findByLabelText("Bio"), { target: { value: "Unsaved draft" } });
    const promoted = makePayload("buyer");
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...promoted, stats: { ...promoted.stats, buyerLevel: "gold" } }) });
    act(() => state.onNotifications());
    await waitFor(() => expect(screen.getByText(/Gold ·/)).toBeTruthy());
    expect((screen.getByLabelText("Bio") as HTMLTextAreaElement).value).toBe("Unsaved draft");
    fireEvent.click(screen.getByRole("button", { name: "Choose profile cover" }));
    expect((screen.getByRole("button", { name: "gold" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("preserves drafts during a refresh of the same canonical session", async () => {
    const fetchMock = serve(); const view = render(<AccountProfilePanel locale="en" />);
    fireEvent.change(await screen.findByLabelText("Bio"), { target: { value: "Draft" } });
    state.resolving = true; view.rerender(<AccountProfilePanel locale="en" />);
    state.resolving = false; view.rerender(<AccountProfilePanel locale="en" />);
    expect((screen.getByLabelText("Bio") as HTMLTextAreaElement).value).toBe("Draft");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("clears private data when the session signs out", async () => {
    serve(); const view = render(<AccountProfilePanel locale="en" />);
    await screen.findByText("Test User"); state.user = null; view.rerender(<AccountProfilePanel locale="en" />);
    expect(screen.queryByText("Test User")).toBeNull();
    expect(screen.getByText("Your session has expired. Please sign in again.")).toBeTruthy();
  });
  it("shows a recoverable error when profile loading fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private provider details")));
    render(<AccountProfilePanel locale="en" />);
    await screen.findByText("Could not load your profile.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("private provider details")).toBeNull();
  });
  it("localizes photo errors inside the Arabic picker", async () => {
    const fetchMock = serve(); const { container } = render(<AccountProfilePanel locale="ar" />);
    fireEvent.click(await screen.findByRole("button", { name: "اختيار الصورة الشخصية" }));
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Unsupported private error" }) });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["image"], "photo.png", { type: "image/png" })] } });
    const picker = screen.getByRole("dialog");
    await waitFor(() => expect(within(picker).getByRole("alert").textContent).toContain("تعذر رفع الصورة"));
    expect(screen.queryByText("Unsupported private error")).toBeNull();
  });
});
