import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@alpha-traders/design-tokens";
import { NativeSiteHeader } from "../../src/components/native-site-header";
import { SellerWorkspaceScreen } from "../../src/screens/seller-workspace-screen";

export default function SellerRoute() {
  return (
    <SafeAreaView style={{ backgroundColor: colors.background, flex: 1 }} edges={["top", "left", "right"]}>
      <NativeSiteHeader />
      <SellerWorkspaceScreen />
    </SafeAreaView>
  );
}
