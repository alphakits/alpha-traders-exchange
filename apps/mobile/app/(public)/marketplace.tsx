import { SafeAreaView } from "react-native-safe-area-context";
import { NativeSiteHeader } from "../../src/components/native-site-header";
import { MarketplaceScreen } from "../../src/screens/marketplace-screen";

export default function PublicMarketplaceScreen() {
  return (
    <SafeAreaView style={{ backgroundColor: "transparent", flex: 1 }}>
      <NativeSiteHeader />
      <MarketplaceScreen publicMode />
    </SafeAreaView>
  );
}
