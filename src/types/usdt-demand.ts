import type { SupportedNetwork } from "./alpha-exchange";

export type DemandTerms = {
  amount: string;
  price: string;
  network: SupportedNetwork;
  paymentMethod: "Bank Transfer" | "Cardless ATM Withdrawal" | "Face-to-Face (Meet in Person)";
  city: string;
};
export type DemandOffer = {
  id: string;
  sellerId: string;
  listingId: string;
  listingUpdatedAt: string;
  operationId: string;
  revision: number;
  price: string;
  state: "open" | "accepted" | "withdrawn" | "superseded";
  createdAt: string;
};
export type UsdtDemand = DemandTerms & {
  id: string;
  requesterId: string;
  operationId: string;
  createTerms?: DemandTerms;
  revision: number;
  state: "open" | "matched" | "cancelled" | "expired";
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  purchaseRequestId?: string;
  acceptedOfferId?: string;
  offers: DemandOffer[];
  history: Array<{ action: string; actorId: string; at: string; revision: number; purchaseRequestId?: string; offerId?: string }>;
};
export type DemandView = DemandTerms & {
  id: string;
  requesterName: string;
  isMine: boolean;
  revision: number;
  state: UsdtDemand["state"] | "paused" | "fulfilled" | "trade_cancelled";
  expiresAt: string;
  updatedAt: string;
  purchaseRequestId?: string;
  offers: Array<Pick<DemandOffer, "id" | "listingId" | "price" | "state" | "revision"> & {
    sellerName: string; isMine: boolean; available: boolean; createdAt?: string;
  }>;
};
export type DemandWorkspace = {
  actorId: string;
  canRespond: boolean;
  reference: { price: string; minimum: string; maximum: string; quotedAt?: string } | null;
  requests: DemandView[];
  listings: Array<{ id: string; price: string; amount: string }>;
  nextCursor: string | null;
  publishing?: { nextAllowedAt: string | null; remaining: number; openRequestId?: string | null };
};
