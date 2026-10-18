import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OwnerAttentionQueue } from "./owner-attention-queue";
import type { MarketplaceOperationalSnapshot } from "@/lib/marketplace-operational-health";

describe("owner priority read states", () => {
  it.each([false, true])("hides stale records and counts until the current snapshot is ready (Arabic: %s)", isAr => {
    const operations = {
      generatedAt: "2026-10-18T07:47:13.808Z",
      incidents: [{ id: "overdue", kind: "overdue_usdt_release", severity: "critical", requestId: "private-trade", ageMinutes: 30 }],
    } as MarketplaceOperationalSnapshot;
    const onOpen = vi.fn();
    const props = { isAr, operations, disputes: [], commissions: [], onOpen };
    const view = render(<OwnerAttentionQueue {...props} />);
    const queue = screen.getByRole("region", { name: isAr ? "قائمة متابعة المالك" : "Owner attention queue" });
    fireEvent.click(within(queue).getByRole("button", { name: isAr ? "فتح السجل" : "Open record" }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(within(queue).getByText("(1)")).toBeTruthy();
    for (const snapshotStatus of ["loading", "unavailable"] as const) {
      view.rerender(<OwnerAttentionQueue {...props} snapshotStatus={snapshotStatus} />);
      expect(within(queue).queryByText("private-trade")).toBeNull();
      expect(within(queue).queryByText(/\(\d+\)/)).toBeNull();
      expect(within(queue).queryByRole("button")).toBeNull();
      expect(within(queue).getByRole("link").getAttribute("href")).toBe(`/${isAr ? "ar" : "en"}/settings?tab=security`);
      expect(within(queue).getByRole("status")).toBeTruthy();
      expect(within(queue).queryByText(isAr ? "لا توجد إجراءات متابعة في هذا التحديث." : "No follow-up items in this snapshot.")).toBeNull();
    }
    view.rerender(<OwnerAttentionQueue {...props} snapshotStatus="ready" />);
    expect(within(queue).getByText("private-trade")).toBeTruthy();
    expect(within(queue).getByText("(1)")).toBeTruthy();
    expect(queue.getAttribute("aria-busy")).toBe("false");
  });
});
