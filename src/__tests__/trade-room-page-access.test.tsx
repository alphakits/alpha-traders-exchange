import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  request: vi.fn(),
  active: vi.fn(),
  actionable: vi.fn(),
  notification: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: (destination: string) => { throw new Error(`redirect:${destination}`); } }));
vi.mock("@/lib/auth", () => ({ getCurrentSessionUser: mocks.session }));
vi.mock("@/lib/seo", () => ({ buildPageMetadata: vi.fn() }));
vi.mock("@/lib/alpha-exchange-store", () => ({
  getTradeRoomRequestForUserById: mocks.request,
  getFirstActiveTradeForUser: mocks.active,
  getFirstActionableTradeForUser: mocks.actionable,
  resolveTradeRoomRequestForNotification: mocks.notification,
}));
vi.mock("@/components/sections/trade-room/trade-room-page", () => ({ TradeRoomPage: () => null }));

import TradeRoomRoute from "@/app/[locale]/trade-room/[requestId]/page";
import TradeRoomLandingPage from "@/app/[locale]/trade-room/page";

const room = { id: "purchase-existing", buyerId: "participant", sellerId: "seller", status: "accepted" };
const openRoom = (locale = "en", view?: string) => TradeRoomRoute({
  params: Promise.resolve({ locale, requestId: room.id }), searchParams: Promise.resolve({ view }),
});
const openLanding = (query = {}) => TradeRoomLandingPage({ params: Promise.resolve({ locale: "ar" }), searchParams: Promise.resolve(query) });

describe("trade room entry with an existing participant and a non-trading profile role", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.session.mockResolvedValue({ id: "participant", fullName: "Participant", role: "guest", roles: ["guest"], sellerStatus: "buyer" });
    mocks.request.mockResolvedValue(room);
    mocks.active.mockResolvedValue(null);
    mocks.actionable.mockResolvedValue(null);
    mocks.notification.mockResolvedValue({ request: null });
  });

  it.each(["guest", "student"])("opens the participant's room with a %s profile", async role => {
    mocks.session.mockResolvedValue({ id: "participant", fullName: "Participant", role, roles: [role], sellerStatus: "buyer" });
    const page = await openRoom();
    expect(page.props).toMatchObject({ requestId: room.id, actor: { id: "participant", role } });
    expect(mocks.request).toHaveBeenCalledWith({ userId: "participant", role, requestId: room.id });
  });

  it.each(["en", "ar"])("keeps a nonparticipant out of another room in %s", async locale => {
    mocks.request.mockResolvedValue(null);
    await expect(openRoom(locale)).rejects.toThrow(`redirect:/${locale}/profile`);
  });

  it("fails closed when the participant lookup fails", async () => {
    mocks.request.mockRejectedValue(new Error("Database unavailable"));
    await expect(openRoom()).rejects.toThrow("Database unavailable");
  });

  it.each(["buyer", "owner"])("does not add a duplicate lookup for the existing %s route", async role => {
    mocks.session.mockResolvedValue({ id: "participant", role, roles: [role] });
    expect((await openRoom()).props.requestId).toBe(room.id);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("preserves the exact room destination for a signed-out visitor", async () => {
    mocks.session.mockResolvedValue(null);
    await expect(openRoom("ar", "history")).rejects.toThrow(`redirect:/ar/login?redirectTo=${encodeURIComponent(`/ar/trade-room/${room.id}?view=history`)}`);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("resumes the guest's active trade before applying the dashboard role guard", async () => {
    mocks.active.mockResolvedValue(room);
    await expect(openLanding()).rejects.toThrow(`redirect:/ar/trade-room/${room.id}`);
  });

  it("resumes a guest's pending request through the pending entry point", async () => {
    mocks.actionable.mockResolvedValue({ ...room, status: "pending" });
    await expect(openLanding({ includePending: "1" })).rejects.toThrow(`redirect:/ar/trade-room/${room.id}`);
  });

  it("resolves the participant's notification before applying the role guard", async () => {
    mocks.notification.mockResolvedValue({ request: room });
    await expect(openLanding({ notificationId: "own-notice" })).rejects.toThrow(`redirect:/ar/trade-room/${room.id}`);
    expect(mocks.notification).toHaveBeenCalledWith(expect.objectContaining({ notificationId: "own-notice", userId: "participant", role: "guest" }));
  });

  it("keeps guests without a matching trade on their profile", async () => {
    await expect(openLanding({ notificationId: "unrelated-notice" })).rejects.toThrow("redirect:/ar/profile");
  });
});
