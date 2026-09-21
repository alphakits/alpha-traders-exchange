import { useState, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/i18n/navigation", () => ({ Link: () => null }));
import { PurchaseListingDialog } from "./purchase-listing-dialog";
import { getWalletAddressValidationError } from "@/lib/wallet-address";
type Props = ComponentProps<typeof PurchaseListingDialog>;
const noop = () => {};
function Harness() {
  const [buyerInfo, setBuyerInfo] = useState<Props["buyerInfo"]>({ usdtAmount: "125", receivingNetwork: "TRC20", receivingWalletAddress: "TMDgWpi2huECqaoR6e71ttEiVyV34HUtr8", cardlessVerificationKind: "date_of_birth" });
  const invalid = Boolean(getWalletAddressValidationError(buyerInfo.receivingNetwork!, buyerInfo.receivingWalletAddress));
  return <PurchaseListingDialog locale="en" listing={{ id: "test", sellerId: "seller", sellerDisplayName: "Seller", bankName: "Bank Hapoalim, Bank Leumi", network: "TRC20" } as Props["listing"]}
    sellerProfileData={null} isSellerProfileLoading={false} selectedAmount={1000} selectedPrice={3.2} estimatedTotal={Number(buyerInfo.usdtAmount) * 3.2}
    isOwnerViewer={false} isOwnerProfileActionLoading={false} purchaseSubmitted={false} buyerInfo={buyerInfo} onBuyerDetailsChange={(changes) => setBuyerInfo((current) => ({ ...current, ...changes }))}
    selectedPaymentMethods={["Cardless ATM Withdrawal"]} selectedPaymentMethod="Cardless ATM Withdrawal" buyerTradeAmount={Number(buyerInfo.usdtAmount)} selectedMinTrade={10} selectedMaxTrade={1000} buyerTradeAmountInvalid={false}
    buyerWalletValidationError={null} buyerWalletInvalid={invalid} priceMode="listing_price" offeredPrice="" minimumOfferedPrice="2.85" offerPriceInvalid={false} offeredTradePrice={0}
    requiresSafetyNotice={false} safetyAcknowledged={false} showVerificationCta={false} isRedirectingToVerification={false} statusMessage={null} isSubmittingPurchase={false}
    onClose={noop} onSubmit={noop} onQuickBuy={noop} onPaymentMethodChange={noop} onBuyerAmountChange={(usdtAmount) => setBuyerInfo((current) => ({ ...current, usdtAmount }))}
    onBuyerWalletChange={(receivingWalletAddress) => setBuyerInfo((current) => ({ ...current, receivingWalletAddress }))} onOfferedPriceChange={noop} onSafetyAcknowledgedChange={noop} onGoToVerification={noop}
    onOwnerSellerProfileState={noop} onOwnerSuspendSeller={noop} formatIls={(value) => String(value)} localizedAuditAction={String} paymentMethodEmoji={() => ""} paymentMethodLabel={String} sellerLevelLabel={() => "Bronze"} sellerLevelToneKey={() => "bronze"} tradeStatusLabel={String} />;
}
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
    expect(Array.from(cash.options).slice(1).map((option) => Number(option.value))).toEqual(Array.from({ length: 100 }, (_, i) => (i + 1) * 100));
    fireEvent.change(cash, { target: { value: "500" } });
    expect((screen.getByLabelText(/USDT Amount/) as HTMLInputElement).value).toBe("156.25");
    expect(submit.disabled).toBe(true);
    const bank = screen.getByLabelText(/Bank that issued your withdrawal code/) as HTMLSelectElement;
    expect(bank.required).toBe(true);
    expect(Array.from(bank.options).slice(1).map((option) => option.value)).toEqual(["Bank Hapoalim", "Bank Leumi"]);
    fireEvent.change(bank, { target: { value: "Bank Leumi" } });
    expect(submit.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("USDT receiving network"), { target: { value: "BEP20" } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Receiving Wallet|Receiving Address|receiving wallet/i), { target: { value: "0x7088a120cde7351dbf3e7831a9da3f74058c89a0" } });
    expect(submit.disabled).toBe(false);
  });
});
