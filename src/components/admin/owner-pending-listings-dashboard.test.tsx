import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OwnerPendingListingsDashboard } from "@/components/admin/owner-pending-listings-dashboard";

describe("OwnerPendingListingsDashboard localization", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      pendingListings: [],
      allListings: [],
      purchaseRequests: [],
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the owner review queue fully in Arabic", async () => {
    render(<OwnerPendingListingsDashboard locale="ar" />);

    expect(await screen.findByRole("heading", { name: "العروض المعلّقة (مراجعة المالك)" })).toBeTruthy();
    expect(await screen.findByText("لا توجد عروض معلّقة للمراجعة.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Pending Listings (Owner Review)" })).toBeNull();
  });
});
