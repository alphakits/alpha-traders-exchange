import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const fixture = vi.hoisted(() => ({ editing: true, maximum: "500" }));
vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress?: () => void }) => <button onClick={onPress}>{children}</button>,
  TextInput: ({ value, onChangeText, onBlur, placeholder }: { value: string; onChangeText: (value: string) => void; onBlur?: () => void; placeholder?: string }) => <input value={value} onChange={event => onChangeText(event.target.value)} onBlur={onBlur} placeholder={placeholder} />,
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock("expo-router", () => ({ useLocalSearchParams: () => ({ listingId: fixture.editing ? "synthetic-listing" : undefined }), useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), Redirect: () => null }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => queryKey[0] === "mobile-seller-listing" && fixture.editing
    ? { data: { listing: { id: "synthetic-listing", availableAmount: "500", maximumTrade: fixture.maximum, minimumTrade: "200", price: "3.20", currency: "ILS", network: "TRC20", paymentMethods: ["Face-to-Face (Meet in Person)"], sellerDescription: "", responseTime: "5 min" } } }
    : { data: { bankAccounts: [] } },
}));
vi.mock("../auth/auth-context", () => ({ useAuth: () => ({ status: "authenticated", user: { id: "synthetic-seller" }, requestWithSession: vi.fn() }) }));
vi.mock("../api/mobile-api", () => ({ createMobileSellerListing: vi.fn(), deleteMobileSellerListing: vi.fn(), getMobileSellerBankAccounts: vi.fn(), getMobileSellerListing: vi.fn(), updateMobileSellerListing: vi.fn() }));
vi.mock("../auth/seller-access", () => ({ canUseSellerTools: () => true }));
vi.mock("../i18n/locale-context", () => ({ useLocale: () => ({ locale: "en", isRTL: false }) }));
vi.mock("../finance/use-usd-display-rate", () => ({ useUsdDisplayReference: () => ({ rate: 3.2, available: true }) }));
vi.mock("../components/native-page-shell", () => ({ NativePageShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("../components/branded-text", () => ({ BrandedText: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
vi.mock("../components/gold-button", () => ({ GoldButton: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => <button onClick={onPress}>{children}</button> }));

import NewSellerListingScreen from "../../app/seller/new";

afterEach(cleanup);
beforeEach(() => { fixture.editing = true; fixture.maximum = "500"; });
function inputs() {
  const [amount, maximum] = screen.getAllByPlaceholderText("1,000") as HTMLInputElement[];
  if (!amount || !maximum) throw new Error("Native quantity controls are missing");
  return { amount, maximum };
}

describe("native seller quantity limits", () => {
  it("carries the full 500 maximum to 2000 when inventory is replenished", () => {
    render(<NewSellerListingScreen />);
    const { amount, maximum } = inputs();
    fireEvent.change(amount, { target: { value: "2000" } });
    expect(maximum.value).toBe("2000");
    expect((screen.getByPlaceholderText("100") as HTMLInputElement).value).toBe("200");
  });
  it("keeps the full maximum through clearing and incremental typing", () => {
    render(<NewSellerListingScreen />);
    const { amount, maximum } = inputs();
    for (const value of ["", "2", "20", "200", "2000"]) fireEvent.change(amount, { target: { value } });
    expect(maximum.value).toBe("2000");
  });
  it("preserves an explicit lower cap while the amount crosses it during typing", () => {
    fixture.maximum = "400";
    render(<NewSellerListingScreen />);
    const { amount, maximum } = inputs();
    for (const value of ["", "4", "40", "400", "4000"]) fireEvent.change(amount, { target: { value } });
    expect(maximum.value).toBe("400");
  });
  it("uses the completed quantity as the default maximum for a new listing", () => {
    fixture.editing = false;
    render(<NewSellerListingScreen />);
    const { amount, maximum } = inputs();
    for (const value of ["2", "20", "200", "2000"]) fireEvent.change(amount, { target: { value } });
    expect(maximum.value).toBe("2000");
  });
  it("retains a newly entered custom cap until the seller explicitly makes it full balance", () => {
    render(<NewSellerListingScreen />);
    const { amount, maximum } = inputs();
    fireEvent.change(maximum, { target: { value: "300" } });
    for (const value of ["", "3", "30", "300", "3000"]) fireEvent.change(amount, { target: { value } });
    expect(maximum.value).toBe("300");
    fireEvent.change(maximum, { target: { value: "3000" } });
    fireEvent.change(amount, { target: { value: "5000" } });
    expect(maximum.value).toBe("5000");
  });
});
