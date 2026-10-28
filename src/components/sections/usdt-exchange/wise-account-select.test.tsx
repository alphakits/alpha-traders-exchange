import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWiseAccounts, WiseAccountSelect, type WiseAccountSummary } from "./wise-account-select";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const account: WiseAccountSummary = { id: "draft-account", provider: "wise", currency: "USD", accountHolderName: "Draft Buyer", accountLast4: "0042", routingLast4: "1234", accountType: "checking", ownershipReviewStatus: "manually_reviewed" };

describe("Wise account selection and server capability", () => {
  it("renders masked ownership-reviewed selection and disables pending accounts", () => {
    render(<WiseAccountSelect locale="en" purpose="sending" value="" onChange={() => undefined} accounts={[account, { ...account, id: "pending", ownershipReviewStatus: "pending_review" }]} />);
    const options = screen.getAllByRole("option") as HTMLOptionElement[];
    expect(options.find(option => option.value === "pending")?.disabled).toBe(true);
    expect(options.find(option => option.value === account.id)?.textContent).toContain("****0042");
    expect(screen.getByText(/Platform ownership review/).textContent).toContain("does not mean Wise has approved");
    expect(screen.queryByLabelText(/transaction.*reason|purpose of transfer/i)).toBeNull();
  });
  it("shows the account-management path when no account has passed review", () => {
    render(<WiseAccountSelect locale="ar" purpose="receiving" value="" onChange={() => undefined} accounts={[{ ...account, ownershipReviewStatus: "rejected" }]} />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/ar/settings?tab=profile#wise-accounts");
  });
  it("does not expose accounts returned without an affirmative server capability", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ accounts: [account] }), { status: 200 })));
    const hook = renderHook(() => useWiseAccounts("buyer-a"));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.enabled).toBe(false);
    expect(hook.result.current.accounts).toEqual([]);
    expect(hook.result.current.mode).toBe("disabled");
  });
  it("uses the hosted mode only when the server explicitly enables it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ enabled: true, mode: "hosted", accounts: [account] }), { status: 200 })));
    const hook = renderHook(() => useWiseAccounts("buyer-a"));
    await waitFor(() => expect(hook.result.current.mode).toBe("hosted"));
    expect(hook.result.current.enabled).toBe(true);
    hook.unmount();
  });
  it.each(["disabled", "unknown"])("does not expose accounts for an inconsistent server mode: %s", async mode => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ enabled: true, mode, accounts: [account] }), { status: 200 })));
    const hook = renderHook(() => useWiseAccounts("buyer-a"));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.mode).toBe("disabled");
    expect(hook.result.current.accounts).toEqual([]);
  });
  it("clears the previous owner's data on account switch and ignores late responses", async () => {
    let resolveFirst!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true, accounts: [{ ...account, id: "buyer-b-account" }] }), { status: 200 })));
    const hook = renderHook(({ actorId }) => useWiseAccounts(actorId), { initialProps: { actorId: "buyer-a" } });
    hook.rerender({ actorId: "buyer-b" });
    await waitFor(() => expect(hook.result.current.accounts[0]?.id).toBe("buyer-b-account"));
    await act(async () => { resolveFirst(new Response(JSON.stringify({ enabled: true, accounts: [account] }), { status: 200 })); });
    expect(hook.result.current.accounts.map(item => item.id)).toEqual(["buyer-b-account"]);
    hook.rerender({ actorId: "" });
    expect(hook.result.current.accounts).toEqual([]);
    expect(hook.result.current.enabled).toBe(false);
  });
});
