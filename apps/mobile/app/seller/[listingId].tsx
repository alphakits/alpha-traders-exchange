import { useLocalSearchParams } from "expo-router";
import { SellerProfileScreen } from "../../src/screens/seller-profile-screen";

export default function SellerProfileRoute() {
  const params = useLocalSearchParams<{ listingId?: string | string[] }>();
  const listingId = Array.isArray(params.listingId) ? params.listingId[0] ?? "" : params.listingId ?? "";
  return <SellerProfileScreen listingId={listingId} />;
}
