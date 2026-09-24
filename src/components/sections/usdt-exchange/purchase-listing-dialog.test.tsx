import { useState, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/i18n/navigation", () => ({ Link: () => null }));
import { PurchaseListingDialog } from "./purchase-listing-dialog";
import { getWalletAddressValidationError } from "@/lib/wallet-address";
import { calculateCardlessUsdtAmount } from "@alpha-traders/contracts";
type Props = ComponentProps<typeof PurchaseListingDialog>;
const noop = () => {};
type HarnessProps = Partial<Pick<Props, "locale" | "selectedMinTrade" | "selectedMaxTrade" | "selectedPrice" | "selectedPaymentMethod" | "priceMode" | "onClose" | "onSubmit" | "isSubmittingPurchase">> & { initialBuyerInfo?: Partial<Props["buyerInfo"]> };
function Harness({ locale = "en", selectedMinTrade = 10, selectedMaxTrade = 1000, selectedPrice = 3.2, selectedPaymentMethod = "Cardless ATM Withdrawal", priceMode = "listing_price", onClose = noop, onSubmit = noop, isSubmittingPurchase = false, initialBuyerInfo = {} }: HarnessProps) {
  const [buyerInfo, setBuyerInfo] = useState<Props["buyerInfo"]>({ usdtAmount: "125", receivingNetwork: "TRC20", receivingWalletAddress: "TMDgWpi2huECqaoR6e71ttEiVyV34HUtr8", cardlessVerificationKind: "date_of_birth", ...initialBuyerInfo });
  const [offeredPrice, setOfferedPrice] = useState("3.20");
  const price = priceMode === "buyer_offer" ? Number(offeredPrice) : selectedPrice;
  const amount = Number(buyerInfo.usdtAmount);
  const invalid = Boolean(getWalletAddressValidationError(buyerInfo.receivingNetwork!, buyerInfo.receivingWalletAddress));
  return <PurchaseListingDialog locale={locale} listing={{ id: "test", sellerId: "seller", sellerDisplayName: "Seller", bankName: "Bank Hapoalim, Bank Leumi", network: "TRC20" } as Props["listing"]}
    sellerProfileData={null} isSellerProfileLoading={false} selectedAmount={selectedMaxTrade} selectedPrice={selectedPrice} estimatedTradeValue={amount * price} estimatedBuyerFee={amount * price * 0.01} estimatedTotal={amount * price * 1.01}
    isOwnerViewer={false} isOwnerProfileActionLoading={false} purchaseSubmitted={false} buyerInfo={buyerInfo} onBuyerDetailsChange={(changes) => setBuyerInfo((current) => ({ ...current, ...changes }))}
    selectedPaymentMethods={[selectedPaymentMethod!]} selectedPaymentMethod={selectedPaymentMethod} buyerTradeAmount={amount} selectedMinTrade={selectedMinTrade} selectedMaxTrade={selectedMaxTrade} buyerTradeAmountInvalid={amount <= 0 || amount < selectedMinTrade || amount > selectedMaxTrade}
    buyerWalletValidationError={null} buyerWalletInvalid={invalid} priceMode={priceMode} offeredPrice={offeredPrice} minimumOfferedPrice="2.85" offerPriceInvalid={price < 2.85} offeredTradePrice={Number(offeredPrice)}
    requiresSafetyNotice={false} safetyAcknowledged={false} showVerificationCta={false} isRedirectingToVerification={false} statusMessage={null} isSubmittingPurchase={isSubmittingPurchase}
    onClose={onClose} onSubmit={onSubmit} onQuickBuy={noop} onPaymentMethodChange={noop} onBuyerAmountChange={(usdtAmount) => setBuyerInfo((current) => ({ ...current, usdtAmount }))}
    onBuyerWalletChange={(receivingWalletAddress) => setBuyerInfo((current) => ({ ...current, receivingWalletAddress }))} onOfferedPriceChange={(value) => {
      setOfferedPrice(value);
      setBuyerInfo((current) => ({ ...current, usdtAmount: calculateCardlessUsdtAmount(current.cardlessIlsAmount ?? "", value) ?? "" }));
    }} onSafetyAcknowledgedChange={noop} onGoToVerification={noop}
    onOwnerSellerProfileState={noop} onOwnerSuspendSeller={noop} formatIls={(value) => String(value)} localizedAuditAction={String} paymentMethodEmoji={() => ""} paymentMethodLabel={String} sellerLevelToneKey={() => "bronze"} tradeStatusLabel={String} />;
}
const preparedBankCode = { cardlessBankName: "Bank Hapoalim", cardlessWithdrawalCode: "482913", cardlessVerificationValue: "1995-08-25" };
afterEach(cleanup);
describe("prepared cardless purchase form", () => {
  it("requires code, typed birth date and cash; recalculates USDT and clears the wallet when changing network", () => {
    render(<Harness />);
    const submit = screen.getByRole("button", { name: "Start Trade" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const birth = screen.getByPlaceholderText("DD/MM/YYYY") as HTMLInputElement;
    expect(birth.type).toBe("text");
    fireEvent.change(birth, { target: { value: "25/08/1995" } });
    fireEvent.change(screen.getByLabelText("1. Withdrawal code"), { target: { value: "482913" } });
    expect(submit.disabled).toBe(true);
    const cash = screen.getByLabelText("Withdrawal code amount in ILS") as HTMLSelectElement;
    expect(Array.from(cash.options).slice(1).map((option) => Number(option.value))).toEqual(Array.from({ length: 32 }, (_, i) => (i + 1) * 100));
    fireEvent.change(cash, { target: { value: "500" } });
    expect((screen.getByLabelText(/USDT Amount/) as HTMLInputElement).value).toBe("156.25");
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
  it("offers only compatible cash amounts for the reported 600–660 listing", () => {
    render(<Harness selectedMinTrade={600} selectedMaxTrade={660} selectedPrice={3.03} initialBuyerInfo={preparedBankCode} />);
    const cash = screen.getByLabelText("Withdrawal code amount in ILS") as HTMLSelectElement;
    expect(Array.from(cash.options).filter((option) => option.value).map((option) => option.value)).toEqual(["1900"]);
    fireEvent.change(cash, { target: { value: "1900" } });
    const amount = screen.getByLabelText(/USDT Amount/) as HTMLInputElement;
    expect(amount.value).toBe("627.062706");
    expect(amount.readOnly).toBe(true);
    expect(cash.compareDocumentPosition(amount) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((screen.getByRole("button", { name: "Start Trade" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Quick Buy" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("preserves an incompatible bank amount, explains it, and permits cancellation", () => {
    const close = vi.fn();
    const submit = vi.fn();
    render(<Harness selectedMinTrade={600} selectedMaxTrade={660} selectedPrice={3.03} onClose={close} onSubmit={submit} initialBuyerInfo={{ ...preparedBankCode, cardlessIlsAmount: "2000", usdtAmount: "660.066007" }} />);
    const cash = screen.getByLabelText("Withdrawal code amount in ILS") as HTMLSelectElement;
    expect(cash.value).toBe("2000");
    expect(cash.selectedOptions[0].disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("Do not use a code for a different amount");
    expect((screen.getByRole("button", { name: "Start Trade" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Quick Buy" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
  });

  it("revalidates a price offer without silently changing the bank cash amount", () => {
    render(<Harness selectedMinTrade={600} selectedMaxTrade={660} priceMode="buyer_offer" initialBuyerInfo={{ ...preparedBankCode, cardlessIlsAmount: "2000", usdtAmount: "625" }} />);
    expect((screen.getByRole("button", { name: "Submit Price Offer" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(document.getElementById("buyer-offered-price")!, { target: { value: "3.03" } });
    expect((screen.getByLabelText(/USDT Amount/) as HTMLInputElement).value).toBe("660.066007");
    expect((screen.getByLabelText("Withdrawal code amount in ILS") as HTMLSelectElement).value).toBe("2000");
    expect(screen.getByRole("alert")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit Price Offer" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each(["en", "ar"] as const)("explains an empty cash range and keeps Cancel available in %s", (locale) => {
    const close = vi.fn();
    render(<Harness locale={locale} selectedMinTrade={650} selectedMaxTrade={660} selectedPrice={3.03} onClose={close} />);
    const cash = document.getElementById("cardless-ils-amount") as HTMLSelectElement;
    expect(cash.options.length).toBe(1);
    expect(screen.getByRole("alert")).toBeTruthy();
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
