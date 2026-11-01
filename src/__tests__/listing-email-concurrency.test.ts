import { expect, it, vi } from "vitest";
import type { MarketplaceListing } from "@/types/alpha-exchange";

const mocks = vi.hoisted(() => ({ seller: vi.fn(), recipients: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/alpha-exchange-store", () => ({ findUserById: mocks.seller, getListingBroadcastEmailRecipients: mocks.recipients }));
vi.mock("@/lib/marketplace-email-delivery", () => ({ sendMarketplaceEmail: mocks.send }));
import { prepareListingReviewEmails } from "@/lib/marketplace-email-events";

it("prioritizes the seller and sends listing announcements without a concurrent provider burst", async () => {
  const seller = { id: "seller", fullName: "Seller", email: "seller@example.com", preferredLocale: "en" };
  const buyers = ["buyer-a", "buyer-b"].map((id) => ({ id, fullName: id, email: `${id}@example.com`, preferredLocale: "en" }));
  mocks.seller.mockResolvedValue(seller);
  mocks.recipients.mockResolvedValue(buyers);
  let active = 0;
  let peak = 0;
  mocks.send.mockImplementation(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active -= 1;
    return { ok: true };
  });
  const listing = { id: "listing-1", sellerId: seller.id, availableAmount: "100", network: "TRC20", price: "3.5", currency: "ILS" } as MarketplaceListing;
  const deliver = await prepareListingReviewEmails({ decision: "approve", listing });
  expect(mocks.send).not.toHaveBeenCalled();
  await deliver();
  expect(peak).toBe(1);
  expect(mocks.send).toHaveBeenCalledTimes(3);
  expect(mocks.send).toHaveBeenNthCalledWith(1, expect.objectContaining({ event: "listing_approved", to: seller.email }));
  buyers.forEach((buyer, index) => {
    expect(mocks.send).toHaveBeenNthCalledWith(index + 2, expect.objectContaining({
      event: "new_listing_published", to: buyer.email,
      idempotencyKey: `listing-published:${listing.id}:${buyer.id}`,
    }));
  });
});
