import { useLocalSearchParams } from "expo-router";
import { TradeDetailScreen } from "../../src/screens/trade-detail-screen";

export default function TradeDetailRoute() {
  const params = useLocalSearchParams<{ requestId?: string | string[] }>();
  const requestId = Array.isArray(params.requestId) ? params.requestId[0] ?? "" : params.requestId ?? "";
  return <TradeDetailScreen requestId={requestId} />;
}
