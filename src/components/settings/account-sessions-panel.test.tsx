import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountSessionsPanel } from "./account-sessions-panel";
const session = { id: "a".repeat(32), deviceLabel: "iOS · Safari", createdAt: "2026-10-04T01:00:00Z", expiresAt: "2026-10-18T01:00:00Z", isCurrent: false };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("owned-session controls", () => {
  it("does not render session information for an unexpected account", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ownerId: "another", sessions: [session] })));
    render(<AccountSessionsPanel userId="buyer-a" isAr={false} />);
    await screen.findByText(/Could not load sessions/); expect(screen.queryByText("iOS · Safari")).toBeNull();
  });
  it("requires reloading when sign-out cannot be confirmed", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ ownerId: "buyer-a", sessions: [session] }))).mockRejectedValue(new Error("lost response"));
    render(<AccountSessionsPanel userId="buyer-a" isAr={false} />);
    const button = await screen.findByRole("button", { name: "Sign out session" });
    fireEvent.click(button); fireEvent.click(button);
    await screen.findByText(/Sign-out could not be confirmed/); expect(fetch).toHaveBeenCalledTimes(2); expect(screen.queryByText("iOS · Safari")).toBeNull(); expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });
  it("only removes a session after the server confirms its identifier", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ ownerId: "buyer-a", sessions: [session] }))).mockResolvedValue(new Response(JSON.stringify({ ownerId: "buyer-a", revokedId: session.id, currentSessionRevoked: false })));
    render(<AccountSessionsPanel userId="buyer-a" isAr={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out session" }));
    await screen.findByText("Session signed out."); expect(screen.queryByText("iOS · Safari")).toBeNull();
  });
  it("discards delayed device data from the previous account", async () => {
    let finish!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(new Response(JSON.stringify({ ownerId: "buyer-b", sessions: [] })));
    const { rerender } = render(<AccountSessionsPanel key="a" userId="buyer-a" isAr={false} />);
    rerender(<AccountSessionsPanel key="b" userId="buyer-b" isAr={false} />);
    await waitFor(() => expect(screen.getByText(/No active sessions found/)).toBeTruthy());
    await act(async () => { finish(new Response(JSON.stringify({ ownerId: "buyer-a", sessions: [session] }))); }); expect(screen.queryByText("iOS · Safari")).toBeNull();
  });
});
