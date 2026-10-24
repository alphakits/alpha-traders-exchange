import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketplaceCompliancePaymentPage } from "@/components/sections/seller/marketplace-compliance-payment-page";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const noRestriction = { enforcement: { restricted: false, blockReason: null } };
const restriction = { enforcement: { restricted: true, blockReason: "Compliance review", activeRecord: {
  id: "audit-restriction", violationNumber: 1, feeAmount: 10, feeCurrency: "USDT",
  recoveryPaymentStatus: "pending_payment", recoveryWalletNetwork: "TRC20", recoveryWalletAddress: "audit-wallet"
} } };

describe.each(["en", "ar"] as const)("compliance read states (%s)", (locale) => {
  const clearLabel = locale === "ar" ? "لا توجد قيود نشطة" : "No Active Compliance Restriction";
  const refreshLabel = locale === "ar" ? "تحديث الحالة" : "Refresh Status";
  it.each(["http", "network", "missing", "invalid", "missing-record"] as const)("never declares privileges active after %s failure", async (failure) => {
    const fetcher = vi.fn();
    if (failure === "network") fetcher.mockRejectedValue(new Error("offline"));
    else fetcher.mockResolvedValue(response(failure === "http" ? { error: "Unavailable" }
      : failure === "missing" ? {} : failure === "invalid" ? { enforcement: { restricted: "false" } }
      : { enforcement: { restricted: true } }, failure === "http" ? 503 : 200));
    vi.stubGlobal("fetch", fetcher);
    render(<MarketplaceCompliancePaymentPage locale={locale} />);
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(screen.queryByText(clearLabel)).toBeNull();
    expect(screen.queryByText(/Seller marketplace privileges are currently active|كل صلاحيات البائع مفعلة/)).toBeNull();
    expect(screen.queryByRole("button", { name: /I've Sent Payment|لقد أرسلت الدفع/ })).toBeNull();
    expect(screen.getByRole("button", { name: refreshLabel }).hasAttribute("disabled")).toBe(false);
  });
  it("keeps the confirmed empty state specific to enforcement and exposes commission checkout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(noRestriction)));
    render(<MarketplaceCompliancePaymentPage locale={locale} />);
    expect(await screen.findByText(clearLabel)).not.toBeNull();
    expect(screen.queryByText(/Seller marketplace privileges are currently active|كل صلاحيات البائع مفعلة/)).toBeNull();
    expect(screen.getByRole("link", { name: locale === "ar" ? "عمولتي" : "My Commission" }).getAttribute("href"))
      .toBe(`/${locale}/seller/commission-checkout`);
  });
  it("recovers a failed read through Refresh Status", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ error: "Unavailable" }, 503)).mockResolvedValueOnce(response(noRestriction));
    vi.stubGlobal("fetch", fetcher);
    render(<MarketplaceCompliancePaymentPage locale={locale} />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: refreshLabel }));
    expect(await screen.findByText(clearLabel)).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, options] of fetcher.mock.calls) expect(options.method).toBeUndefined();
  });
  it("removes obsolete payment controls after a failed status refresh", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response(restriction)).mockResolvedValueOnce(response({ error: "Unavailable" }, 503));
    vi.stubGlobal("fetch", fetcher);
    render(<MarketplaceCompliancePaymentPage locale={locale} />);
    expect(await screen.findByRole("button", { name: locale === "ar" ? "لقد أرسلت الدفع" : "I've Sent Payment" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: refreshLabel }));
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /I've Sent Payment|لقد أرسلت الدفع/ })).toBeNull();
    expect(screen.queryByText(clearLabel)).toBeNull();
  });
});
