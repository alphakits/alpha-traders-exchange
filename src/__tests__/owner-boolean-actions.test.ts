import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(), requireApiAdmin: vi.fn(),
  moderateSellerReview: vi.fn(), setSellerVacationModeByAdmin: vi.fn(),
}));
vi.mock("@/lib/api-auth", () => ({
  requireApiUser: mocks.requireApiUser, requireApiAdmin: mocks.requireApiAdmin,
  requireMarketplaceVerificationForTrading: vi.fn(),
}));
vi.mock("@/lib/alpha-exchange-store", () => ({
  moderateSellerReview: mocks.moderateSellerReview,
  setSellerVacationModeByAdmin: mocks.setSellerVacationModeByAdmin,
  getSellerReviews: vi.fn(), submitBuyerTradeReview: vi.fn(),
}));

import { PATCH as moderateReview } from "@/app/api/alpha-exchange/reviews/route";
import { POST as ownerModerateReview } from "@/app/api/alpha-exchange/admin/reviews/[reviewId]/moderate/route";
import { POST as vacation } from "@/app/api/alpha-exchange/admin/sellers/[userId]/vacation/route";

const actions = [
  { name: "review moderation", field: "hidden", target: mocks.moderateSellerReview,
    invoke: (request: NextRequest) => moderateReview(request), body: { reviewId: "review-1", hiddenReason: "Owner review" }, savedField: "hidden" },
  { name: "owner review moderation", field: "hide", target: mocks.moderateSellerReview,
    invoke: (request: NextRequest) => ownerModerateReview(request, { params: Promise.resolve({ reviewId: "review-1" }) }), body: { reason: "Owner review" }, savedField: "hidden" },
  { name: "seller vacation", field: "enabled", target: mocks.setSellerVacationModeByAdmin,
    invoke: (request: NextRequest) => vacation(request, { params: Promise.resolve({ userId: "seller-1" }) }), body: {}, savedField: "enabled" },
];

beforeEach(() => {
  vi.clearAllMocks();
  const auth = { user: { id: "owner-1", role: "owner" } };
  mocks.requireApiUser.mockResolvedValue(auth);
  mocks.requireApiAdmin.mockResolvedValue(auth);
  mocks.moderateSellerReview.mockResolvedValue({ id: "review-1" });
  mocks.setSellerVacationModeByAdmin.mockResolvedValue(undefined);
});

for (const action of actions) {
  describe(action.name, () => {
    const invoke = (value: unknown) => action.invoke(new NextRequest("http://localhost/api/test", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...action.body, [action.field]: value }),
    }));

    it.each(["false", "true", 0, 1, null, undefined, {}, []])("rejects non-boolean %j without changing state", async value => {
      const response = await invoke(value);
      expect(response.status).toBe(400);
      expect(action.target).not.toHaveBeenCalled();
    });

    it.each([false, true])("preserves the actual boolean %j", async value => {
      const response = await invoke(value);
      expect(response.status).toBe(200);
      expect(action.target).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        [action.savedField]: value, actorUserId: "owner-1",
      }));
    });
  });
}
