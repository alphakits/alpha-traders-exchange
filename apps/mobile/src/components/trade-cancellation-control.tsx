import { View } from "react-native";
import type { MobileTradeDetail } from "@alpha-traders/contracts";
import { BrandedText as Text } from "./branded-text";
import { GoldButton } from "./gold-button";

export function TradeCancellationControl({ trade, isAr, disabled, loading, onCancel }: {
  trade: MobileTradeDetail; isAr: boolean; disabled: boolean; loading: boolean; onCancel: () => void;
}) {
  if (!["pending", "accepted", "payment_sent", "funds_received", "usdt_release_pending", "usdt_sent"].includes(trade.status)) return null;
  // Pending sellers already have the separate Decline Trade action.
  if (trade.side === "seller" && trade.status === "pending" && trade.actions.canDecline) return null;
  const canCancel = ["pending", "accepted"].includes(trade.status) && trade.actions.canCancel && !trade.hasOpenDispute;
  const lockedMessage = trade.hasOpenDispute
    ? (isAr ? "الإلغاء مقفل أثناء مراجعة النزاع." : "Cancellation is locked while the dispute is under review.")
    : (isAr ? "الإلغاء مقفل في هذه المرحلة. تواصل مع المالك لمراجعة الصفقة." : "Cancellation is locked at this stage. Contact the owner to review the trade.");
  return <View style={{ gap: 8 }}>
    <GoldButton disabled={disabled || !canCancel} loading={loading} variant="outline"
      onPress={() => { if (canCancel && !disabled && !loading) onCancel(); }}>
      {isAr ? "إلغاء الصفقة" : "Cancel Trade"}
    </GoldButton>
    {!canCancel ? <Text style={{ color: "#D1D5DB" }}>{lockedMessage}</Text> : null}
  </View>;
}
