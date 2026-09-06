import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@alpha-traders/design-tokens";
import { MarketplaceScreen } from "../../src/screens/marketplace-screen";

export default function PublicMarketplaceScreen() {
  return (
    <SafeAreaView style={{ backgroundColor: colors.background, flex: 1 }}>
      <MarketplaceScreen publicMode />
    </SafeAreaView>
  );
}
