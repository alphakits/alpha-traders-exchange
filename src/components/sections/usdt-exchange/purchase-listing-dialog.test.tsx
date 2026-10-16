import { useState, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/i18n/navigation", () => ({ Link: () => null }));
import { PurchaseListingDialog } from "./purchase-listing-dialog";
import { getWalletAddressValidationError } from "@/lib/wallet-address";
import { calculateFiatAmount, calculateTradeBuyerFiatFee, calculateTradePaymentTotal } from "@alpha-traders/contracts";
type Props = ComponentProps<typeof PurchaseListingDialog>;
const noop = () => {};
type HarnessProps = Partial<Pick<Props, "locale" | "sellerProfileData" | "selectedMinTrade" | "selectedMaxTrade" | "selectedPrice" | "selectedPaymentMethod" | "priceMode" | "onClose" | "onSubmit" | "isSubmittingPurchase">> & { initialBuyerInfo?: Partial<Props["buyerInfo"]> };
function Harness({ locale = "en", sellerProfileData = null, selectedMinTrade = 10, selectedMaxTrade = 1000, selectedPrice = 3.2, selectedPaymentMethod = "Cardless ATM Withdrawal", priceMode = "listing_price", onClose = noop, onSubmit = noop, isSubmittingPurchase = false, initialBuyerInfo = {} }: HarnessProps) {
  const [buyerInfo, setBuyerInfo] = useState<Props["buyerInfo"]>({ usdtAmount: "125", receivingNetwork: "TRC20", receivingWalletAddress: "TMDgWpi2huECqaoR6e71ttEiVyV34HUtr8", cardlessVerificationKind: "date_of_birth", ...initialBuyerInfo });
  const [offeredPrice, setOfferedPrice] = useState("3.20");
  const price = priceMode === "buyer_offer" ? Number(offeredPrice) : selectedPrice;
  const amount = Number(buyerInfo.usdtAmount);
  const invalid = Boolean(getWalletAddressValidationError(buyerInfo.receivingNetwork!, buyerInfo.receivingWalletAddress));
  return <PurchaseListingDialog locale={locale} listing={{ id: "test", sellerId: "seller", sellerDisplayName: "Seller", bankName: "Bank Hapoalim, Bank Leumi", network: "TRC20" } as Props["listing"]}
    sellerProfileData={sellerProfileData} isSellerProfileLoading={false} selectedAmount={selectedMaxTrade} selectedPrice={selectedPrice} estimatedTradeValue={Number(calculateFiatAmount(String(amount), price.toFixed(2)) ?? 0)} estimatedBuyerFee={Number(calculateTradeBuyerFiatFee(String(amount), price.toFixed(2)) ?? 0)} estimatedTotal={Number(calculateTradePaymentTotal(String(amount), price.toFixed(2), true) ?? 0)}
    purchaseSubmitted={false} buyerInfo={buyerInfo} onBuyerDetailsChange={(changes) => setBuyerInfo((current) => ({ ...current, ...changes }))}
    selectedPaymentMethods={[selectedPaymentMethod!]} selectedPaymentMethod={selectedPaymentMethod} buyerTradeAmount={amount} selectedMinTrade={selectedMinTrade} selectedMaxTrade={selectedMaxTrade} buyerTradeAmountInvalid={amount <= 0 || amount < selectedMinTrade || amount > selectedMaxTrade}
    buyerWalletValidationError={null} buyerWalletInvalid={invalid} priceMode={priceMode} offeredPrice={offeredPrice} minimumOfferedPrice="2.85" offerPriceInvalid={price < 2.85} offeredTradePrice={Number(offeredPrice)}
    requiresSafetyNotice={false} safetyAcknowledged={false} showVerificationCta={false} isRedirectingToVerification={false} statusMessage={null} isSubmittingPurchase={isSubmittingPurchase}
    onClose={onClose} onSubmit={onSubmit} onPaymentMethodChange={noop} onBuyerAmountChange={(usdtAmount) => setBuyerInfo((current) => ({ ...current, usdtAmount }))}
    onBuyerWalletChange={(receivingWalletAddress) => setBuyerInfo((current) => ({ ...current, receivingWalletAddress }))} onOfferedPriceChange={(value) => {
      setOfferedPrice(value);
    }} onSafetyAcknowledgedChange={noop} onGoToVerification={noop}
    formatIls={(value) => String(value)} paymentMethodEmoji={() => ""} paymentMethodLabel={String} sellerLevelToneKey={() => "bronze"} />;
}
const preparedBankCode = { cardlessBankName: "Bank Hapoalim", cardlessWithdrawalCode: "482913", cardlessVerificationValue: "1995-08-25" };
afterEach(cleanup);
describe("prepared cardless purchase form", () => {
  it("requires code, typed birth date and full cash; preserves USDT and clears the wallet when changing network", () => {
    render(<Harness />);
    const submit = screen.getByRole("button", { name: "Start Trade" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const birth = screen.getByPlaceholderText("DD/MM/YYYY") as HTMLInputElement;
    expect(birth.type).toBe("text");
    fireEvent.change(birth, { target: { value: "25/08/1995" } });
    fireEvent.change(screen.getByLabelText("1. Withdrawal code"), { target: { value: "482913" } });
    expect(submit.disabled).toBe(true);
    const cash = document.getElementById("cardless-cash-input")!;
    fireEvent.change(cash, { target: { value: "404" } });
    expect((screen.getByLabelText(/USDT Amount/) as HTMLInputElement).value).toBe("125");
    expect(submit.disabled).toBe(true);
    const bank = screen.getByLabelText(/Bank that issued your withdrawal code/) as HTMLSelectElement;
    expect(bank.required).toBe(true);
    expect(Array.from(bank.options).slice(1).map((option) => option.value)).toEqual(expect.arrayContaining([
      "Bank Hapoalim", "Bank Leumi", "Mizrahi-Tefahot", "Discount", "First International",
      "Yahav", "Mercantile", "Massad", "Jerusalem", "ONE ZERO", "Esh",
    ]));
    // The buyer's withdrawal bank is independent of the seller's listed banks.
    fireEvent.change(bank, { target: { value: "Mercantile" } });
    expect(bank.value).toBe("Mercantile");
    expect(submit.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("USDT receiving network"), { target: { value: "BEP20" } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Receiving Wallet|Receiving Address|receiving wallet/i), { target: { value: "0x7088a120cde7351dbf3e7831a9da3f74058c89a0" } });
    expect(submit.disabled).toBe(false);
  });
});


describe("cardless listing limits and escape", () => {
  it.each(["en", "ar"] as const)("requires the full 420 USDT total including the buyer fee in %s", (locale) => {
    render(<Harness locale={locale} selectedMinTrade={420} selectedMaxTrade={420} selectedPrice={3.10}
      initialBuyerInfo={{ ...preparedBankCode, usdtAmount: "420" }} />);
    const cash = document.getElementById("cardless-cash-input") as HTMLInputElement;
    const amount = document.getElementById("buyer-usdt-amount") as HTMLInputElement;
    const submit = screen.getByRole("button", { name: locale === "ar" ? "بدء الصفقة" : "Start Trade" }) as HTMLButtonElement;
    expect(screen.getByTestId("cardless-required-total").textContent).toContain("1,315.02");
    for (const value of ["1000", "1300", "1302", "1315.01", "1315.03", "1400"]) {
      fireEvent.change(cash, { target: { value } });
      expect(amount.value).toBe("420");
      expect(submit.disabled).toBe(true);
      expect(screen.getByRole("alert").textContent).toContain("1,315.02");
    }
    fireEvent.change(cash, { target: { value: "1300" } });
    expect(screen.getByRole("alert").textContent).toContain("15.02");
    fireEvent.change(cash, { target: { value: "١٣١٥٫٠٢" } });
    expect(cash.value).toBe("1315.02");
    expect(amount.value).toBe("420");
    expect(submit.disabled).toBe(false);
    fireEvent.change(cash, { target: { value: "" } });
    expect(amount.value).toBe("420");
    expect(submit.disabled).toBe(true);
  });

  it("recalculates the required payment when USDT changes and enforces seller limits", () => {
    render(<Harness selectedMinTrade={600} selectedMaxTrade={660} selectedPrice={3.03}
      initialBuyerInfo={{ ...preparedBankCode, usdtAmount: "600", cardlessIlsAmount: "1836.18" }} />);
    const amount = screen.getByLabelText(/USDT Amount/) as HTMLInputElement;
    const cash = document.getElementById("cardless-cash-input") as HTMLInputElement;
    const submit = screen.getByRole("button", { name: "Start Trade" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    expect(amount.readOnly).toBe(false);
    fireEvent.change(amount, { target: { value: "660" } });
    expect(cash.value).toBe("1836.18");
    expect(submit.disabled).toBe(true);
    fireEvent.change(cash, { target: { value: "2019.80" } });
    expect(submit.disabled).toBe(false);
    fireEvent.change(amount, { target: { value: "661" } });
    fireEvent.change(cash, { target: { value: "2022.86" } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(amount, { target: { value: "599" } });
    fireEvent.change(cash, { target: { value: "1833.12" } });
    expect(submit.disabled).toBe(true);
  });

  it("revalidates a price offer without silently changing USDT or the entered code amount", () => {
    render(<Harness selectedMinTrade={420} selectedMaxTrade={420} priceMode="buyer_offer"
      initialBuyerInfo={{ ...preparedBankCode, cardlessIlsAmount: "1357.44", usdtAmount: "420" }} />);
    const submit = screen.getByRole("button", { name: "Submit Price Offer" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.change(document.getElementById("buyer-offered-price")!, { target: { value: "3.09" } });
    expect((screen.getByLabelText(/USDT Amount/) as HTMLInputElement).value).toBe("420");
    expect((document.getElementById("cardless-cash-input") as HTMLInputElement).value).toBe("1357.44");
    expect(screen.getByRole("alert").textContent).toContain("1,310.78");
    expect(submit.disabled).toBe(true);
    fireEvent.change(document.getElementById("cardless-cash-input")!, { target: { value: "1310.78" } });
    expect(submit.disabled).toBe(false);
  });

  it.each(["en", "ar"] as const)("explains an out-of-range total and keeps Cancel available in %s", (locale) => {
    const close = vi.fn();
    render(<Harness locale={locale} selectedMinTrade={5000} selectedMaxTrade={45000} selectedPrice={3.10} onClose={close}
      initialBuyerInfo={{ ...preparedBankCode, usdtAmount: "5000", cardlessIlsAmount: "10000" }} />);
    expect(screen.getByRole("alert").textContent).toContain("10,000");
    expect((document.getElementById("buyer-usdt-amount") as HTMLInputElement).value).toBe("5000");
    expect((screen.getByRole("button", { name: locale === "ar" ? "بدء الصفقة" : "Start Trade" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: locale === "ar" ? "إلغاء" : "Cancel" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("shows fractional trade limits accurately", () => {
    render(<Harness selectedMinTrade={627.062706} selectedMaxTrade={660.066007} selectedPrice={3.03} />);
    expect(document.getElementById("buyer-amount-help")?.textContent).toContain("627.062706 - 660.066007 USDT");
  });

  it.each(["Bank Transfer", "Face-to-Face (Meet in Person)"])("keeps manual USDT entry and Cancel for %s", (selectedPaymentMethod) => {
    const close = vi.fn();
    render(<Harness selectedPaymentMethod={selectedPaymentMethod} onClose={close} />);
    const amount = screen.getByLabelText(/USDT Amount/) as HTMLInputElement;
    expect(amount.readOnly).toBe(false);
    fireEvent.change(amount, { target: { value: "660" } });
    expect(amount.value).toBe("660");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("prevents closing while a request is being submitted", () => {
    const close = vi.fn();
    render(<Harness isSubmittingPurchase onClose={close} />);
    const cancel = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
    const x = screen.getByRole("button", { name: "Close Buy USDT sheet" }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    expect(x.disabled).toBe(true);
    fireEvent.click(cancel);
    fireEvent.click(x);
    expect(close).not.toHaveBeenCalled();
  });
});


describe("purchase dialog seller privacy", () => {
  it.each(["en", "ar"] as const)("never renders private histories or management controls in %s, even with a stale privileged payload", (locale) => {
    const privatePayload = {
      sellerId: "seller", sellerLevel: "bronze", trustScore: 75, completedTrades: 12, averageRating: 5, responseTimeMinutes: 4,
      profile: { sellerId: "seller", sellerName: "AT-123456", onlineStatus: "offline", profilePhotoUrl: "" },
      ownerTools: {
        auditHistory: [{ id: "private-audit", action: "listing_renewed", createdAt: "2026-10-04" }],
        commissionHistory: [{ id: "private-commission", commissionAmount: 987.65, createdAt: "2026-10-04" }],
        tradeHistory: [{ id: "private-trade", tradeId: "TR-000151", status: "cancelled" }],
      },
    } as Props["sellerProfileData"];
    render(<Harness locale={locale} sellerProfileData={privatePayload} />);
    expect(screen.getByRole("dialog").textContent).not.toMatch(/987\.65|TR-000151|Recent Commission|Commission History|Audit History|Recent Trades|أحدث العمولات|سجل العمولات|سجل التدقيق|أحدث الصفقات/);
    expect(screen.queryByRole("button", { name: /Feature Seller|Unfeature Seller|Hide Seller|Suspend Seller|تعليق البائع/ })).toBeNull();
    expect(screen.getByLabelText(locale === "en" ? /USDT Amount/ : /كمية USDT/)).toBeTruthy();
  });
});
