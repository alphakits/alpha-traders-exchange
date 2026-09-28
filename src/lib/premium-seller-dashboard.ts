export type SellerWorkspaceTab = "overview" | "listings" | "trades" | "settings";

export type SellerWorkspaceHighlightTone = "accent" | "success" | "warning" | "neutral";

export type SellerWorkspaceHighlight = {
  label: string;
  value: string;
  tone: SellerWorkspaceHighlightTone;
};

export function getSellerWorkspaceHighlights(params: {
  openListings: number;
  pendingActions: number;
  bankReadyTrades: number;
  completedTrades: number;
  successRate: number;
}): SellerWorkspaceHighlight[] {
  return [
    {
      label: "Open listings",
      value: `${params.openListings}`,
      tone: "accent",
    },
    {
      label: "Pending actions",
      value: `${params.pendingActions}`,
      tone: params.pendingActions > 0 ? "warning" : "neutral",
    },
    {
      label: "Bank-ready trades",
      value: `${params.bankReadyTrades}`,
      tone: params.bankReadyTrades > 0 ? "success" : "neutral",
    },
    {
      label: "Completed trades",
      value: `${params.completedTrades}`,
      tone: "neutral",
    },
    {
      label: "Success rate",
      value: `${params.successRate.toFixed(1)}%`,
      tone: "success",
    },
  ];
}
