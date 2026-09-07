import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@alpha-traders/design-tokens";
import { NativeSiteHeader } from "../../src/components/native-site-header";
import { TradesScreen } from "../../src/screens/trades-screen";

export default function TradesRoute() {
  return (
    <SafeAreaView style={{ backgroundColor: colors.background, flex: 1 }} edges={["top", "left", "right"]}>
      <NativeSiteHeader />
      <TradesScreen />
    </SafeAreaView>
  );
}
