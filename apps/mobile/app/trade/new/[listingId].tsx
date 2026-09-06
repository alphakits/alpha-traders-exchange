import { useLocalSearchParams } from "expo-router";
import { TradeFormScreen } from "../../../src/screens/trade-form-screen";

export default function NewTradeRoute() {
  const params = useLocalSearchParams<{ listingId?: string | string[]; mode?: string | string[] }>();
  const listingId = Array.isArray(params.listingId) ? params.listingId[0] ?? "" : params.listingId ?? "";
  const rawMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  return <TradeFormScreen listingId={listingId} mode={rawMode === "offer" ? "offer" : "buy"} />;
}
