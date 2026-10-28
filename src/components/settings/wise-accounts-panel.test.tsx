import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WiseAccountsPanel } from "./wise-accounts-panel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("private Wise account draft settings", () => {
  const privateAccount = { id: "other-account", userId: "other-user", reviewVersion: "a".repeat(64), accountHolderName: "Other Draft Buyer", bankName: "Synthetic Bank", routingNumber: "021000021", accountNumber: "00012340042", accountType: "checking" };
  const accountResponse = () => new Response(JSON.stringify({ enabled: true, accounts: [] }), { status: 200 });

  it.each(["en", "ar"] as const)("offers a private, localized retry after account loading fails (%s)", async locale => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("Connection unavailable"))
      .mockImplementation(async () => accountResponse());
    vi.stubGlobal("fetch", fetchMock);
    render(<WiseAccountsPanel locale={locale} actorId="buyer" />);
    const retry = await screen.findByRole("button", { name: locale === "ar" ? "إعادة المحاولة" : "Try again" });
    expect(screen.getByRole("status").textContent).toBe(locale === "ar"
      ? "تعذر تحميل الحسابات. حاول مرة أخرى قبل المتابعة."
      : "Unable to load Wise accounts. Try again before continuing.");
    expect(screen.getByRole("region").getAttribute("dir")).toBe(locale === "ar" ? "rtl" : "ltr");
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(retry);
    await screen.findByRole("button", { name: locale === "ar" ? "حفظ للمراجعة" : "Save for review" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores an older review load after a newer review has already opened", async () => {
    let finishOlderRead!: (response: Response) => void;
    const olderRead = new Promise<Response>(resolve => { finishOlderRead = resolve; });
    const currentAccount = { ...privateAccount, id: "current-account", reviewVersion: "b".repeat(64), accountNumber: "00012340099" };
    let reviewReads = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (!url.includes("admin/")) return Promise.resolve(accountResponse());
      reviewReads += 1;
      return reviewReads === 1 ? olderRead : Promise.resolve(new Response(JSON.stringify({ accounts: [currentAccount] }), { status: 200 }));
    }));
    render(<WiseAccountsPanel locale="en" actorId="reviewer" canReview />);
    const open = await screen.findByRole("button", { name: "Open ownership reviews" });
    fireEvent.click(open);
    fireEvent.click(open);
    const select = await screen.findByLabelText("Account to review");
    fireEvent.change(select, { target: { value: currentAccount.id } });
    expect(screen.getByText(currentAccount.accountNumber)).toBeTruthy();
    await act(async () => { finishOlderRead(new Response(JSON.stringify({ accounts: [privateAccount] }), { status: 200 })); });
    expect(screen.getByText(currentAccount.accountNumber)).toBeTruthy();
    expect(screen.queryByText(privateAccount.accountNumber)).toBeNull();
  });

  it("distinguishes hosted account storage from the local demo without claiming provider approval", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ enabled: true, mode: "hosted", accounts: [] }), { status: 200 })));
    render(<WiseAccountsPanel locale="en" actorId="buyer" />);
    expect(await screen.findByText(/Enter your own personal USD account details/)).toBeTruthy();
    expect(screen.getByText(/Wise's published policy does not support P2P cryptocurrency payments/)).toBeTruthy();
    expect(screen.queryByText(/Local test draft only/)).toBeNull();
    expect(screen.queryByLabelText(/reason|purpose/i)).toBeNull();
  });

  it.each(["identity", "permissions"])("discards delayed private reviews after the %s scope changes", async (change) => {
    let finishReview!: (response: Response) => void;
    const pendingReview = new Promise<Response>(resolve => { finishReview = resolve; });
    const fetchMock = vi.fn().mockImplementation((url: string) => url.includes("admin/") ? pendingReview : Promise.resolve(accountResponse()));
    vi.stubGlobal("fetch", fetchMock);
    const panel = render(<WiseAccountsPanel locale="en" actorId="reviewer-a" canReview />);
    fireEvent.click(await screen.findByRole("button", { name: "Open ownership reviews" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(call => call[0].includes("admin/"))).toBe(true));

    if (change === "identity") {
      panel.rerender(<WiseAccountsPanel locale="en" actorId="reviewer-b" canReview />);
    } else {
      panel.rerender(<WiseAccountsPanel locale="en" actorId="reviewer-a" canReview={false} />);
      panel.rerender(<WiseAccountsPanel locale="en" actorId="reviewer-a" canReview />);
    }
    await screen.findByRole("button", { name: "Open ownership reviews" });
    await act(async () => { finishReview(new Response(JSON.stringify({ accounts: [privateAccount] }), { status: 200 })); });
    expect(screen.queryByLabelText("Account to review")).toBeNull();
    expect(screen.queryByText(privateAccount.accountHolderName)).toBeNull();
    expect(screen.queryByText(privateAccount.accountNumber)).toBeNull();
  });

  it("does not reload private reviews under a new session when an old review finishes", async () => {
    let finishMutation!: (response: Response) => void;
    const pendingMutation = new Promise<Response>(resolve => { finishMutation = resolve; });
    let reviewReads = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return pendingMutation;
      if (url.includes("admin/")) {
        reviewReads += 1;
        return Promise.resolve(new Response(JSON.stringify({ accounts: [privateAccount] }), { status: 200 }));
      }
      return Promise.resolve(accountResponse());
    });
    vi.stubGlobal("fetch", fetchMock);
    const panel = render(<WiseAccountsPanel locale="en" actorId="reviewer-a" canReview />);
    fireEvent.click(await screen.findByRole("button", { name: "Open ownership reviews" }));
    fireEvent.change(await screen.findByLabelText("Account to review"), { target: { value: privateAccount.id } });
    fireEvent.change(screen.getByLabelText("Private evidence record reference"), { target: { value: "private-evidence" } });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(call => call[1]?.method === "PATCH")).toBe(true));
    panel.rerender(<WiseAccountsPanel locale="en" actorId="reviewer-b" canReview />);
    await screen.findByRole("button", { name: "Open ownership reviews" });
    await act(async () => { finishMutation(new Response("{}", { status: 200 })); });
    expect(reviewReads).toBe(1);
    expect(screen.queryByText("Change saved.")).toBeNull();
    expect(screen.queryByLabelText("Account to review")).toBeNull();
  });

  it("renders nothing when the server disables the draft", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: false, accounts: [] }), { status: 200 })));
    const { container } = render(<WiseAccountsPanel locale="en" actorId="buyer" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
  it("validates USD details and submits ownership-pending input without transaction-purpose or approval fields", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ enabled: true, accounts: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WiseAccountsPanel locale="en" actorId="buyer" />);
    await screen.findByRole("heading", { name: "Personal Wise accounts · USD" });
    fireEvent.change(screen.getByLabelText("Legal account holder name"), { target: { value: "Draft Buyer" } });
    fireEvent.change(screen.getByLabelText("Bank name shown in Wise"), { target: { value: "Synthetic Bank" } });
    fireEvent.change(screen.getByLabelText("ACH routing number (9 digits)"), { target: { value: "021000022" } });
    fireEvent.change(screen.getByLabelText("Account number"), { target: { value: "00012340042" } });
    fireEvent.click(screen.getByRole("button", { name: "Save for review" }));
    expect(screen.getByText(/Enter a valid 9-digit ACH routing/)).toBeTruthy();
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("ACH routing number (9 digits)"), { target: { value: "021000021" } });
    fireEvent.click(screen.getByRole("button", { name: "Save for review" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(call => call[1]?.method === "POST")).toBe(true));
    const sent = JSON.parse(fetchMock.mock.calls.find(call => call[1]?.method === "POST")![1].body);
    expect(sent).toEqual({ provider: "wise", currency: "USD", countryCode: "US", accountHolderType: "personal", accountHolderName: "Draft Buyer", bankName: "Synthetic Bank", routingNumber: "021000021", accountNumber: "00012340042", accountType: "checking" });
    expect(screen.queryByLabelText(/reason|purpose|IBAN/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Open ownership reviews" })).toBeNull();
  });
  it("allows authorized manual review only after evidence and identity attestations", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes("admin/")
      ? { accounts: [{ id: "other-account", userId: "other-user", reviewVersion: "a".repeat(64), accountHolderName: "Other Draft Buyer", bankName: "Synthetic Bank", routingNumber: "021000021", accountNumber: "00012340042", accountType: "checking" }] }
      : { enabled: true, accounts: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WiseAccountsPanel locale="en" actorId="reviewer" canReview />);
    fireEvent.click(await screen.findByRole("button", { name: "Open ownership reviews" }));
    fireEvent.change(await screen.findByLabelText("Account to review"), { target: { value: "other-account" } });
    const approve = screen.getByRole("button", { name: "Approve ownership review" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Legal name verified in the evidence"), { target: { value: "Other Draft Buyer" } });
    fireEvent.change(screen.getByLabelText("Private evidence record reference"), { target: { value: "private-review-fixture-1" } });
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    await waitFor(() => expect(fetchMock.mock.calls.some(call => call[1]?.method === "PATCH")).toBe(true));
    const sent = JSON.parse(fetchMock.mock.calls.find(call => call[1]?.method === "PATCH")![1].body);
    expect(sent).toMatchObject({ accountId: "other-account", userId: "other-user", expectedReviewVersion: "a".repeat(64), identityMatched: true });
  });
  it("reloads changed account details and clears attestations after a stale review fails", async () => {
    let adminReads = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return new Response(JSON.stringify({ error: "Wise account details changed. Reload and review the current evidence and account details." }), { status: 400 });
      if (url.includes("admin/")) {
        adminReads += 1;
        return new Response(JSON.stringify({ accounts: [{ id: "other-account", userId: "other-user", reviewVersion: (adminReads > 1 ? "b" : "a").repeat(64), accountHolderName: "Other Draft Buyer", bankName: "Synthetic Bank", routingNumber: "021000021", accountNumber: adminReads > 1 ? "00012340099" : "00012340042", accountType: "checking" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ enabled: true, accounts: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WiseAccountsPanel locale="en" actorId="reviewer" canReview />);
    fireEvent.click(await screen.findByRole("button", { name: "Open ownership reviews" }));
    fireEvent.change(await screen.findByLabelText("Account to review"), { target: { value: "other-account" } });
    fireEvent.change(screen.getByLabelText("Legal name verified in the evidence"), { target: { value: "Other Draft Buyer" } });
    fireEvent.change(screen.getByLabelText("Private evidence record reference"), { target: { value: "private-review-fixture-1" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Approve ownership review" }));
    await waitFor(() => expect(adminReads).toBe(2));
    const accountSelect = await screen.findByLabelText("Account to review") as HTMLSelectElement;
    expect(accountSelect.value).toBe("");
    fireEvent.change(accountSelect, { target: { value: "other-account" } });
    expect(screen.getByText("00012340099")).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Legal name verified in the evidence") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Private evidence record reference") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Approve ownership review" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
