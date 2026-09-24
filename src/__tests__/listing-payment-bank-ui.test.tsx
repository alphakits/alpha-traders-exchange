import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsdtExchangePage } from "@/components/sections/usdt-exchange/usdt-exchange-page";

vi.mock("next/image", () => ({ default: () => <span /> }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
}));

const seller = {
  id: "seller-bank-ui", fullName: "Seller", email: "seller@example.test",
  role: "approved_seller" as const, roles: ["approved_seller" as const, "buyer" as const],
  sellerStatus: "approved_seller" as const, sellerApprovalVerified: true,
  whatsappNumber: "", preferredNetworks: [], preferredPaymentMethods: ["Bank Transfer"],
  profilePhotoUrl: "", languages: ["English"], bio: "", country: "Israel", city: "",
  onlineStatus: "online" as const, availabilityStatus: "available" as const,
  createdAt: "2026-09-04T00:00:00.000Z",
};

const savedAccount = { id: "saved-bank", bankName: "Bank Leumi", maskedAccountNumber: "****7890", accountLast4: "7890", isDefault: true };
let bankAccounts: typeof savedAccount[];
let submittedListing: Record<string, unknown> | undefined;
let mobile: boolean;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  bankAccounts = [];
  submittedListing = undefined;
  mobile = false;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: mobile && query.includes("max-width: 768px"), media: query,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    })),
  });
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  vi.stubGlobal("EventSource", class { addEventListener() {} removeEventListener() {} close() {} });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/seller-settings")) return json({ bankAccounts });
    if (url.includes("/my-listings")) return json({
      listings: [], summary: { activeListingLimit: 3, openListingCount: 0, openTradeCount: 0, pendingCommissionCount: 0, canCreateListing: true, blockedReason: null },
      commissionStatus: { status: "clear", pendingCount: 0, amountDue: 0, totalAmountDue: 0, payableRecords: [] },
    });
    if (url.includes("/api/alpha-exchange/listings") && init?.method === "POST") {
      submittedListing = JSON.parse(String(init.body));
      return json({ listing: { id: "listing-submitted", ...submittedListing, status: "draft", approvalStatus: "pending" } }, 201);
    }
    if (url.includes("/api/alpha-exchange/listings")) return json({ listings: [] });
    if (url.includes("/purchase-requests")) return json({ requests: [] });
    if (url.includes("/notifications")) return json({ notifications: [], activity: [], unreadCount: 0 });
    if (url.includes("/seller-application")) return json({ application: null });
    if (url.includes("/discord-sharing")) return json({ linked: false, available: false, listings: [] });
    return json({});
  }));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openForm(preferredPaymentMethods = ["Bank Transfer"], locale: "ar" | "en" = "en") {
  render(<UsdtExchangePage locale={locale} initialSessionUser={{ ...seller, preferredPaymentMethods }} workspaceMode="seller" />);
  await waitFor(() => expect(document.getElementById("create-available")).not.toBeNull());
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/alpha-exchange/seller-settings", expect.anything()));
  const form = within(document.getElementById("create-listing")!);
  for (const [id, value] of [["create-available", "1000"], ["create-price", "3.10"], ["create-min-trade", "100"], ["create-max-trade", "1000"]]) {
    fireEvent.change(document.getElementById(id)!, { target: { value } });
  }
  fireEvent.click(form.getByRole("checkbox"));
  return form;
}

describe("listing payment-method bank requirements", () => {
  it.each([true, false])("submits cash methods without profile bank details and gates Bank Transfer (mobile=%s)", async (isMobile) => {
    mobile = isMobile;
    const form = await openForm();
    const submit = () => form.getByRole("button", { name: "Submit Listing" }) as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    expect(form.getByText(/No saved bank accounts found/)).toBeTruthy();

    fireEvent.click(form.getByRole("button", { name: /Bank Transfer/ }));
    expect(form.getByRole("button", { name: /Bank Transfer/ }).getAttribute("aria-pressed")).toBe("false");
    expect(form.queryByText("Payout bank account")).toBeNull();
    expect(submit().disabled).toBe(true);
    fireEvent.click(form.getByRole("button", { name: /Meet in Person/ }));
    expect(form.queryByText("Payout bank account")).toBeNull();
    await waitFor(() => expect(submit().disabled).toBe(false));

    fireEvent.click(form.getByRole("button", { name: /Cardless ATM/ }));
    fireEvent.click(form.getByRole("button", { name: /Bank Hapoalim/ }));
    expect(form.queryByText(/No saved bank accounts found/)).toBeNull();
    expect(form.getByText("Cardless withdrawal banks")).toBeTruthy();
    expect(submit().disabled).toBe(false);

    fireEvent.click(form.getByRole("button", { name: /Bank Transfer/ }));
    expect(submit().disabled).toBe(true);
    expect(form.getByText(/No saved bank accounts found/)).toBeTruthy();
    fireEvent.click(form.getByRole("button", { name: /Bank Transfer/ }));
    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());
    await waitFor(() => expect(submittedListing).toBeDefined());
    expect(submittedListing).toMatchObject({
      paymentMethods: ["Face-to-Face (Meet in Person)", "Cardless ATM Withdrawal"], bankName: "Bank Hapoalim",
    });
    expect(submittedListing).not.toHaveProperty("bankAccountId");
  });

  it("does not replace cardless ATM choices with the seller's saved payout bank", async () => {
    bankAccounts = [savedAccount];
    const form = await openForm(["Cardless ATM Withdrawal"]);
    fireEvent.click(form.getByRole("button", { name: /Bank Hapoalim/ }));
    expect(form.queryByText("Payout bank account")).toBeNull();
    const submit = form.getByRole("button", { name: "Submit Listing" }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() => expect(submittedListing).toBeDefined());
    expect(submittedListing).toMatchObject({ paymentMethods: ["Cardless ATM Withdrawal"], bankName: "Bank Hapoalim" });
    expect(submittedListing).not.toHaveProperty("bankAccountId");
  });
});

describe("create-listing review summary", () => {
  it.each(["en", "ar"] as const)("keeps exact amounts and commission consent through submission (%s)", async (locale) => {
    const form = await openForm(["Face-to-Face (Meet in Person)"], locale);
    const summary = form.getByRole("region", { name: locale === "ar" ? "المراجعة والإرسال" : "Review & submit" });
    const review = within(summary);
    const available = document.getElementById("create-available") as HTMLInputElement;
    const maximum = document.getElementById("create-max-trade") as HTMLInputElement;

    fireEvent.change(available, { target: { value: "1000.123456" } });
    expect(maximum.value).toBe("1000.123456");
    fireEvent.change(document.getElementById("create-min-trade")!, { target: { value: "100.125001" } });
    fireEvent.change(maximum, { target: { value: "500.500001" } });
    fireEvent.change(document.getElementById("create-network")!, { target: { value: "BEP20" } });

    expect(review.getByTestId("create-summary-amount").textContent).toBe("1,000.123456 USDT");
    expect(review.getByTestId("create-summary-range").textContent).toBe("100.125001 – 500.500001 USDT");
    expect(review.getByTestId("create-summary-total").textContent).toBe("₪3,100.38");
    expect(review.getByText("BEP20")).toBeTruthy();
    expect(form.queryByText(locale === "ar" ? "حساب البنك لاستلام الدفع" : "Payout bank account")).toBeNull();

    const submit = form.getByRole("button", { name: locale === "ar" ? "إرسال العرض" : "Submit Listing" }) as HTMLButtonElement;
    const agreement = review.getByRole("checkbox");
    fireEvent.click(agreement);
    expect(submit.disabled).toBe(true);
    expect(submittedListing).toBeUndefined();
    fireEvent.click(agreement);
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);

    await waitFor(() => expect(submittedListing).toBeDefined());
    expect(submittedListing).toMatchObject({
      availableAmount: "1000.123456",
      price: "3.10",
      currency: "ILS",
      network: "BEP20",
      minimumTrade: "100.125001",
      maximumTrade: "500.500001",
      paymentMethods: ["Face-to-Face (Meet in Person)"],
      acceptedCommissionPolicy: true,
    });
    expect(submittedListing).not.toHaveProperty("bankAccountId");
    expect(submittedListing).not.toHaveProperty("bankName");
  });
});
