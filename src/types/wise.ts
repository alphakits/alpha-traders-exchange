/** Wise is an isolated USD draft provider, not an approved live crypto payment rail. */
export type BankTransferProvider = "israeli_bank" | "wise";

export type WiseUsdAccountType = "checking" | "savings";

/** Private USD ACH instructions. Never include these in a public listing payload. */
export interface WiseUsdAccountDetails {
  provider: "wise";
  currency: "USD";
  countryCode: "US";
  accountHolderType: "personal";
  accountHolderName: string;
  bankName: string;
  bankAddress?: string;
  routingNumber: string;
  accountNumber: string;
  accountType: WiseUsdAccountType;
}

export type WiseOwnershipReviewStatus = "pending_review" | "manually_reviewed" | "rejected";

export type WiseOwnershipReview =
  | { status: "pending_review" }
  | {
      status: "rejected";
      reviewedAt: string;
      reviewedBy: string;
      evidenceReference: string;
    }
  | {
      status: "manually_reviewed";
      method: "document_review";
      reviewedAt: string;
      reviewedBy: string;
      evidenceReference: string;
      verifiedAccountHolderName: string;
      /** Private canonical details, NOT a hash or a public identifier. */
      accountFingerprint: string;
    };

export interface WiseUsdAccount extends WiseUsdAccountDetails {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  /** Server-created review metadata. Never accept this from an account form. */
  ownershipReview: WiseOwnershipReview;
}

/** Frozen instructions for a trade. Disclose only through an authorized private route. */
export interface WiseUsdAccountSnapshot extends WiseUsdAccountDetails {
  accountId: string;
  userId: string;
  ownershipReviewedAt: string;
  ownershipReviewMethod: "document_review";
}

/** Owner/participant summary, not permission to publish the holder's identity. */
export interface MaskedWiseUsdAccount {
  id: string;
  provider: "wise";
  currency: "USD";
  accountHolderName: string;
  bankName: string;
  accountLast4: string;
  routingLast4: string;
  accountType: WiseUsdAccountType;
  ownershipReviewStatus: WiseOwnershipReviewStatus;
}
